from fastapi import APIRouter

from app.api import auth, events, health

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(events.router)
api_router.include_router(health.router)
