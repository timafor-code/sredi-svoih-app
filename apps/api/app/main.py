from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.router import api_router
from app.core.config import get_settings
from app.core.errors import (
    http_exception_handler,
    request_validation_exception_handler,
    unhandled_exception_handler,
)
from app.core.logging import configure_logging
from app.core.request_context import RequestContextMiddleware

_CORS_ALLOWED_HEADERS = ["Authorization", "Content-Type", "X-Request-ID"]
_CORS_EXPOSED_HEADERS = ["X-Request-ID"]
_CORS_ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    application = FastAPI(
        title=settings.app_name,
        version=settings.api_version,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_headers=_CORS_ALLOWED_HEADERS,
        allow_methods=_CORS_ALLOWED_METHODS,
        allow_origins=settings.cors_allowed_origins,
        expose_headers=_CORS_EXPOSED_HEADERS,
    )
    # Added after CORSMiddleware so it wraps CORS and runs first on requests.
    application.add_middleware(RequestContextMiddleware)
    application.include_router(api_router)
    application.add_exception_handler(StarletteHTTPException, http_exception_handler)
    application.add_exception_handler(
        RequestValidationError,
        request_validation_exception_handler,
    )
    application.add_exception_handler(Exception, unhandled_exception_handler)

    return application


app = create_app()
