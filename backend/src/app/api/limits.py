from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app import limits
from app.api.deps import CurrentUser, SessionDep

router = APIRouter(prefix="/limits", tags=["limits"])


class LimitsOut(BaseModel):
    deposit_limit: int | None
    loss_limit: int | None
    deposited_24h: int
    lost_24h: int
    excluded_until: datetime | None
    exclusion_hours: list[int] = list(limits.EXCLUSION_HOURS)


class LimitsIn(BaseModel):
    deposit_limit: int | None = Field(None, ge=1)
    loss_limit: int | None = Field(None, ge=1)


class ExclusionIn(BaseModel):
    hours: int


async def _out(user: CurrentUser, session: SessionDep) -> LimitsOut:
    return LimitsOut(
        deposit_limit=user.deposit_limit,
        loss_limit=user.loss_limit,
        deposited_24h=await limits.deposited_24h(session, user.id),
        lost_24h=await limits.lost_24h(session, user.id),
        excluded_until=limits.excluded_until(user),
    )


@router.get("", response_model=LimitsOut)
async def get_limits(user: CurrentUser, session: SessionDep) -> LimitsOut:
    return await _out(user, session)


@router.put("", response_model=LimitsOut)
async def set_limits(body: LimitsIn, user: CurrentUser, session: SessionDep) -> LimitsOut:
    user.deposit_limit = body.deposit_limit
    user.loss_limit = body.loss_limit
    await session.commit()
    return await _out(user, session)


@router.post("/exclusion", response_model=LimitsOut)
async def self_exclude(body: ExclusionIn, user: CurrentUser, session: SessionDep) -> LimitsOut:
    """Blocks play and deposits until the date; it can be extended but never cancelled."""
    if body.hours not in limits.EXCLUSION_HOURS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unsupported exclusion length")
    limits.exclude(user, body.hours)
    await session.commit()
    return await _out(user, session)
