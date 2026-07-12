from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.community_contacts import CommunityContactResponse
from app.schemas.events import ApiResponse
from app.services import community_contacts as community_contacts_service

router = APIRouter(prefix="/community", tags=["community-contacts"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("/contacts", response_model=ApiResponse[list[CommunityContactResponse]])
async def list_community_contacts(
    session: DbSession,
    current_user: CurrentUser,
    community_id: Annotated[UUID | None, Query()] = None,
) -> ApiResponse[list[CommunityContactResponse]]:
    contacts = await community_contacts_service.list_community_contacts(
        session,
        current_user,
        community_id,
    )
    return ApiResponse[list[CommunityContactResponse]](data=contacts)
