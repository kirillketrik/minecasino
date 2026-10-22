import enum
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class TxKind(enum.StrEnum):
    SIGNUP_BONUS = "signup_bonus"
    DEPOSIT = "deposit"
    WITHDRAWAL = "withdrawal"
    WITHDRAWAL_REFUND = "withdrawal_refund"
    BET = "bet"
    WIN = "win"


class WithdrawalStatus(enum.StrEnum):
    PENDING = "pending"
    COMPLETED = "completed"
    REJECTED = "rejected"


class McServer(enum.StrEnum):
    FUNTIME = "funtime"
    HOLYWORLD = "holyworld"


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("balance >= 0", name="ck_users_balance_non_negative"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    mc_nick: Mapped[str] = mapped_column(String(16), index=True)
    age_confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Integer coins; 1 RUB = 1 coin. Only app.wallet may change this column.
    balance: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Responsible gaming (see app.limits): daily limits in coins, None = no limit.
    deposit_limit: Mapped[int | None] = mapped_column(BigInteger, default=None)
    loss_limit: Mapped[int | None] = mapped_column(BigInteger, default=None)
    excluded_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    transactions: Mapped[list["Transaction"]] = relationship(back_populates="user")


class Transaction(Base):
    """Append-only ledger. `amount` is signed; `balance_after` is the user's balance after it."""

    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[TxKind] = mapped_column(Enum(TxKind, native_enum=False, length=32))
    amount: Mapped[int] = mapped_column(BigInteger)
    balance_after: Mapped[int] = mapped_column(BigInteger)
    ref: Mapped[str | None] = mapped_column(String(64), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship(back_populates="transactions")


class WithdrawalRequest(Base):
    __tablename__ = "withdrawal_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    amount: Mapped[int] = mapped_column(BigInteger)
    mc_nick: Mapped[str] = mapped_column(String(16))
    server: Mapped[McServer] = mapped_column(Enum(McServer, native_enum=False, length=16))
    status: Mapped[WithdrawalStatus] = mapped_column(
        Enum(WithdrawalStatus, native_enum=False, length=16), default=WithdrawalStatus.PENDING
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Round(Base):
    """One play of a game. `state` is private to the server; `view` is what the client may see."""

    __tablename__ = "rounds"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    game_id: Mapped[str] = mapped_column(String(32), index=True)
    bet: Mapped[int] = mapped_column(BigInteger)
    payout: Mapped[int] = mapped_column(BigInteger, default=0)
    finished: Mapped[bool] = mapped_column(Boolean, default=False)
    state: Mapped[dict] = mapped_column(JSON, default=dict)
    view: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
