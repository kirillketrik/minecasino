"""Live stream of an «Элитры» flight.

Protocol (JSON text frames)
  client -> {"token": "<access token>"}          first frame, within AUTH_TIMEOUT seconds
  server -> {"type": "tick", "multiplier": 137, "elapsed": 3.1}   every TICK seconds, hundredths
  client -> {"action": "cashout"}                 at any time during the flight
  server -> {"type": "end", "status": ..., "payout": ..., "balance": ..., "view": {...}}
            then the socket closes. Also sent at once if the round is already over.
  server -> {"type": "error", "detail": "..."}    for a refused cash-out; the flight goes on.

The browser only draws the curve. Whether a cash-out was in time is decided here, on the server
clock, when the frame arrives. The stream also settles the round by itself when the rocket crashes
or reaches the cap, so the player learns the result without sending anything.
"""

import asyncio
import contextlib
import time
from typing import Annotated, Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.games import RngDep, SettingsDep
from app.db import SessionLocal
from app.games import service
from app.games.base import InvalidAction
from app.games.elytra import ElytraGame
from app.games.registry import get_game
from app.models import Round, User
from app.security import decode_access_token

router = APIRouter()

AUTH_TIMEOUT = 5.0
TICK = 0.1
# Close codes in the application range.
CLOSE_UNAUTHORIZED = 4401
CLOSE_NOT_FOUND = 4404


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    return SessionLocal


SessionFactoryDep = Annotated[async_sessionmaker[AsyncSession], Depends(get_session_factory)]


async def _end_message(round_: Round, balance: int) -> dict[str, Any]:
    return {
        "type": "end",
        "status": round_.view.get("status"),
        "payout": round_.payout,
        "balance": balance,
        "view": round_.view,
    }


async def _authenticate(ws: WebSocket, factory: async_sessionmaker[AsyncSession]) -> int | None:
    try:
        first = await asyncio.wait_for(ws.receive_json(), AUTH_TIMEOUT)
        token = first.get("token") if isinstance(first, dict) else None
        user_id = decode_access_token(token) if isinstance(token, str) else None
    except (TimeoutError, ValueError, WebSocketDisconnect):
        return None
    if user_id is None:
        return None
    async with factory() as session:
        return user_id if await session.get(User, user_id) else None


@router.websocket("/ws/rounds/{round_id}")
async def watch_flight(
    ws: WebSocket,
    round_id: int,
    factory: SessionFactoryDep,
    rng: RngDep,
    settings: SettingsDep,
) -> None:
    await ws.accept()
    user_id = await _authenticate(ws, factory)
    if user_id is None:
        await ws.close(CLOSE_UNAUTHORIZED)
        return

    async with factory() as session:
        round_ = (
            await session.execute(
                select(Round).where(Round.id == round_id, Round.user_id == user_id)
            )
        ).scalar_one_or_none()
        user = await session.get(User, user_id)
    game = get_game("elytra")
    if round_ is None or user is None or not isinstance(game, ElytraGame):
        await ws.close(CLOSE_NOT_FOUND)
        return
    if round_.game_id != game.id:
        await ws.close(CLOSE_NOT_FOUND)
        return
    if round_.finished:
        await ws.send_json(await _end_message(round_, user.balance))
        await ws.close()
        return

    state = round_.state

    async def settle() -> dict[str, Any] | None:
        """Cash out now. Returns the end message, or None if the cash-out was refused."""
        async with factory() as session:
            try:
                done = await service.act_round(
                    session, rng, settings, user_id, round_id, {"type": "cashout"}
                )
            except service.RoundFinished:
                done = await session.get(Round, round_id)
            except InvalidAction as e:
                await session.rollback()
                await ws.send_json({"type": "error", "detail": str(e)})
                return None
            await session.commit()
            owner = await session.get(User, user_id)
            assert done is not None and owner is not None
            return await _end_message(done, owner.balance)

    end_at = game.settle_at(state)
    try:
        while True:
            now = time.time()
            m = game.multiplier_for(state, now)
            if game.is_over(state, m):
                # The rocket crashed or hit the cap on its own: settle it.
                end = await settle()
                assert end is not None
                await ws.send_json(end)
                break
            await ws.send_json(
                {
                    "type": "tick",
                    "multiplier": m,
                    "elapsed": round(now - state["started_at"], 3),
                }
            )
            try:
                message = await asyncio.wait_for(
                    ws.receive_json(), min(TICK, max(end_at - now, 0) + 0.002)
                )
            except TimeoutError:
                continue
            except ValueError:
                continue  # not JSON: ignore
            if isinstance(message, dict) and message.get("action") == "cashout":
                end = await settle()
                if end is not None:
                    await ws.send_json(end)
                    break
    except WebSocketDisconnect:
        return  # the round stays open; the next round the player starts collects or forfeits it
    with contextlib.suppress(RuntimeError):
        await ws.close()
