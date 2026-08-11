from __future__ import annotations

import unittest
from datetime import UTC, datetime
from unittest.mock import AsyncMock
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.seating import EventSeatingAssignment, EventSeatingLayout
from app.services import admin_seating as seating_service


class AdminSeatingLayoutResponseTests(unittest.IsolatedAsyncioTestCase):
    async def test_layout_envelope_serializes_saved_assignments(self) -> None:
        now = datetime.now(UTC)
        layout_id = uuid4()
        layout = EventSeatingLayout(
            id=layout_id,
            community_id=uuid4(),
            event_id=uuid4(),
            occurrence_id=None,
            capacity_unit_id=uuid4(),
            template_id=None,
            title="Saved layout",
            capacity_limit_snapshot=12,
            seating_done=False,
            created_by=uuid4(),
            created_at=now,
            updated_at=now,
        )
        guest_registration_id = uuid4()
        guest_assignment = EventSeatingAssignment(
            id=uuid4(),
            layout_id=layout_id,
            registration_id=guest_registration_id,
            guest_index=0,
            user_id=uuid4(),
            seat_key="table-1:side:a:0",
            guest_label="Saved guest",
            guest_initials="SG",
            assignment_type="guest",
            created_by=uuid4(),
            created_at=now,
            updated_at=now,
        )
        reserve_assignment = EventSeatingAssignment(
            id=uuid4(),
            layout_id=layout_id,
            registration_id=None,
            guest_index=None,
            user_id=None,
            seat_key=None,
            guest_label="Saved reserve",
            guest_initials="SR",
            assignment_type="reserve",
            created_by=uuid4(),
            created_at=now,
            updated_at=now,
        )
        session = AsyncMock(spec=AsyncSession)
        session.scalars.side_effect = [[], [], [guest_assignment, reserve_assignment]]

        response = await seating_service._layout_envelope_response(session, layout)

        self.assertEqual(response.layout.id, layout_id)
        self.assertEqual(len(response.assignments), 2)
        self.assertEqual(response.assignments[0].registration_id, guest_registration_id)
        self.assertEqual(response.assignments[0].guest_label, "Saved guest")
        self.assertEqual(response.assignments[0].assignment_type, "guest")
        self.assertEqual(response.assignments[1].guest_label, "Saved reserve")
        self.assertEqual(response.assignments[1].assignment_type, "reserve")


if __name__ == "__main__":
    unittest.main()
