from fastapi import APIRouter

from app.api import auth, events, health, registrations
from app.api.admin import community as admin_community
from app.api.admin import events as admin_events
from app.api.admin import invites as admin_invites
from app.api.admin import members as admin_members
from app.api.admin import registrations as admin_registrations
from app.api.admin import seating as admin_seating

api_router = APIRouter()
api_router.include_router(admin_community.router)
api_router.include_router(admin_events.router)
api_router.include_router(admin_invites.router)
api_router.include_router(admin_members.router)
api_router.include_router(admin_registrations.router)
api_router.include_router(admin_seating.router)
api_router.include_router(auth.router)
api_router.include_router(events.router)
api_router.include_router(health.router)
api_router.include_router(registrations.router)
