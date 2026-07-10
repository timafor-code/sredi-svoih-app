from __future__ import annotations

from typing import Any, Generic, TypeVar
from uuid import UUID

from pydantic import BaseModel, Field

from app.core.request_context import get_request_id

DataT = TypeVar("DataT")


def _current_request_id() -> UUID:
    return UUID(get_request_id())


class PaginationMeta(BaseModel):
    limit: int
    next_cursor: str | None
    has_more: bool


class ResponseMeta(BaseModel):
    request_id: UUID = Field(default_factory=_current_request_id)


class ListResponseMeta(ResponseMeta):
    pagination: PaginationMeta


class ApiResponse(BaseModel, Generic[DataT]):
    data: DataT
    error: None = None
    meta: ResponseMeta = Field(default_factory=ResponseMeta)


class PaginatedApiResponse(BaseModel, Generic[DataT]):
    data: list[DataT]
    error: None = None
    meta: ListResponseMeta


class ApiError(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class ApiErrorResponse(BaseModel):
    data: None = None
    error: ApiError
    meta: ResponseMeta = Field(default_factory=ResponseMeta)
