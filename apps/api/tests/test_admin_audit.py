from __future__ import annotations

import inspect as python_inspect
import unittest
from unittest.mock import MagicMock, patch
from uuid import uuid4

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import delete, func, inspect, or_, select, text
from sqlalchemy.dialects.postgresql import JSON, JSONB
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.audit import AdminEventAuditEntry
from app.db.models.core import AppUser
from app.db.session import AsyncSessionLocal, engine
from app.services import admin_audit as service


class AdminEventAuditTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.actor_user_id = uuid4()
        self.event_id = uuid4()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    AppUser(
                        id=self.actor_user_id,
                        account_origin="admin",
                        claim_state="claimed",
                        status="active",
                    ),
                )

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(
                        delete(AdminEventAuditEntry).where(
                            or_(
                                AdminEventAuditEntry.actor_user_id
                                == self.actor_user_id,
                                AdminEventAuditEntry.event_id == self.event_id,
                            ),
                        ),
                    )
                    await session.execute(
                        delete(AppUser).where(AppUser.id == self.actor_user_id),
                    )
        finally:
            await engine.dispose()

    async def _count_rows(self) -> int:
        async with AsyncSessionLocal() as session:
            count = await session.scalar(
                select(func.count())
                .select_from(AdminEventAuditEntry)
                .where(AdminEventAuditEntry.event_id == self.event_id),
            )
        return int(count or 0)

    async def _assert_database_rejects(self, entry: AdminEventAuditEntry) -> None:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                with self.assertRaises(IntegrityError):
                    async with session.begin_nested():
                        session.add(entry)
                        await session.flush()

    async def test_schema_is_exact_pii_free_and_indexed(self) -> None:
        expected_columns = {
            "id",
            "actor_user_id",
            "event_id",
            "action",
            "old_state",
            "new_state",
            "created_at",
        }
        model_columns = inspect(AdminEventAuditEntry).columns
        self.assertEqual(set(model_columns.keys()), expected_columns)
        self.assertTrue(model_columns["actor_user_id"].nullable)
        self.assertTrue(
            all(
                not column.nullable
                for name, column in model_columns.items()
                if name != "actor_user_id"
            ),
        )
        self.assertTrue(
            all(not isinstance(column.type, (JSON, JSONB)) for column in model_columns),
        )

        forbidden_names = {
            "email",
            "phone",
            "name",
            "request",
            "request_body",
            "metadata",
            "ip",
            "ip_address",
            "user_agent",
        }
        self.assertTrue(forbidden_names.isdisjoint(model_columns.keys()))

        async with engine.connect() as connection:
            database_schema = await connection.run_sync(
                lambda sync_connection: {
                    "tables": inspect(sync_connection).get_table_names(),
                    "columns": inspect(sync_connection).get_columns(
                        "admin_event_audit_entries",
                    ),
                    "constraints": inspect(sync_connection).get_check_constraints(
                        "admin_event_audit_entries",
                    ),
                    "indexes": inspect(sync_connection).get_indexes(
                        "admin_event_audit_entries",
                    ),
                    "foreign_keys": inspect(sync_connection).get_foreign_keys(
                        "admin_event_audit_entries",
                    ),
                },
            )

        self.assertIn("admin_event_audit_entries", database_schema["tables"])
        self.assertEqual(
            {column["name"] for column in database_schema["columns"]},
            expected_columns,
        )
        nullable_by_name = {
            column["name"]: column["nullable"]
            for column in database_schema["columns"]
        }
        self.assertTrue(nullable_by_name["actor_user_id"])
        self.assertTrue(
            all(
                not nullable
                for name, nullable in nullable_by_name.items()
                if name != "actor_user_id"
            ),
        )
        self.assertEqual(len(database_schema["foreign_keys"]), 1)
        actor_fk = database_schema["foreign_keys"][0]
        self.assertEqual(
            actor_fk["name"],
            "admin_event_audit_entries_actor_user_id_fkey",
        )
        self.assertEqual(actor_fk["constrained_columns"], ["actor_user_id"])
        self.assertEqual(actor_fk["referred_table"], "app_users")
        self.assertEqual(actor_fk["referred_columns"], ["id"])
        self.assertEqual(actor_fk["options"].get("ondelete"), "SET NULL")
        self.assertEqual(
            {constraint["name"] for constraint in database_schema["constraints"]},
            {
                "admin_event_audit_entries_action_check",
                "admin_event_audit_entries_old_state_check",
                "admin_event_audit_entries_new_state_check",
                "admin_event_audit_entries_state_changed_check",
            },
        )
        self.assertEqual(
            {
                index["name"]: tuple(index["column_names"])
                for index in database_schema["indexes"]
            },
            {
                "admin_event_audit_entries_actor_user_id_idx": ("actor_user_id",),
                "admin_event_audit_entries_event_id_idx": ("event_id",),
                "admin_event_audit_entries_created_at_idx": ("created_at",),
                "admin_event_audit_entries_event_created_at_idx": (
                    "event_id",
                    "created_at",
                ),
            },
        )

    async def test_database_constraints_accept_only_supported_values(self) -> None:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        AdminEventAuditEntry(
                            actor_user_id=self.actor_user_id,
                            event_id=self.event_id,
                            action=service.EVENT_WEB_VISIBILITY_CHANGED,
                            old_state="disabled",
                            new_state="unlisted",
                        ),
                        AdminEventAuditEntry(
                            actor_user_id=self.actor_user_id,
                            event_id=self.event_id,
                            action=service.EVENT_WEB_VISIBILITY_CHANGED,
                            old_state="unlisted",
                            new_state="listed",
                        ),
                        AdminEventAuditEntry(
                            actor_user_id=self.actor_user_id,
                            event_id=self.event_id,
                            action=service.EVENT_WEB_VISIBILITY_CHANGED,
                            old_state="listed",
                            new_state="disabled",
                        ),
                    ],
                )
                await session.flush()

        invalid_entries = [
            AdminEventAuditEntry(
                actor_user_id=self.actor_user_id,
                event_id=self.event_id,
                action="unsupported_action",
                old_state="disabled",
                new_state="unlisted",
            ),
            AdminEventAuditEntry(
                actor_user_id=self.actor_user_id,
                event_id=self.event_id,
                action=service.EVENT_WEB_VISIBILITY_CHANGED,
                old_state="invalid",
                new_state="unlisted",
            ),
            AdminEventAuditEntry(
                actor_user_id=self.actor_user_id,
                event_id=self.event_id,
                action=service.EVENT_WEB_VISIBILITY_CHANGED,
                old_state="disabled",
                new_state="invalid",
            ),
            AdminEventAuditEntry(
                actor_user_id=self.actor_user_id,
                event_id=self.event_id,
                action=service.EVENT_WEB_VISIBILITY_CHANGED,
                old_state="unlisted",
                new_state="unlisted",
            ),
        ]
        for entry in invalid_entries:
            await self._assert_database_rejects(entry)

    async def test_service_records_supported_transitions_and_technical_ids(self) -> None:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                transitions = [
                    ("disabled", "unlisted"),
                    ("unlisted", "disabled"),
                    ("unlisted", "listed"),
                ]
                entries = []
                for old_visibility, new_visibility in transitions:
                    entries.append(
                        await service.record_event_web_visibility_change(
                            session,
                            actor_user_id=self.actor_user_id,
                            event_id=self.event_id,
                            old_visibility=old_visibility,
                            new_visibility=new_visibility,
                        ),
                    )

        self.assertEqual(len(entries), 3)
        for entry, (old_visibility, new_visibility) in zip(entries, transitions):
            self.assertIsNotNone(entry)
            self.assertEqual(entry.actor_user_id, self.actor_user_id)
            self.assertEqual(entry.event_id, self.event_id)
            self.assertEqual(entry.action, service.EVENT_WEB_VISIBILITY_CHANGED)
            self.assertEqual(entry.old_state, old_visibility)
            self.assertEqual(entry.new_state, new_visibility)
            self.assertIsNotNone(entry.created_at)
        self.assertEqual(await self._count_rows(), 3)

    async def test_same_state_is_idempotent_and_creates_no_row(self) -> None:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                entry = await service.record_event_web_visibility_change(
                    session,
                    actor_user_id=self.actor_user_id,
                    event_id=self.event_id,
                    old_visibility="disabled",
                    new_visibility="disabled",
                )
        self.assertIsNone(entry)
        self.assertEqual(await self._count_rows(), 0)

    async def test_caller_rollback_removes_flushed_row(self) -> None:
        async with AsyncSessionLocal() as session:
            entry = await service.record_event_web_visibility_change(
                session,
                actor_user_id=self.actor_user_id,
                event_id=self.event_id,
                old_visibility="disabled",
                new_visibility="unlisted",
            )
            self.assertIsNotNone(entry.id)
            self.assertEqual(
                await session.scalar(
                    select(func.count())
                    .select_from(AdminEventAuditEntry)
                    .where(AdminEventAuditEntry.event_id == self.event_id),
                ),
                1,
            )
            self.assertEqual(await self._count_rows(), 0)
            await session.rollback()
        self.assertEqual(await self._count_rows(), 0)

    async def test_caller_commit_persists_flushed_row(self) -> None:
        async with AsyncSessionLocal() as session:
            await service.record_event_web_visibility_change(
                session,
                actor_user_id=self.actor_user_id,
                event_id=self.event_id,
                old_visibility="unlisted",
                new_visibility="disabled",
            )
            self.assertEqual(await self._count_rows(), 0)
            await session.commit()
        self.assertEqual(await self._count_rows(), 1)

    async def test_invalid_state_is_rejected_before_database_write(self) -> None:
        session = MagicMock(spec=AsyncSession)
        with self.assertRaisesRegex(ValueError, "Invalid old web visibility"):
            await service.record_event_web_visibility_change(
                session,
                actor_user_id=self.actor_user_id,
                event_id=self.event_id,
                old_visibility="invalid",
                new_visibility="disabled",
            )
        with self.assertRaisesRegex(ValueError, "Invalid new web visibility"):
            await service.record_event_web_visibility_change(
                session,
                actor_user_id=self.actor_user_id,
                event_id=self.event_id,
                old_visibility="disabled",
                new_visibility="invalid",
            )
        session.add.assert_not_called()
        session.flush.assert_not_awaited()

    def test_service_signature_and_model_repr_are_pii_free(self) -> None:
        signature = python_inspect.signature(
            service.record_event_web_visibility_change,
        )
        self.assertEqual(
            set(signature.parameters),
            {
                "session",
                "actor_user_id",
                "event_id",
                "old_visibility",
                "new_visibility",
            },
        )
        entry = AdminEventAuditEntry(
            actor_user_id=self.actor_user_id,
            event_id=self.event_id,
            action=service.EVENT_WEB_VISIBILITY_CHANGED,
            old_state="disabled",
            new_state="unlisted",
        )
        representation = repr(entry).lower()
        self.assertNotIn("email", representation)
        self.assertNotIn("phone", representation)
        service_source = python_inspect.getsource(service)
        self.assertNotIn("logging", service_source)
        self.assertNotIn("logger", service_source)

    def test_actor_fk_migration_metadata_and_guards(self) -> None:
        script = ScriptDirectory.from_config(Config("alembic.ini"))
        self.assertEqual(script.get_current_head(), "20260806200000")
        notification_revision = script.get_revision("20260806200000")
        revision = script.get_revision("20260806190000")
        self.assertEqual(notification_revision.down_revision, "20260806190000")
        self.assertEqual(revision.down_revision, "20260806180000")

        migration_op = MagicMock()
        bind = migration_op.get_bind.return_value
        orphan_marker = uuid4()
        bind.scalar.return_value = 1
        with patch.object(revision.module, "op", migration_op):
            with self.assertRaisesRegex(
                RuntimeError,
                "orphan actor aggregate count: 1",
            ) as raised:
                revision.module.upgrade()
        self.assertNotIn(str(orphan_marker), str(raised.exception))
        migration_op.alter_column.assert_not_called()
        migration_op.create_foreign_key.assert_not_called()

        migration_op.reset_mock()
        migration_op.get_bind.return_value.scalar.return_value = 0
        with patch.object(revision.module, "op", migration_op):
            revision.module.upgrade()
        migration_op.alter_column.assert_called_once()
        migration_op.create_foreign_key.assert_called_once_with(
            "admin_event_audit_entries_actor_user_id_fkey",
            "admin_event_audit_entries",
            "app_users",
            ["actor_user_id"],
            ["id"],
            ondelete="SET NULL",
        )

        migration_op.reset_mock()
        migration_op.get_bind.return_value.scalar.return_value = 1
        with patch.object(revision.module, "op", migration_op):
            with self.assertRaisesRegex(
                RuntimeError,
                "null actor aggregate count: 1",
            ):
                revision.module.downgrade()
        migration_op.drop_constraint.assert_not_called()
        migration_op.alter_column.assert_not_called()

        migration_op.reset_mock()
        migration_op.get_bind.return_value.scalar.return_value = 0
        with patch.object(revision.module, "op", migration_op):
            revision.module.downgrade()
        migration_op.drop_constraint.assert_called_once_with(
            "admin_event_audit_entries_actor_user_id_fkey",
            "admin_event_audit_entries",
            type_="foreignkey",
        )
        migration_op.alter_column.assert_called_once()

    async def test_database_is_at_dynamic_alembic_head(self) -> None:
        expected = ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()
        async with AsyncSessionLocal() as session:
            actual = await session.scalar(text("SELECT version_num FROM alembic_version"))
        self.assertIsNotNone(expected)
        self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
