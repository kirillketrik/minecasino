from httpx import AsyncClient

from tests.conftest import REGISTER


async def test_register_gives_signup_bonus_and_me(client: AsyncClient, auth: dict[str, str]):
    me = (await client.get("/api/auth/me", headers=auth)).json()
    assert me["email"] == "steve@example.com"
    assert me["mc_nick"] == "Steve_01"
    assert me["balance"] == 1000
    assert "password" not in me and "password_hash" not in me

    txs = (await client.get("/api/wallet/transactions", headers=auth)).json()
    assert [(t["kind"], t["amount"], t["balance_after"]) for t in txs] == [
        ("signup_bonus", 1000, 1000)
    ]


async def test_register_requires_age_confirmation(client: AsyncClient):
    r = await client.post("/api/auth/register", json={**REGISTER, "age_confirmed": False})
    assert r.status_code == 422


async def test_register_rejects_bad_nick_and_short_password(client: AsyncClient):
    assert (
        await client.post("/api/auth/register", json={**REGISTER, "mc_nick": "a b"})
    ).status_code == 422
    assert (
        await client.post("/api/auth/register", json={**REGISTER, "password": "short"})
    ).status_code == 422


async def test_duplicate_email_is_case_insensitive(client: AsyncClient, auth: dict[str, str]):
    r = await client.post("/api/auth/register", json={**REGISTER, "email": "STEVE@example.com"})
    assert r.status_code == 409


async def test_login(client: AsyncClient, auth: dict[str, str]):
    ok = await client.post(
        "/api/auth/login", json={"email": "steve@example.com", "password": REGISTER["password"]}
    )
    assert ok.status_code == 200 and ok.json()["access_token"]
    bad = await client.post(
        "/api/auth/login", json={"email": "steve@example.com", "password": "wrong-password"}
    )
    assert bad.status_code == 401
    unknown = await client.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": "whatever-123"}
    )
    assert unknown.status_code == 401


async def test_protected_routes_require_valid_token(client: AsyncClient):
    assert (await client.get("/api/auth/me")).status_code == 401
    r = await client.get("/api/auth/me", headers={"Authorization": "Bearer garbage"})
    assert r.status_code == 401
