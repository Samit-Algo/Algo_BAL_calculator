# One-off backfill: give every existing assessor an APPROVED AssessorProfile
# (Phase 1, Step 3).
#
# Current assessors were promoted out-of-band by set_assessor.py - they carry
# role="assessor" + a jurisdiction string but have no AssessorProfile. Once a
# later phase gates access on status == APPROVED, an assessor with no profile
# would be locked out. This creates an APPROVED profile for each, deriving
# operating_states from their existing jurisdiction.
#
# Data only: reads Users, inserts AssessorProfiles. Never touches a User document
# and never modifies the model/routes/engine. Idempotent - re-running skips any
# assessor that already has a profile (the unique user_id index is the backstop).
#
# Usage (from embercheck-backend/, with the DB env configured):
#   .venv/Scripts/python.exe -m app.scripts.backfill_assessor_profiles [--dry-run]
# --dry-run does every read and prints what WOULD happen, but writes nothing.

import asyncio
import sys

from app.db.mongodb import close_db, init_db
from app.models.assessor_profile import AssessorProfile, AssessorStatus
from app.models.user import User


async def backfill(dry_run: bool = False) -> int:
    await init_db()
    try:
        assessors = await User.find(User.role == "assessor").to_list()
        print(f"Found {len(assessors)} assessor users.")

        created = 0
        skipped = 0
        warned_emails: list[str] = []

        for user in assessors:
            existing = await AssessorProfile.find_one(
                AssessorProfile.user_id == user.id
            )
            if existing is not None:
                skipped += 1
                print(f"  SKIP   {user.email} (id={user.id}) - profile already exists.")
                continue

            jurisdiction = (user.jurisdiction or "").strip()
            if jurisdiction:
                operating_states = [jurisdiction]
            else:
                operating_states = []
                warned_emails.append(user.email)
                print(
                    f"  WARN   {user.email} (id={user.id}) - no jurisdiction; "
                    "operating_states left empty."
                )

            action = "WOULD CREATE" if dry_run else "CREATE"
            print(
                f"  {action} {user.email} (id={user.id}) - "
                f"status=APPROVED operating_states={operating_states}"
            )

            if not dry_run:
                await AssessorProfile(
                    user_id=user.id,
                    status=AssessorStatus.APPROVED,
                    operating_states=operating_states,
                ).insert()
            created += 1

        print()
        if dry_run:
            print("DRY RUN - nothing was written.")
        print(f"Found {len(assessors)} assessor users.")
        print(
            f"{'Would create' if dry_run else 'Created'} {created} profiles "
            "(status=APPROVED)."
        )
        print(f"Skipped {skipped} (already had a profile).")
        print(
            f"Warned {len(warned_emails)} (no jurisdiction - operating_states "
            f"left empty): {', '.join(warned_emails) if warned_emails else '-'}"
        )
        return 0
    finally:
        await close_db()


def main() -> int:
    dry_run = "--dry-run" in sys.argv[1:]
    return asyncio.run(backfill(dry_run))


if __name__ == "__main__":
    raise SystemExit(main())
