from __future__ import annotations

import hashlib
from io import BytesIO
from pathlib import PurePosixPath
import unittest
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4

from alembic.config import Config
from alembic.script import ScriptDirectory
from botocore.exceptions import ClientError
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import inspect, text

from app.core.config import Settings
from app.db.models.event_image import EventImage
from app.db.session import AsyncSessionLocal, engine
from app.services import admin_event_images
from app.services.admin_event_images import (
    EventImageCorruptError,
    EventImageDecodedTooLargeError,
    EventImageOutputTooLargeError,
    EventImageSourceTooLargeError,
    EventImageUnsupportedError,
    normalize_event_image,
)
from app.storage.event_images import (
    EventImageStorageOperationError,
    EventImageStorageUnavailableError,
    S3EventImageStorage,
    build_event_image_object_key,
    build_event_image_public_url,
)
from app.storage.s3 import S3AvatarStorage


def _image_bytes(
    image_format: str,
    *,
    size: tuple[int, int] = (32, 24),
    mode: str = "RGB",
    color: tuple[int, ...] = (20, 40, 60),
    exif: Image.Exif | None = None,
) -> bytes:
    image = Image.new(mode, size, color)
    output = BytesIO()
    save_options: dict[str, object] = {}
    if exif is not None:
        save_options["exif"] = exif
    image.save(output, format=image_format, **save_options)
    return output.getvalue()


def _storage_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "api_object_storage_enabled": True,
        "api_object_storage_endpoint_url": "http://api-object-storage:9000",
        "api_object_storage_public_endpoint_url": "http://127.0.0.1:59000",
        "api_object_storage_region": "us-east-1",
        "api_object_storage_bucket": "avatars",
        "api_object_storage_event_images_bucket": "event-images",
        "api_object_storage_access_key_id": "backend-access",
        "api_object_storage_secret_access_key": "backend-secret",
        "api_object_storage_path_style": True,
        "api_event_image_public_base_url": (
            "http://127.0.0.1:59000/event-images"
        ),
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


class EventImageKeyAndUrlTests(unittest.TestCase):
    def test_object_key_uses_only_uuid_namespaces_and_opaque_filename(self) -> None:
        community_id = UUID("11111111-1111-4111-8111-111111111111")
        event_id = UUID("22222222-2222-4222-8222-222222222222")
        object_id = UUID("33333333-3333-4333-8333-333333333333")

        key = build_event_image_object_key(
            community_id=community_id,
            event_id=event_id,
            object_id=object_id,
        )

        self.assertEqual(
            key,
            "communities/11111111-1111-4111-8111-111111111111/"
            "events/22222222-2222-4222-8222-222222222222/"
            "33333333-3333-4333-8333-333333333333.webp",
        )
        self.assertEqual(PurePosixPath(key).suffix, ".webp")

    def test_object_key_generates_a_new_opaque_uuid(self) -> None:
        key = build_event_image_object_key(
            community_id=uuid4(),
            event_id=uuid4(),
        )
        generated = PurePosixPath(key).stem
        self.assertEqual(str(UUID(generated)), generated)

    def test_public_url_contains_only_public_path_and_version_token(self) -> None:
        version_token = UUID("44444444-4444-4444-8444-444444444444")
        object_key = build_event_image_object_key(
            community_id=UUID("11111111-1111-4111-8111-111111111111"),
            event_id=UUID("22222222-2222-4222-8222-222222222222"),
            object_id=UUID("33333333-3333-4333-8333-333333333333"),
        )

        url = build_event_image_public_url(
            public_base_url="https://media.example.ru/event-images/",
            object_key=object_key,
            version_token=version_token,
        )
        parsed = urlsplit(url)

        self.assertEqual(parsed.scheme, "https")
        self.assertEqual(parsed.netloc, "media.example.ru")
        self.assertTrue(parsed.path.startswith("/event-images/communities/"))
        self.assertEqual(parse_qs(parsed.query), {"v": [str(version_token)]})
        self.assertNotIn("backend", url)
        self.assertNotIn("X-Amz-", url)

    def test_public_url_rejects_credentials_internal_hosts_and_unsafe_keys(self) -> None:
        cases = (
            ("https://user:secret@media.example.ru/event-images", "safe.webp"),
            ("http://api-object-storage:9000/event-images", "safe.webp"),
            ("https://media.example.ru/event-images", "../unsafe.webp"),
        )
        for public_base_url, object_key in cases:
            with self.subTest(public_base_url=public_base_url, object_key=object_key):
                with self.assertRaises(EventImageStorageOperationError):
                    build_event_image_public_url(
                        public_base_url=public_base_url,
                        object_key=object_key,
                        version_token=uuid4(),
                    )

    def test_public_base_url_configuration_is_production_safe(self) -> None:
        with self.assertRaises(ValidationError):
            Settings(
                _env_file=None,
                api_event_image_public_base_url=(
                    "http://api-object-storage:9000/event-images"
                ),
            )
        settings = Settings(
            _env_file=None,
            api_event_image_public_base_url=(
                "https://media.example.ru/event-images/"
            ),
        )
        self.assertEqual(
            settings.api_event_image_public_base_url,
            "https://media.example.ru/event-images",
        )


class EventImageNormalizationTests(unittest.TestCase):
    def test_accepts_jpeg_png_and_webp_and_emits_fresh_webp(self) -> None:
        for source_format, declared_type in (
            ("JPEG", "image/jpeg"),
            ("PNG", "image/png"),
            ("WEBP", "image/webp"),
        ):
            with self.subTest(source_format=source_format):
                normalized = normalize_event_image(
                    BytesIO(_image_bytes(source_format)),
                    declared_content_type=declared_type,
                )
                with Image.open(BytesIO(normalized.content)) as output:
                    self.assertEqual(output.format, "WEBP")
                    self.assertEqual(output.n_frames, 1)
                self.assertEqual(normalized.content_type, "image/webp")

    def test_source_byte_limit_is_enforced_from_the_stream(self) -> None:
        with patch.object(admin_event_images, "MAX_EVENT_IMAGE_SOURCE_BYTES", 4):
            with self.assertRaises(EventImageSourceTooLargeError):
                normalize_event_image(BytesIO(b"12345"))

    def test_decoded_pixel_limit_is_enforced_before_full_processing(self) -> None:
        source = _image_bytes("PNG", size=(11, 10))
        with patch.object(admin_event_images, "MAX_EVENT_IMAGE_PIXELS", 100):
            with self.assertRaises(EventImageDecodedTooLargeError):
                normalize_event_image(
                    BytesIO(source),
                    declared_content_type="image/png",
                )

    def test_rejects_unsupported_base64_html_gif_and_false_declarations(self) -> None:
        gif = _image_bytes("GIF")
        png = _image_bytes("PNG")
        cases = (
            (b"data:image/png;base64,AAAA", "image/png"),
            (b"<html><body>not an image</body></html>", "text/html"),
            (gif, "image/gif"),
            (png, "image/jpeg"),
        )
        for source, declared_type in cases:
            with self.subTest(declared_type=declared_type):
                with self.assertRaises(EventImageUnsupportedError):
                    normalize_event_image(
                        BytesIO(source),
                        declared_content_type=declared_type,
                    )

    def test_corrupt_supported_container_is_rejected_safely(self) -> None:
        source = _image_bytes("JPEG", size=(128, 128))
        with self.assertRaises(EventImageCorruptError):
            normalize_event_image(
                BytesIO(source[: len(source) // 2]),
                declared_content_type="image/jpeg",
            )

    def test_animated_multiframe_webp_is_rejected(self) -> None:
        first = Image.new("RGB", (16, 16), (255, 0, 0))
        second = Image.new("RGB", (16, 16), (0, 0, 255))
        output = BytesIO()
        first.save(
            output,
            format="WEBP",
            save_all=True,
            append_images=[second],
            duration=100,
            loop=0,
        )
        with self.assertRaises(EventImageUnsupportedError):
            normalize_event_image(
                BytesIO(output.getvalue()),
                declared_content_type="image/webp",
            )

    def test_exif_orientation_is_applied(self) -> None:
        exif = Image.Exif()
        exif[274] = 6
        normalized = normalize_event_image(
            BytesIO(_image_bytes("JPEG", size=(40, 20), exif=exif)),
            declared_content_type="image/jpeg",
        )
        self.assertEqual((normalized.width, normalized.height), (20, 40))

    def test_longest_side_is_resized_with_aspect_ratio_preserved(self) -> None:
        normalized = normalize_event_image(
            BytesIO(_image_bytes("JPEG", size=(3000, 1500))),
            declared_content_type="image/jpeg",
        )
        self.assertEqual((normalized.width, normalized.height), (2560, 1280))

    def test_transparency_is_preserved(self) -> None:
        image = Image.new("RGBA", (12, 12), (10, 20, 30, 255))
        image.putpixel((0, 0), (10, 20, 30, 0))
        source = BytesIO()
        image.save(source, format="PNG")

        normalized = normalize_event_image(
            BytesIO(source.getvalue()),
            declared_content_type="image/png",
        )
        with Image.open(BytesIO(normalized.content)) as output:
            self.assertEqual(output.convert("RGBA").getpixel((0, 0))[3], 0)

    def test_output_has_no_source_metadata(self) -> None:
        exif = Image.Exif()
        exif[274] = 1
        exif[315] = "identity-linked source metadata"
        normalized = normalize_event_image(
            BytesIO(_image_bytes("JPEG", exif=exif)),
            declared_content_type="image/jpeg",
        )
        with Image.open(BytesIO(normalized.content)) as output:
            self.assertEqual(len(output.getexif()), 0)
            self.assertNotIn("exif", output.info)
            self.assertNotIn("icc_profile", output.info)
            self.assertNotIn("xmp", output.info)

    def test_normalized_output_limit_fails_after_bounded_quality_steps(self) -> None:
        source = _image_bytes("PNG", size=(32, 32))
        with patch.object(
            admin_event_images,
            "MAX_NORMALIZED_EVENT_IMAGE_BYTES",
            1,
        ):
            with self.assertRaises(EventImageOutputTooLargeError):
                normalize_event_image(
                    BytesIO(source),
                    declared_content_type="image/png",
                )

    def test_sha256_and_size_describe_normalized_content(self) -> None:
        normalized = normalize_event_image(
            BytesIO(_image_bytes("PNG")),
            declared_content_type="image/png",
        )
        self.assertEqual(normalized.size_bytes, len(normalized.content))
        self.assertEqual(
            normalized.content_sha256,
            hashlib.sha256(normalized.content).hexdigest(),
        )


class EventImageStorageAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_event_write_uses_separate_bucket_and_normalized_headers(self) -> None:
        client = MagicMock()
        client.put_object.return_value = {"ETag": '"stored-etag"'}
        storage = S3EventImageStorage(_storage_settings())
        storage._client = client

        result = await storage.put_normalized_image(
            object_key="communities/a/events/b/c.webp",
            content=b"normalized-webp",
        )

        self.assertEqual(result.etag, "stored-etag")
        client.put_object.assert_called_once_with(
            Bucket="event-images",
            Key="communities/a/events/b/c.webp",
            Body=b"normalized-webp",
            ContentLength=len(b"normalized-webp"),
            ContentType="image/webp",
            CacheControl="public, max-age=31536000, immutable",
        )

    async def test_delete_uses_event_bucket(self) -> None:
        client = MagicMock()
        storage = S3EventImageStorage(_storage_settings())
        storage._client = client

        await storage.delete_image(object_key="communities/a/events/b/c.webp")

        client.delete_object.assert_called_once_with(
            Bucket="event-images",
            Key="communities/a/events/b/c.webp",
        )

    async def test_storage_disabled_has_safe_unavailable_error(self) -> None:
        storage = S3EventImageStorage(
            _storage_settings(api_object_storage_enabled=False),
        )
        with self.assertRaisesRegex(
            EventImageStorageUnavailableError,
            "event image storage disabled",
        ):
            await storage.put_normalized_image(
                object_key="communities/a/events/b/c.webp",
                content=b"normalized-webp",
            )

    async def test_provider_failure_is_translated_without_provider_payload(self) -> None:
        client = MagicMock()
        client.put_object.side_effect = ClientError(
            {
                "Error": {
                    "Code": "AccessDenied",
                    "Message": "provider-secret-payload",
                },
            },
            "PutObject",
        )
        storage = S3EventImageStorage(_storage_settings())
        storage._client = client

        with self.assertRaises(EventImageStorageOperationError) as raised:
            await storage.put_normalized_image(
                object_key="communities/a/events/b/c.webp",
                content=b"normalized-webp",
            )
        self.assertEqual(
            str(raised.exception),
            "event image storage operation unavailable",
        )
        self.assertNotIn("provider-secret-payload", str(raised.exception))

    def test_private_avatar_behavior_still_uses_avatar_bucket(self) -> None:
        client = MagicMock()
        client.generate_presigned_url.return_value = "http://signed-avatar-url"
        storage = S3AvatarStorage(_storage_settings())
        storage._presign_client = client

        result = storage._presign_avatar_read_sync(
            object_key="avatars/private-object",
        )

        self.assertEqual(result.url, "http://signed-avatar-url")
        params = client.generate_presigned_url.call_args.kwargs["Params"]
        self.assertEqual(params["Bucket"], "avatars")
        self.assertNotEqual(params["Bucket"], "event-images")


class EventImageMigrationAndModelTests(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self) -> None:
        await engine.dispose()

    async def test_migration_and_database_constraints(self) -> None:
        script = ScriptDirectory.from_config(Config("alembic.ini"))
        revision = script.get_revision("20260813210000")
        self.assertIsNotNone(revision)
        assert revision is not None
        self.assertEqual(revision.down_revision, "20260813120000")

        async with AsyncSessionLocal() as session:
            actual_head = await session.scalar(
                text("SELECT version_num FROM alembic_version"),
            )
        self.assertEqual(actual_head, script.get_current_head())

        async with engine.connect() as connection:
            schema = await connection.run_sync(
                lambda sync_connection: {
                    "checks": inspect(sync_connection).get_check_constraints(
                        "event_images",
                    ),
                    "indexes": inspect(sync_connection).get_indexes("event_images"),
                    "foreign_keys": inspect(sync_connection).get_foreign_keys(
                        "event_images",
                    ),
                    "unique_constraints": inspect(
                        sync_connection,
                    ).get_unique_constraints("event_images"),
                },
            )

        self.assertEqual(
            {
                "event_images_active_lifecycle_check",
                "event_images_content_sha256_check",
                "event_images_content_type_check",
                "event_images_deleted_lifecycle_check",
                "event_images_dimensions_positive_check",
                "event_images_size_positive_check",
                "event_images_status_check",
            },
            {item["name"] for item in schema["checks"]},
        )
        self.assertTrue(
            {
                "event_images_event_id_idx",
                "event_images_community_id_idx",
                "event_images_status_updated_idx",
                "event_images_one_active_per_event_idx",
            }.issubset({item["name"] for item in schema["indexes"]}),
        )
        active_index = next(
            item
            for item in schema["indexes"]
            if item["name"] == "event_images_one_active_per_event_idx"
        )
        self.assertTrue(active_index["unique"])
        self.assertIn(
            "status = 'active'",
            str(active_index["dialect_options"]["postgresql_where"]),
        )
        self.assertIn(
            "event_images_object_key_key",
            {item["name"] for item in schema["unique_constraints"]},
        )
        ondelete_by_column = {
            item["constrained_columns"][0]: item["options"].get("ondelete")
            for item in schema["foreign_keys"]
        }
        self.assertEqual(ondelete_by_column["event_id"], "CASCADE")
        self.assertEqual(ondelete_by_column["community_id"], "CASCADE")
        self.assertEqual(ondelete_by_column["created_by"], "SET NULL")

    def test_model_matches_migration_constraint_and_index_contract(self) -> None:
        table = EventImage.__table__
        self.assertEqual(table.c.content_type.server_default.arg.text, "'image/webp'")
        self.assertFalse(table.c.size_bytes.nullable)
        self.assertFalse(table.c.width.nullable)
        self.assertFalse(table.c.height.nullable)
        self.assertTrue(table.c.created_by.nullable)
        self.assertEqual(
            {
                "event_images_active_lifecycle_check",
                "event_images_content_sha256_check",
                "event_images_content_type_check",
                "event_images_deleted_lifecycle_check",
                "event_images_dimensions_positive_check",
                "event_images_size_positive_check",
                "event_images_status_check",
            },
            {
                constraint.name
                for constraint in table.constraints
                if constraint.name and constraint.name.endswith("_check")
            },
        )
        self.assertIn(
            "event_images_one_active_per_event_idx",
            {index.name for index in table.indexes},
        )


if __name__ == "__main__":
    unittest.main()
