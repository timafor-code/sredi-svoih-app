from fastapi import APIRouter

from app.api import auth, events, health, registrations
from app.api.admin import community as admin_community
from app.api.admin import events as admin_events
from app.api.admin import registrations as admin_registrations

api_router = APIRouter()
api_router.include_router(admin_community.router)
api_router.include_router(admin_events.router)
api_router.include_router(admin_registrations.router)
api_router.include_router(auth.router)
api_router.include_router(events.router)
api_router.include_router(health.router)
api_router.include_router(registrations.router)
