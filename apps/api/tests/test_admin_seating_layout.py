from __future__ import annotations

import unittest
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.seating import (
    EventSeatingAssignment,
    EventSeatingLayout,
    EventSeatingLayoutTemplate,
    EventSeatingTable,
)
from app.db.models.core import (
    AppUser,
    Community,
    CommunityMembership,
    Event,
    EventCapacityUnit,
    EventCategory,
)
from app.db.session import AsyncSessionLocal, engine
from app.schemas.admin_seating import (
    AdminSeatingAssignmentsPatchRequest,
    AdminSeatingLayoutFromTemplateRequest,
    AdminSeatingLayoutPatchRequest,
    AdminSeatingLayoutStateRequest,
    AdminSeatingTablePayload,
)
from app.services import admin_seating as seating_service


class AdminSeatingLayoutResponseTests(unittest.IsolatedAsyncioTestCase):
    def test_stable_seat_key_parts_include_disabled_part_identifier(self) -> None:
        self.assertEqual(
            seating_service._seat_key_parts("table-1:side:a:2"),
            ("table-1", "side", 2, "side:a:2"),
        )
        self.assertEqual(
            seating_service._seat_key_parts("table-1:end:b"),
            ("table-1", "end", None, "end:b"),
        )
        self.assertEqual(
            seating_service._seat_key_parts("table-1:3"),
            ("table-1", "legacy", 3, None),
        )

    def test_disabled_stable_seat_is_rejected(self) -> None:
        table = seating_service._LayoutTableSeats(3, frozenset({"side:a:1"}))
        with self.assertRaises(HTTPException) as context:
            seating_service._validate_seat_key("table-1:side:a:1", {"table-1": table})
        self.assertEqual(context.exception.detail["message"], "seat_key references a disabled seat")
        seating_service._validate_seat_key("table-1:side:a:1", {"table-1": seating_service._LayoutTableSeats(3, frozenset())})

    def test_state_request_accepts_camel_case_and_omits_assignments(self) -> None:
        request = AdminSeatingLayoutStateRequest.model_validate({
            "eventId": str(uuid4()), "capacityUnitId": str(uuid4()),
            "customTables": [], "expectedUpdatedAt": "2026-09-23T00:00:00Z",
        })
        self.assertIsNone(request.assignments)
        self.assertEqual(request.expected_updated_at, datetime(2026, 9, 23, tzinfo=UTC))

    def test_assignment_payload_accepts_protection_metadata(self) -> None:
        request = AdminSeatingAssignmentsPatchRequest.model_validate({
            "eventId": str(uuid4()),
            "capacityUnitId": str(uuid4()),
            "chairs": [{
                "type": "guest",
                "registrationId": str(uuid4()),
                "seatKey": "table-1:side:a:0",
                "locked": True,
                "placementSource": "manual",
            }],
        })

        assignment = request.chairs[0]
        self.assertTrue(assignment.locked)
        self.assertEqual(assignment.placement_source, "manual")

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
            locked=True,
            placement_source="manual",
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
            locked=False,
            placement_source="reserve",
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
        self.assertTrue(response.assignments[0].locked)
        self.assertEqual(response.assignments[0].placement_source, "manual")
        self.assertEqual(response.assignments[1].guest_label, "Saved reserve")
        self.assertEqual(response.assignments[1].assignment_type, "reserve")
        self.assertFalse(response.assignments[1].locked)
        self.assertEqual(response.assignments[1].placement_source, "reserve")

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


class AdminSeatingAtomicStatePersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_id = uuid4()
        self.actor_id = uuid4()
        self.event_id = uuid4()
        self.capacity_unit_id = uuid4()

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all([
                    Community(
                        id=self.community_id,
                        name="Atomic seating test community",
                        city="Moscow",
                        slug=f"atomic-seating-{self.community_id.hex[:18]}",
                    ),
                    AppUser(
                        id=self.actor_id,
                        account_origin="admin",
                        claim_state="claimed",
                        status="active",
                    ),
                ])
                await session.flush()
                session.add(EventCategory(
                    community_id=self.community_id,
                    slug="community",
                    title="Community",
                    color="#123456",
                    icon="*",
                    created_by=self.actor_id,
                    updated_by=self.actor_id,
                ))
                await session.flush()
                session.add_all([
                    CommunityMembership(
                        community_id=self.community_id,
                        user_id=self.actor_id,
                        role="admin",
                        status="active",
                    ),
                    Event(
                        id=self.event_id,
                        community_id=self.community_id,
                        title="Atomic seating event",
                        starts_at=datetime.now(UTC),
                        category="community",
                    ),
                    EventCapacityUnit(
                        id=self.capacity_unit_id,
                        event_id=self.event_id,
                        key="main",
                        title="Main",
                        capacity=20,
                    ),
                ])

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(
                        delete(Community).where(Community.id == self.community_id),
                    )
                    await session.execute(
                        delete(AppUser).where(AppUser.id == self.actor_id),
                    )
        finally:
            await engine.dispose()

    def _tables(self, *, table_id: str = "table-1", disabled: list[str] | None = None) -> list[dict[str, object]]:
        return [{
            "id": table_id,
            "cx": 100,
            "cy": 120,
            "w": 180,
            "h": 80,
            "angle": 0,
            "sideSeats": 2,
            "disabledSeats": disabled or [],
            "isRabbiTable": True,
        }]

    def _state_payload(
        self,
        *,
        expected_updated_at: datetime | None,
        tables: list[dict[str, object]] | None = None,
        assignments: dict[str, object] | None = None,
        seating_done: bool = False,
    ) -> AdminSeatingLayoutStateRequest:
        payload: dict[str, object] = {
            "eventId": str(self.event_id),
            "occurrenceId": None,
            "capacityUnitId": str(self.capacity_unit_id),
            "layout": "islands",
            "customTables": tables or self._tables(),
            "tableConnections": [],
            "selectedTableId": None,
            "seatingDone": seating_done,
            "activeTemplateId": None,
            "expectedUpdatedAt": expected_updated_at.isoformat() if expected_updated_at else None,
        }
        if assignments is not None:
            payload["assignments"] = assignments
        return AdminSeatingLayoutStateRequest.model_validate(payload)

    async def _save(self, payload: AdminSeatingLayoutStateRequest):
        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, self.actor_id)
            assert actor is not None
            return await seating_service.save_admin_seating_layout_state(session, actor, payload)

    async def _persisted_state(self) -> tuple[EventSeatingLayout, list[EventSeatingTable], list[EventSeatingAssignment]]:
        async with AsyncSessionLocal() as session:
            layout = await session.scalar(select(EventSeatingLayout).where(
                EventSeatingLayout.event_id == self.event_id,
                EventSeatingLayout.capacity_unit_id == self.capacity_unit_id,
            ))
            assert layout is not None
            tables = list(await session.scalars(select(EventSeatingTable).where(
                EventSeatingTable.layout_id == layout.id,
            )))
            assignments = list(await session.scalars(select(EventSeatingAssignment).where(
                EventSeatingAssignment.layout_id == layout.id,
            )))
            return layout, tables, assignments

    async def test_atomic_save_persists_final_geometry_assignments_and_seating_done(self) -> None:
        created = await self._save(self._state_payload(expected_updated_at=None))
        result = await self._save(self._state_payload(
            expected_updated_at=created.layout.updated_at,
            tables=self._tables(table_id="table-final"),
            assignments={
                "chairs": [{"type": "reserve", "seatKey": "table-final:side:a:0", "name": "R", "locked": False, "placementSource": "reserve"}],
                "pool": [{"type": "reserve", "name": "P", "locked": False, "placementSource": "reserve"}],
                "reserveIds": [],
            },
            seating_done=True,
        ))

        layout, tables, assignments = await self._persisted_state()
        self.assertTrue(layout.seating_done)
        self.assertEqual([table.client_table_id for table in tables], ["table-final"])
        self.assertEqual(sorted(item.seat_key for item in assignments if item.seat_key), ["table-final:side:a:0"])
        self.assertEqual(
            {(item.locked, item.placement_source) for item in assignments},
            {(False, "reserve")},
        )
        self.assertEqual(result.layout.updated_at, layout.updated_at)
        self.assertGreater(result.layout.updated_at.microsecond, 0)
        self.assertIsNotNone(result.assignments)
        assert result.assignments is not None
        self.assertEqual((result.assignments.placed_count, result.assignments.pooled_count, result.assignments.reserve_count), (1, 1, 2))

        # The exact timestamp returned by the server is accepted for the next write.
        round_trip = await self._save(self._state_payload(
            expected_updated_at=result.layout.updated_at,
            tables=self._tables(table_id="table-precision"),
        ))
        self.assertNotEqual(round_trip.layout.updated_at, result.layout.updated_at)

    async def test_invalid_assignment_rolls_back_geometry_assignments_and_seating_done(self) -> None:
        created = await self._save(self._state_payload(
            expected_updated_at=None,
            assignments={"chairs": [{"type": "reserve", "seatKey": "table-1:side:a:0"}], "pool": []},
            seating_done=True,
        ))
        before, before_tables, before_assignments = await self._persisted_state()

        with self.assertRaises(HTTPException) as error:
            await self._save(self._state_payload(
                expected_updated_at=created.layout.updated_at,
                tables=self._tables(table_id="replacement", disabled=["side:a:0"]),
                assignments={"chairs": [{"type": "reserve", "seatKey": "replacement:side:a:0"}], "pool": []},
                seating_done=False,
            ))
        self.assertEqual(error.exception.status_code, 422)

        after, after_tables, after_assignments = await self._persisted_state()
        self.assertEqual(after.updated_at, before.updated_at)
        self.assertEqual(after.seating_done, before.seating_done)
        self.assertEqual([table.client_table_id for table in after_tables], [table.client_table_id for table in before_tables])
        self.assertEqual([item.seat_key for item in after_assignments], [item.seat_key for item in before_assignments])

    async def test_stale_timestamp_and_null_creation_race_conflict_without_overwrite(self) -> None:
        created = await self._save(self._state_payload(expected_updated_at=None))
        current = await self._save(self._state_payload(
            expected_updated_at=created.layout.updated_at,
            tables=self._tables(table_id="table-current"),
        ))
        before, before_tables, before_assignments = await self._persisted_state()

        for expected_updated_at in (created.layout.updated_at, None):
            with self.assertRaises(HTTPException) as error:
                await self._save(self._state_payload(
                    expected_updated_at=expected_updated_at,
                    tables=self._tables(table_id="table-stale"),
                    assignments={"chairs": [], "pool": []},
                    seating_done=True,
                ))
            self.assertEqual(error.exception.status_code, 409)
            self.assertEqual(error.exception.detail["code"], "seating_layout_conflict")

        after, after_tables, after_assignments = await self._persisted_state()
        self.assertEqual(after.updated_at, before.updated_at)
        self.assertEqual(after.seating_done, before.seating_done)
        self.assertEqual([table.client_table_id for table in after_tables], [table.client_table_id for table in before_tables])
        self.assertEqual([item.seat_key for item in after_assignments], [item.seat_key for item in before_assignments])
        self.assertEqual(current.layout.updated_at, before.updated_at)

    async def test_omitted_assignments_keep_valid_rows_and_null_orphaned_seats(self) -> None:
        created = await self._save(self._state_payload(
            expected_updated_at=None,
            assignments={
                "chairs": [
                    {"type": "reserve", "seatKey": "table-1:side:a:0", "name": "valid"},
                    {"type": "reserve", "seatKey": "table-1:side:b:0", "name": "disabled"},
                ],
                "pool": [],
            },
        ))
        await self._save(self._state_payload(
            expected_updated_at=created.layout.updated_at,
            tables=self._tables(disabled=["side:b:0"]),
        ))
        _, _, assignments = await self._persisted_state()
        self.assertEqual(len(assignments), 2)
        self.assertEqual(sorted(item.seat_key for item in assignments if item.seat_key), ["table-1:side:a:0"])
        self.assertEqual(sum(item.seat_key is None for item in assignments), 1)

    async def test_legacy_layout_cleans_orphaned_seats_and_legacy_assignments_reject_disabled_seats(self) -> None:
        created = await self._save(self._state_payload(
            expected_updated_at=None,
            assignments={"chairs": [{"type": "reserve", "seatKey": "table-1:side:a:0"}], "pool": []},
        ))
        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, self.actor_id)
            assert actor is not None
            await seating_service.save_admin_seating_layout(session, actor, AdminSeatingLayoutPatchRequest.model_validate({
                "eventId": str(self.event_id), "capacityUnitId": str(self.capacity_unit_id),
                "customTables": self._tables(table_id="legacy-replacement"), "tableConnections": [],
                "seatingDone": False,
            }))
        _, _, assignments = await self._persisted_state()
        self.assertEqual(len(assignments), 1)
        self.assertIsNone(assignments[0].seat_key)

        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, self.actor_id)
            assert actor is not None
            await seating_service.save_admin_seating_layout(session, actor, AdminSeatingLayoutPatchRequest.model_validate({
                "eventId": str(self.event_id), "capacityUnitId": str(self.capacity_unit_id),
                "customTables": self._tables(disabled=["side:a:0"]), "tableConnections": [],
                "seatingDone": False,
            }))
            with self.assertRaises(HTTPException) as error:
                await seating_service.save_admin_seating_assignments(session, actor, AdminSeatingAssignmentsPatchRequest.model_validate({
                    "eventId": str(self.event_id), "capacityUnitId": str(self.capacity_unit_id),
                    "chairs": [{"type": "reserve", "seatKey": "table-1:side:a:0"}], "pool": [],
                }))
        self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(created.layout.id, (await self._persisted_state())[0].id)


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
