from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, games, limits, wallet, ws
from app.config import get_settings
from app.games.catalog import register_all


def create_app() -> FastAPI:
    register_all()
    app = FastAPI(title="MineBet API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth.router, prefix="/api")
    app.include_router(wallet.router, prefix="/api")
    app.include_router(limits.router, prefix="/api")
    app.include_router(games.router, prefix="/api")
    app.include_router(ws.router, prefix="/api")

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
