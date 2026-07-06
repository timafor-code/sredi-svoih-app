from __future__ import annotations

from collections import defaultdict, deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.core.config import Settings, get_settings


@dataclass(frozen=True)
class AuthEmailRateLimitConfig:
    window_seconds: int
    max_attempts: int


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    remaining: int
    retry_after_seconds: int
    reset_at: datetime


def get_auth_email_rate_limit_config(
    settings: Settings | None = None,
) -> AuthEmailRateLimitConfig:
    resolved_settings = settings or get_settings()
    return AuthEmailRateLimitConfig(
        window_seconds=resolved_settings.api_auth_email_rate_limit_window_seconds,
        max_attempts=resolved_settings.api_auth_email_rate_limit_max_attempts,
    )


def _utcnow() -> datetime:
    return datetime.now(UTC)


class InMemoryAuthEmailRateLimiter:
    """Local helper only; replace with persistent/distributed storage if needed."""

    def __init__(
        self,
        config: AuthEmailRateLimitConfig | None = None,
        *,
        now_fn: Callable[[], datetime] = _utcnow,
    ) -> None:
        self._config = config or get_auth_email_rate_limit_config()
        self._now_fn = now_fn
        self._attempts: dict[str, deque[datetime]] = defaultdict(deque)

    def check(self, key: str) -> RateLimitDecision:
        now = self._now_fn()
        attempts = self._active_attempts(key, now)
        return self._decision(attempts, now)

    def consume(self, key: str) -> RateLimitDecision:
        now = self._now_fn()
        attempts = self._active_attempts(key, now)
        if len(attempts) >= self._config.max_attempts:
            return self._decision(attempts, now)

        attempts.append(now)
        return RateLimitDecision(
            allowed=True,
            remaining=max(self._config.max_attempts - len(attempts), 0),
            retry_after_seconds=0,
            reset_at=attempts[0] + timedelta(seconds=self._config.window_seconds),
        )

    def clear(self, key: str) -> None:
        self._attempts.pop(key, None)

    def _active_attempts(self, key: str, now: datetime) -> deque[datetime]:
        if not key:
            raise ValueError("rate limit key must not be empty")

        attempts = self._attempts[key]
        cutoff = now - timedelta(seconds=self._config.window_seconds)
        while attempts and attempts[0] <= cutoff:
            attempts.popleft()

        return attempts

    def _decision(self, attempts: deque[datetime], now: datetime) -> RateLimitDecision:
        remaining = max(self._config.max_attempts - len(attempts), 0)
        if remaining > 0:
            return RateLimitDecision(
                allowed=True,
                remaining=remaining,
                retry_after_seconds=0,
                reset_at=now + timedelta(seconds=self._config.window_seconds),
            )

        oldest = attempts[0]
        reset_at = oldest + timedelta(seconds=self._config.window_seconds)
        retry_after_seconds = max(int((reset_at - now).total_seconds()), 1)
        return RateLimitDecision(
            allowed=False,
            remaining=0,
            retry_after_seconds=retry_after_seconds,
            reset_at=reset_at,
        )
