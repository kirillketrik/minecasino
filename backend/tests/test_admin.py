from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import User


async def _make_admin(session_factory: async_sessionmaker[AsyncSession]) -> None:
    async with session_factory() as session:
        await session.execute(update(User).values(is_admin=True))
        await session.commit()


async def test_config_is_public_with_later_default_thresholds(client: AsyncClient) -> None:
    r = await client.get("/api/config")
    assert r.status_code == 200 and r.json()["win_tiers"] == [10, 20, 40, 70, 100]


async def test_admin_endpoints_need_an_admin(client: AsyncClient, auth: dict[str, str]) -> None:
    assert (await client.get("/api/admin/config")).status_code == 401
    assert (await client.get("/api/admin/config", headers=auth)).status_code == 403
    r = await client.put("/api/admin/config", json={}, headers=auth)
    assert r.status_code == 403


async def test_admin_changes_thresholds_modes_and_max_bet(
    client: AsyncClient, auth: dict[str, str], session_factory: async_sessionmaker[AsyncSession]
) -> None:
    await _make_admin(session_factory)
    assert (await client.get("/api/auth/me", headers=auth)).json()["is_admin"] is True
    body = {
        "win_tiers": [15, 30, 50, 80, 100],
        "games": {"creeper": {"disabled_modes": ["buy_bonus"], "max_bet": 200}},
    }
    r = await client.put("/api/admin/config", json=body, headers=auth)
    assert r.status_code == 200, r.text
    assert (await client.get("/api/config")).json()["win_tiers"] == [15, 30, 50, 80, 100]

    info = {g["id"]: g for g in (await client.get("/api/games")).json()}["creeper"]
    assert "buy_bonus" not in info["modes"] and "ante" in info["modes"]
    assert info["max_bet"] == 200

    r = await client.post(
        "/api/games/creeper/rounds", json={"bet": 20, "mode": "buy_bonus"}, headers=auth
    )
    assert r.status_code == 422 and "switched off" in r.json()["detail"]
    r = await client.post("/api/games/creeper/rounds", json={"bet": 220}, headers=auth)
    assert r.status_code == 422
    r = await client.post("/api/games/creeper/rounds", json={"bet": 200}, headers=auth)
    assert r.status_code == 201


async def test_admin_input_is_validated(
    client: AsyncClient, auth: dict[str, str], session_factory: async_sessionmaker[AsyncSession]
) -> None:
    await _make_admin(session_factory)
    for bad in (
        {"win_tiers": [5, 5, 40, 70, 100]},  # not growing
        {"win_tiers": [10, 20, 40, 70]},  # wrong count
        {"win_tiers": [10, 20, 40, 70, 101]},  # above the cap
        {"games": {"nope": {}}},
        {"games": {"creeper": {"disabled_modes": ["nope"]}}},
        {"games": {"creeper": {"max_bet": 5_000}}},  # above the global maximum
    ):
        r = await client.put("/api/admin/config", json=bad, headers=auth)
        assert r.status_code == 422, bad
