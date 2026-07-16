from __future__ import annotations

import argparse
import asyncio
from uuid import UUID

from app.db.session import AsyncSessionLocal, engine
from app.services.import_maintenance import ignore_exact_open_import_duplicates


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Soft-ignore exact open import-item duplicates. Dry-run is the default; "
            "use --apply to change rows."
        ),
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Print planned changes only.")
    mode.add_argument("--apply", action="store_true", help="Soft-ignore duplicate rows.")
    parser.add_argument("--community-id", type=UUID)
    parser.add_argument("--source-id", type=UUID)
    return parser.parse_args()


async def run() -> None:
    args = parse_args()
    async with AsyncSessionLocal() as session:
        summary = await ignore_exact_open_import_duplicates(
            session,
            apply=args.apply,
            community_id=args.community_id,
            source_id=args.source_id,
        )
    await engine.dispose()

    print(f"reviewed_rows={summary.reviewed_rows}")
    print(f"duplicate_groups={summary.duplicate_groups}")
    print(f"would_change={summary.would_change}")
    print(f"changed={summary.changed}")


if __name__ == "__main__":
    asyncio.run(run())
