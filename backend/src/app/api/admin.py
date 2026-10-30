"""Public runtime settings and the admin endpoints that change them."""

import random

from fastapi import APIRouter, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app import runtime_config
from app.api.deps import AdminUser, SessionDep
from app.config import get_settings
from app.games import registry
from app.games.base import Tuning
from app.games.rng import Rng
from app.games.simulation import simulate
from app.games.slot import SlotGame
from app.runtime_config import (
    MAX_MAX_WIN,
    MAX_RTP,
    MIN_MAX_WIN,
    MIN_RTP,
    GameConfig,
    RuntimeConfig,
)

router = APIRouter(tags=["admin"])

SIMULATION_MAX_ROUNDS = 30_000


class PublicConfig(BaseModel):
    win_tiers: list[int]


class GameCatalog(BaseModel):
    id: str
    modes: list[str]
    max_bet: int  # the global maximum, which a game can only lower
    # Slots only: the calibrated RTP and the global win cap, which the admin may change per game.
    tunable: bool = False
    default_rtp: float = 0.0
    default_max_win: int = 0
    min_rtp: float = MIN_RTP
    max_rtp: float = MAX_RTP
    min_max_win: int = MIN_MAX_WIN
    max_max_win: int = MAX_MAX_WIN


class AdminConfig(BaseModel):
    config: RuntimeConfig
    games: list[GameCatalog]


@router.get("/config", response_model=PublicConfig)
async def public_config(session: SessionDep) -> PublicConfig:
    return PublicConfig(win_tiers=(await runtime_config.load(session)).win_tiers)


async def _admin_out(session: SessionDep) -> AdminConfig:
    settings = get_settings()
    return AdminConfig(
        config=await runtime_config.load(session),
        games=[
            GameCatalog(
                id=g.id,
                modes=list(g.modes),
                max_bet=settings.max_bet,
                tunable=isinstance(g, SlotGame),
                default_rtp=g.target_rtp,
                default_max_win=settings.max_win_multiplier,
            )
            for g in registry.all_games()
        ],
    )


@router.get("/admin/config", response_model=AdminConfig)
async def get_admin_config(_: AdminUser, session: SessionDep) -> AdminConfig:
    return await _admin_out(session)


@router.put("/admin/config", response_model=AdminConfig)
async def put_admin_config(body: RuntimeConfig, _: AdminUser, session: SessionDep) -> AdminConfig:
    settings = get_settings()
    for game_id, game_config in body.games.items():
        game = registry.get_game(game_id)
        if game is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown game {game_id}")
        unknown = set(game_config.disabled_modes) - set(game.modes)
        if unknown:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown modes {sorted(unknown)}"
            )
        if (game_config.rtp is not None or game_config.max_win is not None) and not isinstance(
            game, SlotGame
        ):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"{game_id} has no RTP or win cap to set"
            )
        if game_config.max_bet is not None and not (
            max(settings.min_bet, game.min_bet) <= game_config.max_bet <= settings.max_bet
        ):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"Max bet of {game_id} is out of range"
            )
    await runtime_config.save(session, body)
    await session.commit()
    return await _admin_out(session)


class SimulateIn(BaseModel):
    game_id: str
    rtp: float | None = Field(None, ge=MIN_RTP, le=MAX_RTP)
    max_win: int | None = Field(None, ge=MIN_MAX_WIN, le=MAX_MAX_WIN)
    rounds: int = Field(10_000, ge=1_000, le=SIMULATION_MAX_ROUNDS)


class SimulateOut(BaseModel):
    rounds: int
    rtp: float
    stderr: float
    hit_rate: float
    max_multiplier: float
    capped_rounds: int


def _run_simulation(game: SlotGame, tuning: Tuning, rounds: int) -> SimulateOut:
    report = simulate(
        game,
        Rng(random.Random()),
        rounds,
        bet=100,
        max_multiplier=tuning.max_win,
        tuning=tuning,
        policy=lambda *_: {"type": "collect"},  # Шахта leaves a win open to collect or gamble
    )
    return SimulateOut(
        rounds=report.rounds,
        rtp=report.rtp,
        stderr=report.stderr,
        hit_rate=report.hit_rate,
        max_multiplier=report.max_multiplier,
        capped_rounds=report.capped_rounds,
    )


@router.post("/admin/simulate", response_model=SimulateOut)
async def simulate_slot(body: SimulateIn, _: AdminUser) -> SimulateOut:
    """Play a slot with the given RTP and win cap (no wallet, no stored rounds) and report it.

    Lets the admin check what a setting really returns before saving it: the RTP is a scale on the
    calibrated pays, and a lower or higher win cap moves the true figure a little.
    """
    game = registry.get_game(body.game_id)
    if not isinstance(game, SlotGame):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Not a slot")
    config = GameConfig(rtp=body.rtp, max_win=body.max_win)
    tuning = RuntimeConfig(games={game.id: config}).tuning(game, get_settings().max_win_multiplier)
    return await run_in_threadpool(_run_simulation, game, tuning, body.rounds)
