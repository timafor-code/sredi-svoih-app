from __future__ import annotations

import logging
from typing import Any

from fastapi import Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.request_context import REQUEST_ID_HEADER, get_request_id

logger = logging.getLogger(__name__)

_STATUS_CODE_MAP = {
    status.HTTP_400_BAD_REQUEST: "bad_request",
    status.HTTP_401_UNAUTHORIZED: "unauthenticated",
    status.HTTP_403_FORBIDDEN: "forbidden",
    status.HTTP_404_NOT_FOUND: "not_found",
    status.HTTP_409_CONFLICT: "conflict",
    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE: "payload_too_large",
    status.HTTP_415_UNSUPPORTED_MEDIA_TYPE: "unsupported_media_type",
    status.HTTP_422_UNPROCESSABLE_ENTITY: "validation_error",
    status.HTTP_429_TOO_MANY_REQUESTS: "rate_limited",
    status.HTTP_503_SERVICE_UNAVAILABLE: "service_unavailable",
}


def _status_to_code(status_code: int) -> str:
    mapped = _STATUS_CODE_MAP.get(status_code)
    if mapped is not None:
        return mapped
    if status_code >= 500:
        return "internal_error"
    return "http_error"


def _error_response(
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    request_id: str | None = None,
) -> JSONResponse:
    if request_id is None:
        request_id = get_request_id()

    error: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        error["details"] = details

    response_headers = dict(headers) if headers else {}
    response_headers.setdefault(REQUEST_ID_HEADER, request_id)

    return JSONResponse(
        status_code=status_code,
        content={
            "data": None,
            "error": error,
            "meta": {"request_id": request_id},
        },
        headers=response_headers,
    )


async def http_exception_handler(
    request: Request,
    exc: StarletteHTTPException,
) -> JSONResponse:
    detail = exc.detail
    if (
        isinstance(detail, dict)
        and isinstance(detail.get("code"), str)
        and isinstance(detail.get("message"), str)
    ):
        extra = {
            key: value for key, value in detail.items() if key not in ("code", "message")
        }
        return _error_response(
            exc.status_code,
            detail["code"],
            detail["message"],
            details=extra or None,
            headers=exc.headers,
        )

    message = detail if isinstance(detail, str) else str(detail)
    return _error_response(
        exc.status_code,
        _status_to_code(exc.status_code),
        message,
        headers=exc.headers,
    )


async def request_validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    # Only loc/msg/type: "input" and "ctx" echo request payload values, which
    # are personal data and must never leave the server.
    errors = [
        {
            "loc": list(error.get("loc", ())),
            "msg": error.get("msg"),
            "type": error.get("type"),
        }
        for error in exc.errors()
    ]
    return _error_response(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "validation_error",
        "Request validation failed",
        details={"errors": errors},
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = get_request_id()
    logger.exception(
        "Unhandled API error request_id=%s path=%s",
        request_id,
        request.url.path,
    )
    return _error_response(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        "internal_error",
        "Internal server error",
        request_id=request_id,
    )
