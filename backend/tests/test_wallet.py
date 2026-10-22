import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import TxKind
from app.wallet import InsufficientFunds, apply_transaction


async def test_deposit_stub_credits_and_records(client: AsyncClient, auth: dict[str, str]):
    r = await client.post("/api/wallet/deposit", json={"amount": 500}, headers=auth)
    assert r.status_code == 201
    assert r.json()["balance_after"] == 1500
    me = (await client.get("/api/auth/me", headers=auth)).json()
    assert me["balance"] == 1500


async def test_deposit_validation(client: AsyncClient, auth: dict[str, str]):
    assert (
        await client.post("/api/wallet/deposit", json={"amount": 0}, headers=auth)
    ).status_code == 422
    assert (
        await client.post("/api/wallet/deposit", json={"amount": 10**6}, headers=auth)
    ).status_code == 422


async def test_withdrawal_reserves_coins(client: AsyncClient, auth: dict[str, str]):
    r = await client.post(
        "/api/wallet/withdrawals", json={"amount": 400, "server": "funtime"}, headers=auth
    )
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "pending" and body["mc_nick"] == "Steve_01"

    me = (await client.get("/api/auth/me", headers=auth)).json()
    assert me["balance"] == 600
    txs = (await client.get("/api/wallet/transactions", headers=auth)).json()
    assert txs[0]["kind"] == "withdrawal" and txs[0]["amount"] == -400
    assert txs[0]["ref"] == f"wd:{body['id']}"

    listed = (await client.get("/api/wallet/withdrawals", headers=auth)).json()
    assert [w["id"] for w in listed] == [body["id"]]


async def test_withdrawal_over_balance_leaves_no_trace(client: AsyncClient, auth: dict[str, str]):
    r = await client.post(
        "/api/wallet/withdrawals", json={"amount": 5000, "server": "holyworld"}, headers=auth
    )
    assert r.status_code == 422
    assert (await client.get("/api/auth/me", headers=auth)).json()["balance"] == 1000
    assert (await client.get("/api/wallet/withdrawals", headers=auth)).json() == []


async def test_withdrawal_below_minimum_and_bad_server(client: AsyncClient, auth: dict[str, str]):
    low = await client.post(
        "/api/wallet/withdrawals", json={"amount": 10, "server": "funtime"}, headers=auth
    )
    assert low.status_code == 422
    bad = await client.post(
        "/api/wallet/withdrawals", json={"amount": 200, "server": "hypixel"}, headers=auth
    )
    assert bad.status_code == 422


async def test_transactions_pagination_newest_first(client: AsyncClient, auth: dict[str, str]):
    for amount in (10, 20, 30):
        await client.post("/api/wallet/deposit", json={"amount": amount}, headers=auth)
    page1 = (await client.get("/api/wallet/transactions?limit=2", headers=auth)).json()
    assert [t["amount"] for t in page1] == [30, 20]
    page2 = (
        await client.get(
            f"/api/wallet/transactions?limit=2&before_id={page1[-1]['id']}", headers=auth
        )
    ).json()
    assert [t["amount"] for t in page2] == [10, 1000]


async def test_ledger_is_consistent_with_balance(
    client: AsyncClient, auth: dict[str, str], session_factory: async_sessionmaker[AsyncSession]
):
    await client.post("/api/wallet/deposit", json={"amount": 250}, headers=auth)
    await client.post(
        "/api/wallet/withdrawals", json={"amount": 300, "server": "funtime"}, headers=auth
    )
    txs = (await client.get("/api/wallet/transactions?limit=200", headers=auth)).json()
    me = (await client.get("/api/auth/me", headers=auth)).json()
    assert sum(t["amount"] for t in txs) == me["balance"] == txs[0]["balance_after"]


async def test_apply_transaction_rejects_overdraft_and_zero(
    client: AsyncClient, auth: dict[str, str], session_factory: async_sessionmaker[AsyncSession]
):
    async with session_factory() as session:
        with pytest.raises(InsufficientFunds):
            await apply_transaction(session, 1, TxKind.BET, -1001)
        with pytest.raises(ValueError):
            await apply_transaction(session, 1, TxKind.BET, 0)
