"""The only place that mutates `User.balance`.

Every change locks the user row, checks the balance, updates it and appends a ledger row, all
inside the caller's DB transaction. The caller commits; a failure rolls the whole thing back.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Transaction, TxKind, User


class InsufficientFunds(Exception):
    pass


async def apply_transaction(
    session: AsyncSession,
    user_id: int,
    kind: TxKind,
    amount: int,
    ref: str | None = None,
) -> Transaction:
    """Apply a signed `amount` (coins) to the user's balance and record it in the ledger."""
    if amount == 0:
        raise ValueError("amount must be non-zero")

    user = (
        await session.execute(select(User).where(User.id == user_id).with_for_update())
    ).scalar_one()

    new_balance = user.balance + amount
    if new_balance < 0:
        raise InsufficientFunds
    user.balance = new_balance

    tx = Transaction(user_id=user_id, kind=kind, amount=amount, balance_after=new_balance, ref=ref)
    session.add(tx)
    await session.flush()
    return tx
