# Tiny one-off: promote an existing user to admin (Phase 3).
#
# There is deliberately NO public "become admin" route - admin access is granted
# out-of-band, like assessor promotion. This sets role="admin" on a user by email,
# minting the FIRST admin who can then approve assessors in the admin app.
#
# Usage (from embercheck-backend/, with the DB env configured):
#   .venv/Scripts/python.exe -m app.scripts.set_admin <email>
#
# Equivalent mongosh one-liner:
#   db.users.updateOne({ email: "<email>" }, { $set: { role: "admin" } })

import asyncio
import sys

from app.db.mongodb import close_db, init_db
from app.models.user import User


async def promote(email: str) -> int:
    await init_db()
    try:
        user = await User.find_one(User.email == email.lower())
        if user is None:
            print(f"No user found with email {email!r}.")
            return 1
        user.role = "admin"
        await user.save()
        print(f"Promoted {user.email} (id={user.id}) -> role=admin")
        return 0
    finally:
        await close_db()


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python -m app.scripts.set_admin <email>")
        return 2
    return asyncio.run(promote(sys.argv[1]))


if __name__ == "__main__":
    raise SystemExit(main())
