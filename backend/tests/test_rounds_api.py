import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.api.games import get_rng
from app.games import registry
from app.games.rng import seeded_rng
from tests.conftest import REGISTER
from tests.fakes import AlwaysWinRng, FlipGame, LadderGame

pytestmark = pytest.mark.usefixtures("fake_games")


@pytest.fixture
def fake_games():
    games = [FlipGame(), LadderGame()]
    for g in games:
        registry.register(g)
    yield
    for g in games:
        registry.unregister(g.id)


def _always_win(app: FastAPI) -> None:
    app.dependency_overrides[get_rng] = lambda: AlwaysWinRng()


def _always_lose(app: FastAPI) -> None:
    class Lose(AlwaysWinRng):
        def random(self) -> float:
            return 0.999

    app.dependency_overrides[get_rng] = lambda: Lose()


async def _balance(client, auth):
    return (await client.get("/api/auth/me", headers=auth)).json()["balance"]


async def test_winning_round_debits_bet_and_credits_payout(
    app: FastAPI, client: AsyncClient, auth: dict[str, str]
):
    _always_win(app)
    r = await client.post("/api/games/test_flip/rounds", json={"bet": 100}, headers=auth)
    assert r.status_code == 201
    body = r.json()
    assert body["finished"] and body["payout"] == 192 and body["balance"] == 1092
    assert body["view"] == {"win": True}

    txs = (await client.get("/api/wallet/transactions", headers=auth)).json()
    assert [(t["kind"], t["amount"], t["ref"]) for t in txs[:2]] == [
        ("win", 192, f"round:{body['id']}"),
        ("bet", -100, f"round:{body['id']}"),
    ]


async def test_losing_round_only_debits(app: FastAPI, client: AsyncClient, auth: dict[str, str]):
    _always_lose(app)
    r = await client.post("/api/games/test_flip/rounds", json={"bet": 100}, headers=auth)
    assert r.json()["payout"] == 0 and r.json()["balance"] == 900
    kinds = [t["kind"] for t in (await client.get("/api/wallet/transactions", headers=auth)).json()]
    assert kinds == ["bet", "signup_bonus"]


@pytest.mark.parametrize("bet", [0, -5, 1001])
async def test_bet_limits(client: AsyncClient, auth: dict[str, str], bet: int):
    r = await client.post("/api/games/test_flip/rounds", json={"bet": bet}, headers=auth)
    assert r.status_code == 422
    assert await _balance(client, auth) == 1000
    assert (await client.get("/api/rounds", headers=auth)).json() == []


async def test_insufficient_funds_leaves_no_round_or_ledger_row(
    client: AsyncClient, auth: dict[str, str]
):
    await client.post(
        "/api/wallet/withdrawals", json={"amount": 950, "server": "funtime"}, headers=auth
    )
    r = await client.post("/api/games/test_flip/rounds", json={"bet": 100}, headers=auth)
    assert r.status_code == 422
    assert await _balance(client, auth) == 50
    assert (await client.get("/api/rounds", headers=auth)).json() == []


async def test_unknown_game_and_auth(client: AsyncClient, auth: dict[str, str]):
    assert (
        await client.post("/api/games/nope/rounds", json={"bet": 10}, headers=auth)
    ).status_code == 404
    assert (await client.post("/api/games/test_flip/rounds", json={"bet": 10})).status_code == 401


async def test_open_round_hides_private_state_and_settles_on_collect(
    app: FastAPI, client: AsyncClient, auth: dict[str, str]
):
    _always_win(app)
    opened = (
        await client.post("/api/games/test_ladder/rounds", json={"bet": 50}, headers=auth)
    ).json()
    assert not opened["finished"] and opened["balance"] == 950
    assert "secret" not in str(opened) and "state" not in opened

    for expected_pot in (100, 200):
        step = await client.post(
            f"/api/rounds/{opened['id']}/actions", json={"action": {"type": "flip"}}, headers=auth
        )
        assert step.json()["view"] == {"pot": expected_pot} and not step.json()["finished"]
        assert step.json()["balance"] == 950

    done = (
        await client.post(
            f"/api/rounds/{opened['id']}/actions",
            json={"action": {"type": "collect"}},
            headers=auth,
        )
    ).json()
    assert done["finished"] and done["payout"] == 200 and done["balance"] == 1150


async def test_win_cap_applies_through_the_api(
    app: FastAPI, client: AsyncClient, auth: dict[str, str]
):
    _always_win(app)
    opened = (
        await client.post("/api/games/test_ladder/rounds", json={"bet": 10}, headers=auth)
    ).json()
    for _ in range(10):  # pot reaches 10 * 1024
        await client.post(
            f"/api/rounds/{opened['id']}/actions", json={"action": {"type": "flip"}}, headers=auth
        )
    done = (
        await client.post(
            f"/api/rounds/{opened['id']}/actions",
            json={"action": {"type": "collect"}},
            headers=auth,
        )
    ).json()
    assert done["payout"] == 1000
    assert done["view"]["capped"] is True
    assert done["balance"] == 1000 - 10 + 1000


async def test_finished_round_rejects_more_actions_and_pays_once(
    app: FastAPI, client: AsyncClient, auth: dict[str, str]
):
    _always_win(app)
    opened = (
        await client.post("/api/games/test_ladder/rounds", json={"bet": 50}, headers=auth)
    ).json()
    url = f"/api/rounds/{opened['id']}/actions"
    collect = {"action": {"type": "collect"}}
    assert (await client.post(url, json=collect, headers=auth)).status_code == 200
    assert (await client.post(url, json=collect, headers=auth)).status_code == 409
    assert await _balance(client, auth) == 1000  # bet back once, no double payout


async def test_invalid_action_changes_nothing(client: AsyncClient, auth: dict[str, str]):
    opened = (
        await client.post("/api/games/test_ladder/rounds", json={"bet": 50}, headers=auth)
    ).json()
    r = await client.post(
        f"/api/rounds/{opened['id']}/actions", json={"action": {"type": "cheat"}}, headers=auth
    )
    assert r.status_code == 422
    assert (await client.get(f"/api/rounds/{opened['id']}", headers=auth)).json()[
        "finished"
    ] is False


async def test_rounds_are_private_to_their_owner(client: AsyncClient, auth: dict[str, str]):
    opened = (
        await client.post("/api/games/test_ladder/rounds", json={"bet": 50}, headers=auth)
    ).json()
    other = await client.post(
        "/api/auth/register",
        json={**REGISTER, "email": "alex@example.com", "mc_nick": "Alex"},
    )
    other_auth = {"Authorization": f"Bearer {other.json()['access_token']}"}

    url = f"/api/rounds/{opened['id']}"
    assert (await client.get(url, headers=other_auth)).status_code == 404
    act = await client.post(
        f"{url}/actions", json={"action": {"type": "collect"}}, headers=other_auth
    )
    assert act.status_code == 404
    assert (await client.get("/api/rounds", headers=other_auth)).json() == []


async def test_round_history_newest_first(client: AsyncClient, auth: dict[str, str]):
    ids = []
    for _ in range(3):
        r = await client.post("/api/games/test_flip/rounds", json={"bet": 10}, headers=auth)
        ids.append(r.json()["id"])
    history = (await client.get("/api/rounds?limit=2", headers=auth)).json()
    assert [r["id"] for r in history] == ids[::-1][:2]
    older = (await client.get(f"/api/rounds?before_id={history[-1]['id']}", headers=auth)).json()
    assert [r["id"] for r in older] == [ids[0]]


def test_real_rng_is_not_the_seeded_one():
    # The API dependency must hand out the OS CSPRNG, not a predictable generator.
    assert get_rng()._source.__class__.__name__ == "SystemRandom"
    assert seeded_rng(1)._source.__class__.__name__ == "Random"
