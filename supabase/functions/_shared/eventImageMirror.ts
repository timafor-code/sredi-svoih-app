// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

export const EVENT_IMAGE_STORAGE_BUCKET = "event-images";
export const EVENT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const DEFAULT_REQUEST_TIMEOUT_MS = 9_000;
const MAX_REQUEST_TIMEOUT_MS = 10_000;
const IMAGE_HEADERS = {
  accept: "image/jpeg,image/png,image/webp,image/gif",
  "user-agent":
    "sredi-svoih-edge-event-image-mirror/1.0 (+https://github.com/timafor-code/sredi-svoih-app)",
};
const CONTENT_TYPE_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

export async function mirrorEventImageToStorage(input = {}) {
  const originalUrl = readString(input.imageUrl);
  const checkedAt = new Date().toISOString();

  if (!originalUrl) {
    return createImageMirrorMetadata({
      status: "missing",
      originalUrl: null,
      checkedAt,
    });
  }

  try {
    const imageUrl = parseSafeImageUrl(originalUrl);
    const authorization = readString(input.authorization);
    const communityId = readString(input.communityId);

    if (!authorization) {
      throw new EventImageMirrorError("missing_authorization", "Authorization header is required.");
    }

    if (!communityId) {
      throw new EventImageMirrorError("missing_community", "Community id is required.");
    }

    input.timeoutGuard?.assertCanContinue?.("image mirror");
    const response = await fetchImage(imageUrl.href, {
      requestTimeoutMs: input.requestTimeoutMs,
      timeoutGuard: input.timeoutGuard,
    });
    const responseContentType = normalizeContentType(response.headers.get("content-type"));

    if (!response.ok) {
      throw new EventImageMirrorError(
        "image_http_error",
        `Image fetch returned HTTP ${response.status}.`,
      );
    }

    if (!responseContentType.startsWith("image/")) {
      throw new EventImageMirrorError(
        "invalid_content_type",
        "Image response content-type is not image/*.",
      );
    }

    const contentType = canonicalizeImageContentType(responseContentType);
    const extension = CONTENT_TYPE_EXTENSIONS.get(contentType);

    if (!extension) {
      throw new EventImageMirrorError(
        "unsupported_content_type",
        "Image content-type is not allowed for event image storage.",
      );
    }

    const contentLength = readContentLength(response.headers.get("content-length"));

    if (contentLength !== null && contentLength > EVENT_IMAGE_MAX_BYTES) {
      throw new EventImageMirrorError(
        "image_too_large",
        `Image is larger than ${EVENT_IMAGE_MAX_BYTES} bytes.`,
      );
    }

    const bytes = await readResponseBytes(response, EVENT_IMAGE_MAX_BYTES);
    const sha256Hex = await sha256(bytes);
    const storagePath = await buildStoragePath({
      communityId,
      sourceExternalId: input.sourceExternalId,
      sourceUrl: input.sourceUrl,
      originalUrl: imageUrl.href,
      sha256Hex,
      extension,
    });
    const supabase = createUserScopedSupabaseClient(authorization);
    const { error: uploadError } = await supabase.storage
      .from(EVENT_IMAGE_STORAGE_BUCKET)
      .upload(storagePath, bytes, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      throw new EventImageMirrorError(
        "storage_upload_failed",
        "Could not upload image to Storage.",
        { cause: uploadError },
      );
    }

    const { data: publicUrlData } = supabase.storage
      .from(EVENT_IMAGE_STORAGE_BUCKET)
      .getPublicUrl(storagePath);

    return createImageMirrorMetadata({
      status: "stored",
      originalUrl: imageUrl.href,
      storagePath,
      publicUrl: publicUrlData?.publicUrl ?? null,
      contentType,
      byteSize: bytes.byteLength,
      sha256: `sha256:${sha256Hex}`,
      checkedAt,
    });
  } catch (error) {
    return createImageMirrorMetadata({
      status: "failed",
      originalUrl,
      checkedAt,
      error: safeImageMirrorErrorMessage(error),
    });
  }
}

class EventImageMirrorError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "EventImageMirrorError";
    this.code = code;
    this.cause = options.cause;
  }
}

function createUserScopedSupabaseClient(authorization) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const supabaseKey =
    Deno.env.get("SUPABASE_ANON_KEY")?.trim() ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY")?.trim();

  if (!supabaseUrl || !supabaseKey) {
    throw new EventImageMirrorError(
      "supabase_env_not_configured",
      "Supabase URL and anon/publishable key are required.",
    );
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: authorization,
      },
    },
  });
}

async function fetchImage(url, options) {
  const requestTimeoutMs = normalizeRequestTimeout(options.requestTimeoutMs);
  const remainingMs = options.timeoutGuard?.remainingMs?.();
  const effectiveTimeoutMs = typeof remainingMs === "number"
    ? Math.max(1, Math.min(requestTimeoutMs, remainingMs))
    : requestTimeoutMs;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);

  try {
    return await fetch(url, {
      headers: IMAGE_HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new EventImageMirrorError(
        "request_timeout",
        `Image fetch timed out after ${effectiveTimeoutMs}ms.`,
        { cause: error },
      );
    }

    throw new EventImageMirrorError(
      "fetch_failed",
      "Image fetch failed.",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseBytes(response, maxBytes) {
  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength > maxBytes) {
      throw new EventImageMirrorError(
        "image_too_large",
        `Image is larger than ${maxBytes} bytes.`,
      );
    }

    return new Uint8Array(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.byteLength;

    if (total > maxBytes) {
      await reader.cancel();
      throw new EventImageMirrorError(
        "image_too_large",
        `Image is larger than ${maxBytes} bytes.`,
      );
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

async function buildStoragePath(input) {
  const sourceSegment = await buildSourceSegment(input);

  return [
    "community",
    sanitizePathSegment(input.communityId),
    "website-import",
    sourceSegment,
    `${input.sha256Hex}.${input.extension}`,
  ].join("/");
}

async function buildSourceSegment(input) {
  const fromExternalId = sanitizePathSegment(readString(input.sourceExternalId));

  if (fromExternalId) {
    return fromExternalId;
  }

  const fallbackHash = await sha256Text(
    readString(input.sourceUrl) ?? readString(input.originalUrl) ?? "unknown-source",
  );

  return fallbackHash.slice(0, 16);
}

function parseSafeImageUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new EventImageMirrorError(
      "invalid_image_url",
      "Image URL must be a valid URL.",
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new EventImageMirrorError(
      "invalid_image_url",
      "Image URL must use http or https.",
    );
  }

  if (url.username || url.password) {
    throw new EventImageMirrorError(
      "invalid_image_url",
      "Image URL must not include credentials.",
    );
  }

  if (isBlockedImageHost(url.hostname)) {
    throw new EventImageMirrorError(
      "invalid_image_host",
      "Image URL host is not allowed.",
    );
  }

  return url;
}

function isBlockedImageHost(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }

  const ipv4Match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

  if (!ipv4Match) {
    return false;
  }

  const octets = ipv4Match.slice(1).map((part) => Number(part));

  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  return octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

function createImageMirrorMetadata(input) {
  return {
    status: input.status,
    originalUrl: input.originalUrl ?? null,
    storageBucket: input.status === "stored" ? EVENT_IMAGE_STORAGE_BUCKET : null,
    storagePath: input.storagePath ?? null,
    publicUrl: input.publicUrl ?? null,
    contentType: input.contentType ?? null,
    byteSize: input.byteSize ?? null,
    sha256: input.sha256 ?? null,
    checkedAt: input.checkedAt,
    error: input.error ?? null,
  };
}

function normalizeRequestTimeout(value) {
  const parsed = typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : DEFAULT_REQUEST_TIMEOUT_MS;

  return Math.min(Math.max(parsed, 1_000), MAX_REQUEST_TIMEOUT_MS);
}

function normalizeContentType(value) {
  return (value ?? "").split(";")[0].trim().toLowerCase();
}

function canonicalizeImageContentType(value) {
  return value === "image/jpg" ? "image/jpeg" : value;
}

function readContentLength(value) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readString(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function sanitizePathSegment(value) {
  const text = readString(value);

  if (!text) {
    return null;
  }

  const sanitized = text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);

  return sanitized || null;
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return hex(new Uint8Array(digest));
}

async function sha256Text(value) {
  return await sha256(new TextEncoder().encode(value));
}

function hex(bytes) {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeImageMirrorErrorMessage(error) {
  const code = error instanceof EventImageMirrorError ? error.code : "image_mirror_failed";
  const message = error instanceof Error ? error.message : String(error);

  return `${code}: ${message}`
    .replace(/\s+/g, " ")
    .slice(0, 180);
}
