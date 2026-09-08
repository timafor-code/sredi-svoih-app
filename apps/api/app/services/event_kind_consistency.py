from __future__ import annotations


_JEWISH_CATEGORY_EVENT_KINDS = {
    "shabbat": "shabbat",
    "holiday": "holiday",
}
_JEWISH_EVENT_KINDS = frozenset(_JEWISH_CATEGORY_EVENT_KINDS.values())


def get_consistent_event_kind(category: str, current_event_kind: str) -> str:
    """Apply the narrow category/event-kind invariant for Jewish calendar events."""
    category_event_kind = _JEWISH_CATEGORY_EVENT_KINDS.get(category)
    if category_event_kind is not None:
        return category_event_kind

    if current_event_kind in _JEWISH_EVENT_KINDS:
        return "single"

    return current_event_kind
