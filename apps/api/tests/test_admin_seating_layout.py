from __future__ import annotations

import unittest
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.seating import (
    EventSeatingAssignment,
    EventSeatingLayout,
    EventSeatingLayoutTemplate,
    EventSeatingTable,
)
from app.schemas.admin_seating import (
    AdminSeatingLayoutFromTemplateRequest,
    AdminSeatingTablePayload,
)
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

    async def test_layout_envelope_serializes_disabled_seat_parts(self) -> None:
        now = datetime.now(UTC)
        layout_id = uuid4()
        layout = EventSeatingLayout(
            id=layout_id,
            community_id=uuid4(),
            event_id=uuid4(),
            occurrence_id=None,
            capacity_unit_id=uuid4(),
            template_id=None,
            title=None,
            capacity_limit_snapshot=None,
            seating_done=False,
            created_by=uuid4(),
            created_at=now,
            updated_at=now,
        )
        table = EventSeatingTable(
            id=uuid4(),
            layout_id=layout_id,
            client_table_id="table-1",
            cx=Decimal("100"),
            cy=Decimal("120"),
            w=Decimal("180"),
            h=Decimal("80"),
            angle=0,
            long_side_seats=2,
            disabled_seat_parts=["side:a:2", "end:b"],
            is_rabbi_table=True,
            sort_order=0,
            created_at=now,
            updated_at=now,
        )
        session = AsyncMock(spec=AsyncSession)
        session.scalars.side_effect = [[table], [], []]

        response = await seating_service._layout_envelope_response(session, layout)

        self.assertEqual(response.tables[0].disabled_seat_parts, ["side:a:2", "end:b"])


class AdminSeatingDisabledSeatPartsTests(unittest.TestCase):
    def test_payload_accepts_disabled_seats_and_deduplicates_stably(self) -> None:
        payload = AdminSeatingTablePayload.model_validate(
            {
                "id": "table-1",
                "cx": 100,
                "cy": 120,
                "w": 180,
                "h": 80,
                "disabledSeats": [" side:a:0 ", "end:b", "side:a:0", "end:b"],
            },
        )

        self.assertEqual(payload.disabled_seat_parts, ["side:a:0", "end:b"])

    def test_payload_rejects_invalid_disabled_seat_parts(self) -> None:
        with self.assertRaises(ValidationError):
            AdminSeatingTablePayload.model_validate(
                {
                    "id": "table-1",
                    "cx": 100,
                    "cy": 120,
                    "w": 180,
                    "h": 80,
                    "disabledSeats": ["side:a:3"],
                },
            )

    def test_third_side_slots_remain_valid_with_two_long_side_seats(self) -> None:
        payload = AdminSeatingTablePayload.model_validate(
            {
                "id": "table-1",
                "cx": 100,
                "cy": 120,
                "w": 180,
                "h": 80,
                "sideSeats": 2,
                "disabledSeats": ["side:a:2", "side:b:2"],
            },
        )

        self.assertEqual(payload.disabled_seat_parts, ["side:a:2", "side:b:2"])

    def test_add_tables_transfers_normalized_disabled_seat_parts(self) -> None:
        payload = AdminSeatingTablePayload.model_validate(
            {
                "id": "table-1",
                "cx": 100,
                "cy": 120,
                "w": 180,
                "h": 80,
                "disabledSeats": ["side:a:0", "side:a:0", "end:b"],
            },
        )
        session = MagicMock()

        seating_service._add_tables(session, layout_id=uuid4(), tables=[payload])

        created = session.add.call_args.args[0]
        self.assertIsInstance(created, EventSeatingTable)
        self.assertEqual(created.disabled_seat_parts, ["side:a:0", "end:b"])

    def test_snapshot_serializes_disabled_seats(self) -> None:
        table = EventSeatingTable(
            client_table_id="table-1",
            cx=Decimal("100"),
            cy=Decimal("120"),
            w=Decimal("180"),
            h=Decimal("80"),
            angle=0,
            long_side_seats=2,
            disabled_seat_parts=["side:a:2", "end:b"],
            is_rabbi_table=True,
            sort_order=0,
        )

        snapshot = seating_service._snapshot_from_geometry_rows([table], [])

        self.assertEqual(
            snapshot["tables"][0]["disabledSeats"],  # type: ignore[index]
            ["side:a:2", "end:b"],
        )

    def test_template_snapshot_disabled_seats_parse_back_into_payload(self) -> None:
        template = EventSeatingLayoutTemplate(
            community_id=uuid4(),
            title="Disabled seats",
            snapshot={
                "tables": [
                    {
                        "id": "table-1",
                        "cx": 100,
                        "cy": 120,
                        "w": 180,
                        "h": 80,
                        "sideSeats": 2,
                        "isRabbiTable": True,
                        "disabledSeats": ["side:a:2", "end:b"],
                    },
                ],
                "connections": [],
            },
            is_builtin=False,
            is_active=True,
        )

        tables, _ = seating_service._template_geometry(template)

        self.assertEqual(tables[0].disabled_seat_parts, ["side:a:2", "end:b"])


class AdminSeatingLayoutSaveTemplateReferenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_template_id_is_cleared_during_layout_save(self) -> None:
        session = AsyncMock(spec=AsyncSession)

        template_id = await seating_service._resolve_template_reference_for_layout_save(
            session,
            community_id=uuid4(),
            active_template_id="not-a-uuid",
        )

        self.assertIsNone(template_id)
        session.scalar.assert_not_awaited()

    async def test_unavailable_template_is_cleared_with_active_community_filter(self) -> None:
        community_id = uuid4()
        template_id = uuid4()
        session = AsyncMock(spec=AsyncSession)
        session.scalar.return_value = None

        resolved_template_id = await seating_service._resolve_template_reference_for_layout_save(
            session,
            community_id=community_id,
            active_template_id=str(template_id),
        )

        self.assertIsNone(resolved_template_id)
        statement = session.scalar.await_args.args[0]
        statement_sql = str(statement)
        self.assertIn("event_seating_layout_templates.id", statement_sql)
        self.assertIn("event_seating_layout_templates.community_id", statement_sql)
        self.assertIn("event_seating_layout_templates.is_active IS true", statement_sql)

    async def test_active_community_template_is_kept_during_layout_save(self) -> None:
        expected_template_id = uuid4()
        session = AsyncMock(spec=AsyncSession)
        session.scalar.return_value = expected_template_id

        template_id = await seating_service._resolve_template_reference_for_layout_save(
            session,
            community_id=uuid4(),
            active_template_id=str(expected_template_id),
        )

        self.assertEqual(template_id, expected_template_id)

    async def test_create_from_inactive_or_deleted_template_raises_not_found(self) -> None:
        session = AsyncMock(spec=AsyncSession)
        session.in_transaction.return_value = True
        session.scalar.return_value = None
        community_id = uuid4()
        payload = AdminSeatingLayoutFromTemplateRequest(
            event_id=uuid4(),
            capacity_unit_id=uuid4(),
            template_id=uuid4(),
        )

        with (
            patch.object(
                seating_service,
                "_resolve_slot",
                new=AsyncMock(return_value=MagicMock(community_id=community_id)),
            ),
            patch.object(
                seating_service,
                "resolve_manageable_community_ids",
                new=AsyncMock(return_value=[community_id]),
            ),
        ):
            with self.assertRaises(HTTPException) as error:
                await seating_service.create_admin_seating_layout_from_template(
                    session,
                    MagicMock(),
                    payload,
                )

        self.assertEqual(error.exception.status_code, 404)
        statement = session.scalar.await_args.args[0]
        self.assertIn("event_seating_layout_templates.is_active IS true", str(statement))


if __name__ == "__main__":
    unittest.main()
