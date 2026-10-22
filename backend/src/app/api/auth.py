from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, SessionDep
from app.config import get_settings
from app.models import TxKind, User, utcnow
from app.schemas import LoginIn, RegisterIn, TokenOut, UserOut
from app.security import create_access_token, hash_password, verify_password
from app.wallet import apply_transaction

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterIn, session: SessionDep) -> TokenOut:
    if not body.age_confirmed:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Age confirmation (18+) required"
        )

    email = body.email.lower()
    user = User(
        email=email,
        password_hash=hash_password(body.password),
        mc_nick=body.mc_nick,
        age_confirmed_at=utcnow(),
        balance=0,
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered") from None

    bonus = get_settings().starting_balance
    if bonus > 0:
        await apply_transaction(session, user.id, TxKind.SIGNUP_BONUS, bonus)
    await session.commit()
    return TokenOut(access_token=create_access_token(user.id))


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, session: SessionDep) -> TokenOut:
    user = (
        await session.execute(select(User).where(User.email == body.email.lower()))
    ).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    return TokenOut(access_token=create_access_token(user.id))


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> User:
    return user
