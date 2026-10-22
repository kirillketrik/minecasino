from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep
from app.config import get_settings
from app.limits import PlayBlocked, check_deposit
from app.models import Transaction, TxKind, WithdrawalRequest
from app.schemas import DepositIn, TransactionOut, WithdrawalOut, WithdrawIn
from app.wallet import InsufficientFunds, apply_transaction

router = APIRouter(prefix="/wallet", tags=["wallet"])


@router.get("/transactions", response_model=list[TransactionOut])
async def list_transactions(
    user: CurrentUser,
    session: SessionDep,
    limit: int = Query(50, ge=1, le=200),
    before_id: int | None = Query(None, ge=1),
) -> list[Transaction]:
    query = select(Transaction).where(Transaction.user_id == user.id)
    if before_id is not None:
        query = query.where(Transaction.id < before_id)
    result = await session.execute(query.order_by(Transaction.id.desc()).limit(limit))
    return list(result.scalars())


@router.post("/deposit", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
async def deposit(body: DepositIn, user: CurrentUser, session: SessionDep) -> Transaction:
    """Stub for the payment gateway: credits coins directly. Disabled outside stub mode."""
    settings = get_settings()
    if not settings.payments_stub:
        raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Payment gateway not connected")
    if body.amount > settings.stub_deposit_max:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"Max {settings.stub_deposit_max} per deposit"
        )
    try:
        await check_deposit(session, user.id, body.amount)
    except PlayBlocked as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e)) from None
    tx = await apply_transaction(session, user.id, TxKind.DEPOSIT, body.amount, ref="stub")
    await session.commit()
    return tx


@router.post("/withdrawals", response_model=WithdrawalOut, status_code=status.HTTP_201_CREATED)
async def request_withdrawal(
    body: WithdrawIn, user: CurrentUser, session: SessionDep
) -> WithdrawalRequest:
    """Reserve coins and create a pending request. Delivery to the server is not implemented."""
    minimum = get_settings().min_withdrawal
    if body.amount < minimum:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"Minimum withdrawal is {minimum}"
        )

    request = WithdrawalRequest(
        user_id=user.id, amount=body.amount, mc_nick=user.mc_nick, server=body.server
    )
    session.add(request)
    await session.flush()
    try:
        await apply_transaction(
            session, user.id, TxKind.WITHDRAWAL, -body.amount, ref=f"wd:{request.id}"
        )
    except InsufficientFunds:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Insufficient funds") from None
    await session.commit()
    return request


@router.get("/withdrawals", response_model=list[WithdrawalOut])
async def list_withdrawals(user: CurrentUser, session: SessionDep) -> list[WithdrawalRequest]:
    result = await session.execute(
        select(WithdrawalRequest)
        .where(WithdrawalRequest.user_id == user.id)
        .order_by(WithdrawalRequest.id.desc())
    )
    return list(result.scalars())
