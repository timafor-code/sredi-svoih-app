from __future__ import annotations

from dataclasses import dataclass
import hashlib
from io import BytesIO
from typing import BinaryIO
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_EVENT_IMAGE_SOURCE_BYTES = 12 * 1024 * 1024
MAX_EVENT_IMAGE_PIXELS = 40_000_000
MAX_EVENT_IMAGE_LONGEST_SIDE = 2560
MAX_NORMALIZED_EVENT_IMAGE_BYTES = 5 * 1024 * 1024
NORMALIZED_EVENT_IMAGE_CONTENT_TYPE = "image/webp"
_READ_CHUNK_BYTES = 1024 * 1024
_WEBP_QUALITY_STEPS = (88, 84, 80, 76, 72, 68, 64, 60)
_FORMAT_CONTENT_TYPES = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}

# Pillow emits a warning above this threshold and an error above twice the
# threshold. The explicit area check below keeps the exact project limit.
Image.MAX_IMAGE_PIXELS = MAX_EVENT_IMAGE_PIXELS


class EventImageNormalizationError(Exception):
    """Base class for safe image-normalization failures."""


class EventImageSourceTooLargeError(EventImageNormalizationError):
    """The caller supplied more source bytes than allowed."""


class EventImageUnsupportedError(EventImageNormalizationError):
    """The source is not an accepted single-frame raster image."""


class EventImageCorruptError(EventImageNormalizationError):
    """The accepted raster container cannot be decoded safely."""


class EventImageDecodedTooLargeError(EventImageNormalizationError):
    """The decoded raster exceeds the pixel-area limit."""


class EventImageOutputTooLargeError(EventImageNormalizationError):
    """Bounded encoding could not meet the normalized-output limit."""


@dataclass(frozen=True)
class NormalizedEventImage:
    content: bytes
    content_type: str
    size_bytes: int
    width: int
    height: int
    content_sha256: str


def normalize_event_image(
    source: BinaryIO,
    *,
    declared_content_type: str | None = None,
) -> NormalizedEventImage:
    source_bytes = _read_source_bytes(source)
    declared_type = _normalize_declared_content_type(declared_content_type)

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(source_bytes)) as opened:
                detected_type = _FORMAT_CONTENT_TYPES.get(opened.format or "")
                if detected_type is None:
                    raise EventImageUnsupportedError(
                        "unsupported event image format",
                    )
                if declared_type is not None and declared_type != detected_type:
                    raise EventImageUnsupportedError(
                        "declared event image type does not match content",
                    )
                if bool(getattr(opened, "is_animated", False)) or int(
                    getattr(opened, "n_frames", 1),
                ) != 1:
                    raise EventImageUnsupportedError(
                        "animated event images are not supported",
                    )
                _enforce_pixel_limit(opened.width, opened.height)
                opened.load()
                oriented = ImageOps.exif_transpose(opened)
                _enforce_pixel_limit(oriented.width, oriented.height)
                normalized_pixels = _normalize_pixels(oriented)
    except EventImageNormalizationError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise EventImageDecodedTooLargeError(
            "event image decoded dimensions exceed the limit",
        ) from exc
    except UnidentifiedImageError as exc:
        raise EventImageUnsupportedError("unsupported event image format") from exc
    except (OSError, SyntaxError, ValueError) as exc:
        raise EventImageCorruptError("event image cannot be decoded") from exc

    content = _encode_normalized_webp(normalized_pixels)
    return NormalizedEventImage(
        content=content,
        content_type=NORMALIZED_EVENT_IMAGE_CONTENT_TYPE,
        size_bytes=len(content),
        width=normalized_pixels.width,
        height=normalized_pixels.height,
        content_sha256=hashlib.sha256(content).hexdigest(),
    )


def _read_source_bytes(source: BinaryIO) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = source.read(
            min(_READ_CHUNK_BYTES, MAX_EVENT_IMAGE_SOURCE_BYTES + 1 - total),
        )
        if not chunk:
            break
        if not isinstance(chunk, bytes):
            raise EventImageCorruptError("event image source must contain bytes")
        total += len(chunk)
        if total > MAX_EVENT_IMAGE_SOURCE_BYTES:
            raise EventImageSourceTooLargeError(
                "event image source exceeds the byte limit",
            )
        chunks.append(chunk)
    if not chunks:
        raise EventImageCorruptError("event image source is empty")
    return b"".join(chunks)


def _normalize_declared_content_type(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.split(";", 1)[0].strip().lower()
    if normalized not in _FORMAT_CONTENT_TYPES.values():
        raise EventImageUnsupportedError("unsupported declared event image type")
    return normalized


def _enforce_pixel_limit(width: int, height: int) -> None:
    if width <= 0 or height <= 0 or width * height > MAX_EVENT_IMAGE_PIXELS:
        raise EventImageDecodedTooLargeError(
            "event image decoded dimensions exceed the limit",
        )


def _normalize_pixels(image: Image.Image) -> Image.Image:
    has_alpha = image.mode in {"RGBA", "LA"} or (
        image.mode == "P" and "transparency" in image.info
    )
    converted = image.convert("RGBA" if has_alpha else "RGB")

    longest_side = max(converted.size)
    if longest_side > MAX_EVENT_IMAGE_LONGEST_SIDE:
        scale = MAX_EVENT_IMAGE_LONGEST_SIDE / longest_side
        resized = converted.resize(
            (
                max(1, round(converted.width * scale)),
                max(1, round(converted.height * scale)),
            ),
            Image.Resampling.LANCZOS,
        )
    else:
        resized = converted

    clean = Image.new(resized.mode, resized.size)
    clean.paste(resized)
    return clean


def _encode_normalized_webp(image: Image.Image) -> bytes:
    for quality in _WEBP_QUALITY_STEPS:
        output = BytesIO()
        try:
            image.save(
                output,
                format="WEBP",
                quality=quality,
                method=6,
                exact=True,
            )
        except OSError as exc:
            raise EventImageCorruptError(
                "event image cannot be normalized",
            ) from exc
        content = output.getvalue()
        if len(content) <= MAX_NORMALIZED_EVENT_IMAGE_BYTES:
            return content
    raise EventImageOutputTooLargeError(
        "normalized event image exceeds the byte limit",
    )
