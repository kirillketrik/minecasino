"""Make a user an admin: uv run python scripts/make_admin.py <email> [--revoke]."""

import asyncio
import sys

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User


async def main(email: str, admin: bool) -> None:
    async with SessionLocal() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            sys.exit(f"No user with email {email}")
        user.is_admin = admin
        await session.commit()
        print(f"{email}: is_admin = {admin}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1], "--revoke" not in sys.argv))
