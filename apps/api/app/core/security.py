SENSITIVE_LOG_FIELDS = frozenset(
    {
        "email",
        "phone",
        "name",
        "invite_code",
        "registration_comment",
        "jwt",
        "code",
        "token",
        "refresh_token",
        "password_reset_code",
        "password_reset_token",
        "password_reset_link",
        "email_verification_code",
        "email_verification_token",
        "email_verification_link",
        "verification_code",
        "verification_token",
        "verification_link",
        "set_password_code",
        "set_password_token",
        "set_password_link",
    }
)


def mask_sensitive_value(value: str | None) -> str | None:
    if value is None:
        return None
    if len(value) <= 4:
        return "****"
    return f"{value[:2]}***{value[-2:]}"
