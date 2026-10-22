"""Responsible-gaming rules: daily deposit and loss limits and self-exclusion.

Limits look at the rolling last 24 hours of the ledger. Self-exclusion can only be extended,
never shortened. Raising or removing a limit is allowed at once; that is a known simplification.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Transaction, TxKind, User, utcnow

WINDOW = timedelta(hours=24)
# Allowed self-exclusion lengths, in hours: 1 h, 1 day, 7 days, 30 days, 180 days.
EXCLUSION_HOURS = (1, 24, 168, 720, 4320)


class PlayBlocked(Exception):
    """Base for refusals that come from the player's own limits."""


class SelfExcluded(PlayBlocked):
    def __init__(self, until: datetime) -> None:
        super().__init__(f"Self-excluded until {until.isoformat()}")
        self.until = until


class LossLimitReached(PlayBlocked):
    def __init__(self, remaining: int) -> None:
        super().__init__(f"Loss limit reached: {remaining} left")
        self.remaining = remaining


class DepositLimitReached(PlayBlocked):
    def __init__(self, remaining: int) -> None:
        super().__init__(f"Deposit limit reached: {remaining} left")
        self.remaining = remaining


def aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def excluded_until(user: User) -> datetime | None:
    until = aware(user.excluded_until)
    return until if until is not None and until > utcnow() else None


async def _sum(session: AsyncSession, user_id: int, kinds: tuple[TxKind, ...]) -> int:
    since = utcnow() - WINDOW
    total = await session.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.user_id == user_id,
            Transaction.kind.in_(kinds),
            Transaction.created_at >= since,
        )
    )
    return int(total or 0)


async def deposited_24h(session: AsyncSession, user_id: int) -> int:
    return await _sum(session, user_id, (TxKind.DEPOSIT,))


async def lost_24h(session: AsyncSession, user_id: int) -> int:
    """Net loss from play over the window (bets are negative, wins positive); never below 0."""
    return max(0, -await _sum(session, user_id, (TxKind.BET, TxKind.WIN)))


async def check_play(session: AsyncSession, user_id: int, cost: int) -> None:
    user = await session.get(User, user_id)
    if user is None:
        return
    if (until := excluded_until(user)) is not None:
        raise SelfExcluded(until)
    if user.loss_limit is not None:
        remaining = user.loss_limit - await lost_24h(session, user_id)
        if cost > remaining:
            raise LossLimitReached(max(0, remaining))


async def check_deposit(session: AsyncSession, user_id: int, amount: int) -> None:
    user = await session.get(User, user_id)
    if user is None:
        return
    if (until := excluded_until(user)) is not None:
        raise SelfExcluded(until)
    if user.deposit_limit is not None:
        remaining = user.deposit_limit - await deposited_24h(session, user_id)
        if amount > remaining:
            raise DepositLimitReached(max(0, remaining))


def exclude(user: User, hours: int) -> datetime:
    """Start or extend a self-exclusion; a shorter request never reduces an existing one."""
    until = utcnow() + timedelta(hours=hours)
    current = aware(user.excluded_until)
    if current is not None and current > until:
        return current
    user.excluded_until = until
    return until
