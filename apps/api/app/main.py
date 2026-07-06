from fastapi import FastAPI

from app.api.router import api_router
from app.core.config import get_settings
from app.core.errors import unhandled_exception_handler
from app.core.logging import configure_logging


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    application = FastAPI(
        title=settings.app_name,
        version=settings.api_version,
    )
    application.include_router(api_router)
    application.add_exception_handler(Exception, unhandled_exception_handler)

    return application


app = create_app()
