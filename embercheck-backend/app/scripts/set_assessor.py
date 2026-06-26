# Tiny one-off: promote an existing user to assessor (CONSOLE-B1).
#
# There is deliberately NO public "promote" route - assessor access is granted
# out-of-band. This sets role="assessor" + a jurisdiction on a user by email.
#
# Usage (from embercheck-backend/, with the DB env configured):
#   .venv/Scripts/python.exe -m app.scripts.set_assessor <email> [jurisdiction]
# jurisdiction defaults to "NSW".
#
# Equivalent mongosh one-liner:
#   db.users.updateOne({ email: "<email>" },
#                      { $set: { role: "assessor", jurisdiction: "NSW" } })

import asyncio
import sys

from app.db.mongodb import close_db, init_db
from app.models.user import User


async def promote(email: str, jurisdiction: str = "NSW") -> int:
    await init_db()
    try:
        user = await User.find_one(User.email == email.lower())
        if user is None:
            print(f"No user found with email {email!r}.")
            return 1
        user.role = "assessor"
        user.jurisdiction = jurisdiction
        await user.save()
        print(
            f"Promoted {user.email} (id={user.id}) -> "
            f"role=assessor jurisdiction={jurisdiction}"
        )
        return 0
    finally:
        await close_db()


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python -m app.scripts.set_assessor <email> [jurisdiction]")
        return 2
    email = sys.argv[1]
    jurisdiction = sys.argv[2] if len(sys.argv) > 2 else "NSW"
    return asyncio.run(promote(email, jurisdiction))


if __name__ == "__main__":
    raise SystemExit(main())
