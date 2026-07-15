from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import Settings

MAX_EXPO_SEND_MESSAGES = 100
MAX_EXPO_RECEIPT_IDS = 1000
_MAX_RETRY_ATTEMPTS = 3
_INITIAL_RETRY_DELAY_SECONDS = 0.25


class ExpoPushRetryableError(Exception):
    """A transport or transient Expo response that can be retried safely."""


class ExpoPushPermanentError(Exception):
    """A permanent HTTP configuration or payload failure."""


class ExpoPushProtocolError(Exception):
    """An Expo response that cannot safely be interpreted."""


@dataclass(frozen=True)
class ExpoPushMessage:
    expo_push_token: str
    title: str
    body: str
    data: dict[str, Any]


@dataclass(frozen=True)
class ExpoPushTicket:
    status: str
    ticket_id: str | None = None
    error_code: str | None = None


@dataclass(frozen=True)
class ExpoPushReceipt:
    status: str
    error_code: str | None = None


class ExpoPushClient:
    """Small, privacy-safe adapter for the Expo Push HTTP API."""

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._settings = settings
        self._client = httpx.AsyncClient(
            timeout=settings.api_push_request_timeout_seconds,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> ExpoPushClient:
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.aclose()

    async def send(self, messages: list[ExpoPushMessage]) -> list[ExpoPushTicket]:
        if not messages or len(messages) > MAX_EXPO_SEND_MESSAGES:
            raise ValueError("Expo send batches must contain between 1 and 100 messages")

        payload = [
            {
                "to": message.expo_push_token,
                "title": message.title,
                "body": message.body,
                "data": message.data,
            }
            for message in messages
        ]
        response_data = await self._post_json(
            self._settings.api_expo_push_send_url,
            payload,
        )
        if not isinstance(response_data, list) or len(response_data) != len(messages):
            raise ExpoPushProtocolError("Expo send response had an invalid shape")

        return [self._parse_ticket(item) for item in response_data]

    async def get_receipts(
        self,
        ticket_ids: list[str],
    ) -> dict[str, ExpoPushReceipt]:
        if not ticket_ids or len(ticket_ids) > MAX_EXPO_RECEIPT_IDS:
            raise ValueError("Expo receipt batches must contain between 1 and 1000 ids")

        response_data = await self._post_json(
            self._settings.api_expo_push_receipts_url,
            {"ids": ticket_ids},
        )
        if not isinstance(response_data, dict):
            raise ExpoPushProtocolError("Expo receipt response had an invalid shape")

        receipts: dict[str, ExpoPushReceipt] = {}
        for ticket_id in ticket_ids:
            item = response_data.get(ticket_id)
            if item is None:
                continue
            receipts[ticket_id] = self._parse_receipt(item)
        return receipts

    async def _post_json(self, url: str, payload: object) -> object:
        headers = {"Accept": "application/json"}
        if self._settings.api_expo_push_access_token:
            headers["Authorization"] = (
                f"Bearer {self._settings.api_expo_push_access_token}"
            )

        for attempt in range(_MAX_RETRY_ATTEMPTS):
            try:
                response = await self._client.post(url, json=payload, headers=headers)
            except httpx.RequestError as exc:
                if attempt + 1 == _MAX_RETRY_ATTEMPTS:
                    raise ExpoPushRetryableError(
                        "Expo Push request could not be completed",
                    ) from exc
                await self._backoff(attempt)
                continue

            if response.status_code == 429 or response.status_code >= 500:
                if attempt + 1 == _MAX_RETRY_ATTEMPTS:
                    raise ExpoPushRetryableError("Expo Push is temporarily unavailable")
                await self._backoff(attempt)
                continue

            if response.status_code >= 400:
                raise ExpoPushPermanentError("Expo Push rejected the request")

            try:
                body = response.json()
            except ValueError as exc:
                raise ExpoPushProtocolError(
                    "Expo Push response was not valid JSON",
                ) from exc

            if not isinstance(body, dict) or "data" not in body:
                raise ExpoPushProtocolError("Expo Push response had an invalid shape")
            return body["data"]

        raise AssertionError("Expo retry loop must return or raise")

    @staticmethod
    async def _backoff(attempt: int) -> None:
        delay = min(_INITIAL_RETRY_DELAY_SECONDS * (2**attempt), 2.0)
        await asyncio.sleep(delay)

    @staticmethod
    def _parse_ticket(item: object) -> ExpoPushTicket:
        if not isinstance(item, dict) or not isinstance(item.get("status"), str):
            raise ExpoPushProtocolError("Expo send response had an invalid ticket")

        status = item["status"]
        if status == "ok":
            ticket_id = item.get("id")
            if not isinstance(ticket_id, str) or not ticket_id.strip():
                raise ExpoPushProtocolError("Expo send response omitted a ticket id")
            return ExpoPushTicket(status="ok", ticket_id=ticket_id)
        if status == "error":
            return ExpoPushTicket(
                status="error",
                error_code=ExpoPushClient._extract_error_code(item),
            )
        raise ExpoPushProtocolError("Expo send response had an unknown ticket status")

    @staticmethod
    def _parse_receipt(item: object) -> ExpoPushReceipt:
        if not isinstance(item, dict) or not isinstance(item.get("status"), str):
            raise ExpoPushProtocolError("Expo receipt response had an invalid receipt")

        status = item["status"]
        if status == "ok":
            return ExpoPushReceipt(status="ok")
        if status == "error":
            return ExpoPushReceipt(
                status="error",
                error_code=ExpoPushClient._extract_error_code(item),
            )
        raise ExpoPushProtocolError("Expo receipt response had an unknown receipt status")

    @staticmethod
    def _extract_error_code(item: dict[str, object]) -> str | None:
        details = item.get("details")
        if isinstance(details, dict):
            error_code = details.get("error")
            if isinstance(error_code, str):
                return error_code
        return None
