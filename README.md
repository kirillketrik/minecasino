# MineBet

Minecraft-themed game site. See [PRODUCT.md](PRODUCT.md) for scope.

## Run

```bash
docker compose up -d db              # Postgres (optional: backend falls back to SQLite)
cd backend
cp .env.example .env                 # then adjust
uv run alembic upgrade head
uv run uvicorn app.main:app --reload # http://localhost:8000/docs

cd ../frontend
pnpm install && pnpm dev             # http://localhost:5173, /api proxied to :8000
```

## Test

```bash
cd backend
uv run pytest
# Row-locking test needs Postgres (the target DB is wiped; name must end in _test):
docker compose exec db psql -U minebet -c "CREATE DATABASE minebet_test"
MINEBET_TEST_PG_URL=postgresql+asyncpg://minebet:minebet@localhost:5432/minebet_test uv run pytest
```
