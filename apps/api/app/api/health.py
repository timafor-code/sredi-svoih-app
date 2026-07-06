from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.config import get_settings

router = APIRouter(tags=["system"])


class HealthResponse(BaseModel):
    status: str
    service: str


class VersionResponse(BaseModel):
    service: str
    api_version: str
    environment: str
    git_sha: str | None
    checked_at: datetime


@router.get("/health", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(status="ok", service=settings.app_name)


@router.get("/version", response_model=VersionResponse)
async def get_version() -> VersionResponse:
    settings = get_settings()
    return VersionResponse(
        service=settings.app_name,
        api_version=settings.api_version,
        environment=settings.app_env,
        git_sha=settings.git_sha,
        checked_at=datetime.now(timezone.utc),
    )
