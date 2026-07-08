from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.errors import unhandled_exception_handler
from app.core.logging import configure_logging

_CORS_ALLOWED_HEADERS = ["Authorization", "Content-Type"]
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
    )
    application.include_router(api_router)
    application.add_exception_handler(Exception, unhandled_exception_handler)

    return application


app = create_app()
