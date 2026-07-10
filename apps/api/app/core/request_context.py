from __future__ import annotations

from contextvars import ContextVar
from uuid import UUID, uuid4

from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "X-Request-ID"
_REQUEST_ID_HEADER_BYTES = REQUEST_ID_HEADER.lower().encode("ascii")

_request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)


def get_request_id() -> str:
    request_id = _request_id_var.get()
    if request_id is None:
        return str(uuid4())
    return request_id


def _resolve_request_id(header_value: str | None) -> str:
    if header_value is not None:
        try:
            return str(UUID(header_value))
        except ValueError:
            pass
    return str(uuid4())


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming_value: str | None = None
        for name, value in scope.get("headers", []):
            if name == _REQUEST_ID_HEADER_BYTES:
                incoming_value = value.decode("latin-1")
                break

        request_id = _resolve_request_id(incoming_value)
        # No reset: unhandled exceptions unwind past this middleware before the
        # outermost 500 handler runs, and that handler still needs the value.
        # Each request runs in its own task context, so nothing leaks across
        # requests.
        _request_id_var.set(request_id)
        request_id_bytes = request_id.encode("ascii")

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                if not any(name == _REQUEST_ID_HEADER_BYTES for name, _ in headers):
                    headers.append((_REQUEST_ID_HEADER_BYTES, request_id_bytes))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_request_id)
