SENSITIVE_LOG_FIELDS = frozenset(
    {
        "email",
        "phone",
        "name",
        "invite_code",
        "registration_comment",
        "jwt",
        "refresh_token",
        "password_reset_code",
    }
)


def mask_sensitive_value(value: str | None) -> str | None:
    if value is None:
        return None
    if len(value) <= 4:
        return "****"
    return f"{value[:2]}***{value[-2:]}"
