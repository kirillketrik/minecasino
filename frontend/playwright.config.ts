import { defineConfig } from '@playwright/test'

const API = 8100
const WEB = 5174
const DB = 'sqlite+aiosqlite:///./e2e.db'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: { baseURL: `http://localhost:${WEB}`, channel: 'chrome', trace: 'retain-on-failure' },
  webServer: [
    {
      command: `uv run --directory ../backend python scripts/serve_e2e.py ${API}`,
      url: `http://localhost:${API}/api/games`,
      env: { MINEBET_DATABASE_URL: DB, MINEBET_CORS_ORIGINS: `["http://localhost:${WEB}"]` },
      timeout: 60_000,
    },
    {
      command: `pnpm dev --port ${WEB} --strictPort`,
      url: `http://localhost:${WEB}`,
      env: { API_TARGET: `http://localhost:${API}` },
    },
  ],
})
