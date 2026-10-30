"""Plays rounds against the wallet. The caller commits; any exception rolls everything back.

Money flow of one round: bet is debited when it opens, the capped payout is credited when it
finishes. Both ledger rows reference `round:<id>`.
"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import runtime_config
from app.config import Settings
from app.games.base import Game, GameResult, InvalidAction
from app.games.engine import finalize
from app.games.registry import get_game
from app.games.rng import Rng
from app.games.slot import SlotGame
from app.limits import check_play
from app.models import Round, TxKind
from app.wallet import apply_transaction


class UnknownGame(Exception):
    pass


class BetOutOfRange(Exception):
    """The bet is outside the allowed range or not a multiple of the game's bet step."""


class RoundNotFound(Exception):
    pass


class RoundFinished(Exception):
    pass


def _require_game(game_id: str) -> Game:
    game = get_game(game_id)
    if game is None:
        raise UnknownGame(game_id)
    return game


async def _settle(session: AsyncSession, round_: Round, result: GameResult) -> None:
    round_.state = result.state
    round_.view = result.view
    round_.finished = result.finished
    round_.payout = result.payout
    if result.finished and result.payout > 0:
        await apply_transaction(
            session, round_.user_id, TxKind.WIN, result.payout, ref=f"round:{round_.id}"
        )


async def _settle_abandoned(
    session: AsyncSession, rng: Rng, settings: Settings, user_id: int
) -> None:
    """Starting a new round collects whatever the player left pending in open ones."""
    runtime = await runtime_config.load(session)
    open_rounds = (
        await session.execute(
            select(Round)
            .where(Round.user_id == user_id, Round.finished.is_(False))
            .order_by(Round.id)
            .with_for_update()
        )
    ).scalars()
    for round_ in open_rounds.all():
        game = get_game(round_.game_id)
        result = game.abandon(round_.state, round_.bet, rng) if game else None
        if result is not None:
            cap = runtime.max_win(game, settings.max_win_multiplier)
            await _settle(session, round_, finalize(result, cap))


async def start_round(
    session: AsyncSession,
    rng: Rng,
    settings: Settings,
    user_id: int,
    game_id: str,
    bet: int,
    mode: str | None = None,
) -> Round:
    game = _require_game(game_id)
    config = (await runtime_config.load(session)).game(game_id)
    low = max(settings.min_bet, game.min_bet)
    high = min(settings.max_bet, config.max_bet or settings.max_bet)
    if not low <= bet <= high:
        raise BetOutOfRange(f"Bet must be between {low} and {high}")
    if bet % game.bet_step:
        raise BetOutOfRange(f"Bet must be a multiple of {game.bet_step}")

    if mode in config.disabled_modes:
        raise BetOutOfRange(f"Mode '{mode}' is switched off")
    try:
        cost = game.cost(bet, mode)
    except InvalidAction as e:
        raise BetOutOfRange(str(e)) from None

    await check_play(session, user_id, cost)
    await _settle_abandoned(session, rng, settings, user_id)

    round_ = Round(user_id=user_id, game_id=game_id, bet=bet, state={}, view={})
    session.add(round_)
    await session.flush()
    await apply_transaction(session, user_id, TxKind.BET, -cost, ref=f"round:{round_.id}")

    runtime = await runtime_config.load(session)
    if isinstance(game, SlotGame):
        raw = game.start(bet, rng, mode, runtime.tuning(game, settings.max_win_multiplier))
    else:
        raw = game.start(bet, rng) if mode is None else game.start(bet, rng, mode)
    result = finalize(raw, runtime.max_win(game, settings.max_win_multiplier))
    await _settle(session, round_, result)
    await session.flush()
    return round_


async def act_round(
    session: AsyncSession,
    rng: Rng,
    settings: Settings,
    user_id: int,
    round_id: int,
    action: dict[str, Any],
) -> Round:
    round_ = (
        await session.execute(
            select(Round).where(Round.id == round_id, Round.user_id == user_id).with_for_update()
        )
    ).scalar_one_or_none()
    if round_ is None:
        raise RoundNotFound
    if round_.finished:
        raise RoundFinished

    game = _require_game(round_.game_id)
    runtime = await runtime_config.load(session)
    cap = runtime.max_win(game, settings.max_win_multiplier)
    result = finalize(game.act(round_.state, round_.bet, action, rng), cap)
    if result.bet != round_.bet:
        raise RuntimeError(f"{game.id} changed the bet of round {round_.id}")
    await _settle(session, round_, result)
    await session.flush()
    return round_
