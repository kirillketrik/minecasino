from datetime import timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import User, utcnow


async def test_defaults_are_unlimited(client: AsyncClient, auth: dict[str, str]) -> None:
    r = await client.get("/api/limits", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["deposit_limit"] is None and body["loss_limit"] is None
    assert body["excluded_until"] is None and body["lost_24h"] == 0


async def test_loss_limit_blocks_the_bet_that_would_exceed_it(
    client: AsyncClient, auth: dict[str, str]
) -> None:
    r = await client.put("/api/limits", json={"loss_limit": 10}, headers=auth)
    assert r.json()["loss_limit"] == 10 and r.json()["deposit_limit"] is None
    r = await client.post("/api/games/elytra/rounds", json={"bet": 11}, headers=auth)
    assert r.status_code == 403
    assert r.json()["detail"].startswith("Loss limit reached")


async def test_deposit_limit_counts_the_last_day(client: AsyncClient, auth: dict[str, str]) -> None:
    await client.put("/api/limits", json={"deposit_limit": 500}, headers=auth)
    assert (
        await client.post("/api/wallet/deposit", json={"amount": 300}, headers=auth)
    ).status_code == 201
    r = await client.post("/api/wallet/deposit", json={"amount": 300}, headers=auth)
    assert r.status_code == 403 and r.json()["detail"] == "Deposit limit reached: 200 left"
    assert (
        await client.post("/api/wallet/deposit", json={"amount": 200}, headers=auth)
    ).status_code == 201


async def test_self_exclusion_blocks_play_and_deposits_but_not_withdrawals(
    client: AsyncClient, auth: dict[str, str]
) -> None:
    r = await client.post("/api/limits/exclusion", json={"hours": 24}, headers=auth)
    assert r.status_code == 200 and r.json()["excluded_until"] is not None
    assert (await client.get("/api/auth/me", headers=auth)).json()["excluded_until"] is not None
    play = await client.post("/api/games/elytra/rounds", json={"bet": 10}, headers=auth)
    assert play.status_code == 403 and play.json()["detail"].startswith("Self-excluded")
    dep = await client.post("/api/wallet/deposit", json={"amount": 100}, headers=auth)
    assert dep.status_code == 403
    wd = await client.post(
        "/api/wallet/withdrawals", json={"amount": 100, "server": "funtime"}, headers=auth
    )
    assert wd.status_code == 201


async def test_exclusion_cannot_be_shortened_or_use_odd_lengths(
    client: AsyncClient, auth: dict[str, str]
) -> None:
    long = (await client.post("/api/limits/exclusion", json={"hours": 720}, headers=auth)).json()
    short = (await client.post("/api/limits/exclusion", json={"hours": 1}, headers=auth)).json()
    assert short["excluded_until"] == long["excluded_until"]
    assert (
        await client.post("/api/limits/exclusion", json={"hours": 5}, headers=auth)
    ).status_code == 422


async def test_exclusion_ends(
    client: AsyncClient, auth: dict[str, str], session_factory: async_sessionmaker[AsyncSession]
) -> None:
    await client.post("/api/limits/exclusion", json={"hours": 1}, headers=auth)
    async with session_factory() as s:
        user = await s.get(User, 1)
        assert user is not None
        user.excluded_until = utcnow() - timedelta(minutes=1)
        await s.commit()
    r = await client.post("/api/games/elytra/rounds", json={"bet": 10}, headers=auth)
    assert r.status_code == 201
