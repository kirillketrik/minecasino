from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints

from app.models import McServer, TxKind, WithdrawalStatus

McNick = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_]{3,16}$")]


class RegisterIn(BaseModel):
    email: EmailStr
    password: Annotated[str, StringConstraints(min_length=8, max_length=128)]
    mc_nick: McNick
    age_confirmed: bool


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    mc_nick: str
    balance: int
    created_at: datetime
    excluded_until: datetime | None = None


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: TxKind
    amount: int
    balance_after: int
    ref: str | None
    created_at: datetime


class DepositIn(BaseModel):
    amount: Annotated[int, Field(gt=0)]


class WithdrawIn(BaseModel):
    amount: Annotated[int, Field(gt=0)]
    server: McServer


class WithdrawalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    amount: int
    mc_nick: str
    server: McServer
    status: WithdrawalStatus
    created_at: datetime
