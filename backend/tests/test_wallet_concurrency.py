"""Row-locking check. Needs real Postgres (SQLite ignores FOR UPDATE):

    MINEBET_TEST_PG_URL=postgresql+asyncpg://minebet:minebet@localhost/minebet_test uv run pytest

The target database is wiped, so its name must end with "_test".
"""

import asyncio
import os

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import Base
from app.models import TxKind, User, utcnow
from app.wallet import InsufficientFunds, apply_transaction

PG_URL = os.environ.get("MINEBET_TEST_PG_URL")

pytestmark = pytest.mark.skipif(PG_URL is None, reason="MINEBET_TEST_PG_URL not set")
if PG_URL is not None:
    assert PG_URL.endswith("_test"), "MINEBET_TEST_PG_URL must point at a *_test database"


async def test_concurrent_bets_never_overdraw():
    engine = create_async_engine(PG_URL, pool_size=20)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with factory() as s:
        s.add(
            User(
                email="a@b.co",
                password_hash="x",
                mc_nick="Alex",
                age_confirmed_at=utcnow(),
                balance=1000,
            )
        )
        await s.commit()

    async def bet() -> bool:
        async with factory() as s:
            try:
                await apply_transaction(s, 1, TxKind.BET, -100)
            except InsufficientFunds:
                return False
            await s.commit()
            return True

    results = await asyncio.gather(*(bet() for _ in range(25)))
    async with factory() as s:
        balance = (await s.execute(text("SELECT balance FROM users WHERE id = 1"))).scalar_one()
        ledger = (await s.execute(text("SELECT sum(amount) FROM transactions"))).scalar_one()
    await engine.dispose()

    assert sum(results) == 10
    assert balance == 0
    assert ledger == -1000
