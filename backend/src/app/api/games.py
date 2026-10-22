from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep
from app.config import Settings, get_settings
from app.games import registry, service
from app.games.base import InvalidAction
from app.games.rng import Rng, secure_rng
from app.limits import PlayBlocked
from app.models import Round, User
from app.wallet import InsufficientFunds

router = APIRouter(tags=["games"])

_rng = secure_rng()


def get_rng() -> Rng:
    return _rng


RngDep = Annotated[Rng, Depends(get_rng)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


class GameInfo(BaseModel):
    id: str
    min_bet: int
    max_bet: int
    bet_step: int
    max_win_multiplier: int
    modes: dict[str, int] = {}


class StartIn(BaseModel):
    bet: int
    mode: str | None = None


class ActionIn(BaseModel):
    action: dict[str, Any]


class RoundOut(BaseModel):
    id: int
    game_id: str
    bet: int
    payout: int
    finished: bool
    view: dict[str, Any]
    created_at: datetime
    balance: int


def _out(round_: Round, user: User) -> RoundOut:
    return RoundOut(
        id=round_.id,
        game_id=round_.game_id,
        bet=round_.bet,
        payout=round_.payout,
        finished=round_.finished,
        view=round_.view,
        created_at=round_.created_at,
        balance=user.balance,
    )


@router.get("/games", response_model=list[GameInfo])
async def list_games(settings: SettingsDep) -> list[GameInfo]:
    return [
        GameInfo(
            id=g.id,
            min_bet=max(settings.min_bet, g.min_bet),
            max_bet=settings.max_bet,
            bet_step=g.bet_step,
            max_win_multiplier=settings.max_win_multiplier,
            modes=g.modes,
        )
        for g in registry.all_games()
    ]


@router.post(
    "/games/{game_id}/rounds", response_model=RoundOut, status_code=status.HTTP_201_CREATED
)
async def start_round(
    game_id: str,
    body: StartIn,
    user: CurrentUser,
    session: SessionDep,
    rng: RngDep,
    settings: SettingsDep,
) -> RoundOut:
    try:
        round_ = await service.start_round(
            session, rng, settings, user.id, game_id, body.bet, body.mode
        )
    except service.UnknownGame:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown game") from None
    except service.BetOutOfRange as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from None
    except InsufficientFunds:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Insufficient funds") from None
    except PlayBlocked as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e)) from None
    await session.commit()
    await session.refresh(user)
    return _out(round_, user)


@router.post("/rounds/{round_id}/actions", response_model=RoundOut)
async def round_action(
    round_id: int,
    body: ActionIn,
    user: CurrentUser,
    session: SessionDep,
    rng: RngDep,
    settings: SettingsDep,
) -> RoundOut:
    try:
        round_ = await service.act_round(session, rng, settings, user.id, round_id, body.action)
    except service.RoundNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Round not found") from None
    except service.RoundFinished:
        raise HTTPException(status.HTTP_409_CONFLICT, "Round already finished") from None
    except InvalidAction as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from None
    await session.commit()
    await session.refresh(user)
    return _out(round_, user)


@router.get("/rounds", response_model=list[RoundOut])
async def list_rounds(
    user: CurrentUser,
    session: SessionDep,
    limit: int = Query(50, ge=1, le=200),
    before_id: int | None = Query(None, ge=1),
) -> list[RoundOut]:
    query = select(Round).where(Round.user_id == user.id)
    if before_id is not None:
        query = query.where(Round.id < before_id)
    rounds = (await session.execute(query.order_by(Round.id.desc()).limit(limit))).scalars()
    return [_out(r, user) for r in rounds]


@router.get("/rounds/{round_id}", response_model=RoundOut)
async def get_round(round_id: int, user: CurrentUser, session: SessionDep) -> RoundOut:
    round_ = (
        await session.execute(select(Round).where(Round.id == round_id, Round.user_id == user.id))
    ).scalar_one_or_none()
    if round_ is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Round not found")
    return _out(round_, user)
