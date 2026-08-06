from __future__ import annotations

import asyncio
from typing import Any

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import Settings, get_settings

_NOT_FOUND_CODES = frozenset({"404", "NoSuchKey", "NotFound"})
_PRECONDITION_CODES = frozenset({"PreconditionFailed", "412"})


class PrivacyErasureRegisterStorageError(Exception):
    """Safe base error for the backend-only restore register storage."""


class PrivacyErasureRegisterStorageUnavailableError(
    PrivacyErasureRegisterStorageError,
):
    """Storage is disabled or missing required backend-only configuration."""


class PrivacyErasureRegisterStorageOperationError(
    PrivacyErasureRegisterStorageError,
):
    """A provider operation failed without exposing provider details."""


class S3PrivacyErasureRegisterStorage:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._client: Any | None = None

    async def get_object(self, key: str) -> bytes | None:
        return await asyncio.to_thread(self._get_object_sync, key)

    async def put_object_if_absent(self, key: str, body: bytes) -> bool:
        return await asyncio.to_thread(self._put_object_if_absent_sync, key, body)

    async def list_object_keys(self, prefix: str) -> list[str]:
        return await asyncio.to_thread(self._list_object_keys_sync, prefix)

    def _get_object_sync(self, key: str) -> bytes | None:
        settings = self._require_settings()
        try:
            response = self._s3_client().get_object(
                Bucket=settings.api_object_storage_bucket,
                Key=key,
            )
            body = response["Body"].read()
        except ClientError as exc:
            if _error_code(exc) in _NOT_FOUND_CODES:
                return None
            raise PrivacyErasureRegisterStorageOperationError(
                "restore register read unavailable",
            ) from None
        except (BotoCoreError, KeyError, OSError, TypeError, ValueError):
            raise PrivacyErasureRegisterStorageOperationError(
                "restore register read unavailable",
            ) from None
        if not isinstance(body, bytes):
            raise PrivacyErasureRegisterStorageOperationError(
                "restore register read unavailable",
            )
        return body

    def _put_object_if_absent_sync(self, key: str, body: bytes) -> bool:
        settings = self._require_settings()
        try:
            self._s3_client().put_object(
                Bucket=settings.api_object_storage_bucket,
                Key=key,
                Body=body,
                ContentType="application/json",
                IfNoneMatch="*",
            )
        except ClientError as exc:
            if _error_code(exc) in _PRECONDITION_CODES:
                return False
            raise PrivacyErasureRegisterStorageOperationError(
                "restore register write unavailable",
            ) from None
        except BotoCoreError:
            raise PrivacyErasureRegisterStorageOperationError(
                "restore register write unavailable",
            ) from None
        return True

    def _list_object_keys_sync(self, prefix: str) -> list[str]:
        settings = self._require_settings()
        keys: list[str] = []
        continuation_token: str | None = None
        try:
            while True:
                kwargs: dict[str, Any] = {
                    "Bucket": settings.api_object_storage_bucket,
                    "Prefix": prefix,
                }
                if continuation_token is not None:
                    kwargs["ContinuationToken"] = continuation_token
                response = self._s3_client().list_objects_v2(**kwargs)
                for item in response.get("Contents", []):
                    key = item.get("Key")
                    if not isinstance(key, str):
                        raise PrivacyErasureRegisterStorageOperationError(
                            "restore register listing unavailable",
                        )
                    keys.append(key)
                if not response.get("IsTruncated"):
                    break
                continuation_token = response.get("NextContinuationToken")
                if not isinstance(continuation_token, str) or not continuation_token:
                    raise PrivacyErasureRegisterStorageOperationError(
                        "restore register listing unavailable",
                    )
        except PrivacyErasureRegisterStorageOperationError:
            raise
        except (BotoCoreError, ClientError, TypeError, ValueError):
            raise PrivacyErasureRegisterStorageOperationError(
                "restore register listing unavailable",
            ) from None
        return sorted(keys)

    def _s3_client(self) -> Any:
        settings = self._require_settings()
        if self._client is None:
            addressing_style = (
                "path" if settings.api_object_storage_path_style else "auto"
            )
            self._client = boto3.session.Session().client(
                "s3",
                endpoint_url=settings.api_object_storage_endpoint_url.strip(),
                region_name=settings.api_object_storage_region,
                aws_access_key_id=settings.api_object_storage_access_key_id,
                aws_secret_access_key=settings.api_object_storage_secret_access_key,
                config=Config(
                    signature_version="s3v4",
                    s3={"addressing_style": addressing_style},
                ),
            )
        return self._client

    def _require_settings(self) -> Settings:
        settings = self._settings
        if not settings.api_object_storage_enabled:
            raise PrivacyErasureRegisterStorageUnavailableError(
                "restore register storage disabled",
            )
        if (
            not settings.api_object_storage_endpoint_url.strip()
            or not settings.api_object_storage_region.strip()
            or not settings.api_object_storage_bucket.strip()
            or not settings.api_object_storage_access_key_id.strip()
            or not settings.api_object_storage_secret_access_key.strip()
        ):
            raise PrivacyErasureRegisterStorageUnavailableError(
                "restore register storage not configured",
            )
        return settings


def get_privacy_erasure_register_storage() -> S3PrivacyErasureRegisterStorage:
    return S3PrivacyErasureRegisterStorage()


def _error_code(exc: ClientError) -> str:
    error = exc.response.get("Error", {})
    code = str(error.get("Code", ""))
    if code:
        return code
    return str(exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode", ""))
