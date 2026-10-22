"""Public runtime settings and the admin endpoints that change them."""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app import runtime_config
from app.api.deps import AdminUser, SessionDep
from app.config import get_settings
from app.games import registry
from app.runtime_config import RuntimeConfig

router = APIRouter(tags=["admin"])


class PublicConfig(BaseModel):
    win_tiers: list[int]


class GameCatalog(BaseModel):
    id: str
    modes: list[str]
    max_bet: int  # the global maximum, which a game can only lower


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
            GameCatalog(id=g.id, modes=list(g.modes), max_bet=settings.max_bet)
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
        if game_config.max_bet is not None and not (
            max(settings.min_bet, game.min_bet) <= game_config.max_bet <= settings.max_bet
        ):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"Max bet of {game_id} is out of range"
            )
    await runtime_config.save(session, body)
    await session.commit()
    return await _admin_out(session)
