# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Backend: Python 3.12, uv, FastAPI, SQLAlchemy 2 (async), Alembic, PostgreSQL, pytest.
Frontend: React + Vite + TypeScript, PixiJS for reels, cascades and the crash graph. Monorepo `backend/` + `frontend/`, docker-compose for Postgres.

## Users

Players of Minecraft servers FunTime and HolyWorld LITE, 18+ only, confirmed at registration. They come to turn server in-game currency (coins) into game rounds and back, tied to their Minecraft nickname.

## Product Purpose

MineBet ("MineCasino") is a Minecraft-themed game site with 10 betting modes (slots, cluster/cascade slot, crash, grid game, mini-games). Players top up coins (1 RUB = 1 coin), play rounds, and withdraw winnings to the Minecraft server by the linked nickname. Every round's win is capped at 100x the bet.

MVP scope: three games (Shahta/Mining 5x3 20-line slot with free spins and gamble, Creeper 6x5 cluster/cascade slot, Elytra crash), virtual coins with a stubbed payment gateway, email + password auth with unverified nickname, withdrawal as a stub request recorded in the DB.

## Positioning

Server-currency economy plus a Minecraft world: bets are in server coins bound to a nickname, winnings go out to the server, and every mechanic is a re-imagined Minecraft activity (mining, creepers, elytra flight).

## Operating Context

Roster of 10 modes from "Слоты MineBet.pdf": Шахта, Крипер, Нижний мир, Рейд Базы, Древний Город, Элитры и Небо, Зельеварение, Кровавая Луна, Тотем Бессмертия, Пиратская Бухта. Project scheme "СХЕМА MineBet.pdf": auth + profile, finance and bonuses (AnyPay, FreeKassa, FKWallet; daily rewards, tasks, referrals), game catalog, donate shop (no randomness), withdrawal to server (FunTime / HolyWorld LITE).

## Capabilities and Constraints

- All outcomes are decided server-side (secrets-based RNG); the client only renders results. Balance in integer coins, every change recorded in a transactions ledger inside one DB transaction.
- Win per spin or bonus round: payout <= bet * 100, applied centrally.
- Target RTP 96%, calibrated by Monte Carlo simulation tests.
- Crash is individual per player in MVP (not a shared multiplayer round); max multiplier 100.00x.
- No real payments, no real server withdrawal, no nickname verification in MVP.
- 18+ gate and responsible-gaming screen are required.
- Out of MVP: 7 other modes, donate shop, bonuses, referrals, admin, provably fair (schema should leave room).

## Brand Commitments

Minecraft theme is binding. Do not copy Mojang assets or logos (copyright); pixel art and icons are drawn originally.

## Evidence on Hand

Two PDFs in Downloads/Telegram Desktop (game specs and project scheme). No logos, photos, testimonials, customers or press exist; do not invent any. Legal licensing of gambling is unestablished: this is recorded as an open risk, not a claim.

## Product Principles

- The server is the authority on every outcome and every coin.
- The 100x cap and the RTP are product rules, enforced in one place, not per game.
- Each game is a Minecraft activity, not a generic slot with a texture pack.
- Players always see their balance, bet, and last result clearly; responsible-gaming tools are part of the product, not an afterthought.

## Accessibility & Inclusion

Interface language Russian. Respect `prefers-reduced-motion`; spins and cascades must remain understandable without motion. Keyboard-operable controls and readable contrast on pixel styling.
