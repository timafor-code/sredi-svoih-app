from typing import Any

from fastapi import APIRouter, FastAPI
from starlette.routing import BaseRoute

from app.api import auth, health


def _flatten_path_routes(routes: list[Any]) -> list[Any]:
    flattened: list[Any] = []
    for route in routes:
        if hasattr(route, "path"):
            flattened.append(route)
            continue

        effective_candidates = getattr(route, "effective_candidates", None)
        if not callable(effective_candidates):
            flattened.append(route)
            continue

        for candidate in effective_candidates():
            original_route = getattr(candidate, "original_route", None)
            if original_route is not None and hasattr(original_route, "path"):
                flattened.append(original_route)
            else:
                flattened.extend(_flatten_path_routes([candidate]))

    return flattened


def _fastapi_routes_for_path_checks(application: FastAPI) -> list[BaseRoute]:
    # FastAPI 0.139 keeps included routers as lazy nodes without `.path`.
    return _flatten_path_routes(application.router.routes)


if not getattr(FastAPI, "_sredi_path_routes_patch", False):
    FastAPI.routes = property(_fastapi_routes_for_path_checks)
    FastAPI._sredi_path_routes_patch = True


api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(health.router)
