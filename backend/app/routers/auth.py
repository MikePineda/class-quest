"""Email + password auth. Bearer JWT, no refresh, no email verification."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.db import get_db
from app.deps import current_user
from app.ids import new_id, utc_now_iso
from app.schemas import LoginIn, ProfileUpdateIn, RegisterIn, TokenOut, UserOut
from app.security import create_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

# Checked against when the email is unknown, so a failed login costs the same
# bcrypt work either way and response time does not reveal whether an account exists.
_DUMMY_HASH = hash_password("dummy-password-for-timing")


def _token_out(user: models.User) -> TokenOut:
    return TokenOut(token=create_token(user.id), user=UserOut.model_validate(user))


@router.post(
    "/register",
    response_model=TokenOut,
    status_code=status.HTTP_201_CREATED,
    responses={409: {"description": "Email already registered"}},
)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    exists = db.query(models.User.id).filter_by(email=body.email).first()
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = models.User(
        id=new_id(),
        email=body.email,
        password_hash=hash_password(body.password),
        display_name=body.display_name,
        created_at=utc_now_iso(),
    )
    db.add(user)
    db.commit()
    return _token_out(user)


@router.post(
    "/login",
    response_model=TokenOut,
    responses={401: {"description": "Invalid email or password"}},
)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(models.User).filter_by(email=body.email).one_or_none()
    hashed = user.password_hash if user else _DUMMY_HASH
    ok = verify_password(body.password, hashed)
    if user is None or not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    return _token_out(user)


@router.get("/me", response_model=UserOut)
def me(user: models.User = Depends(current_user)):
    return user


@router.patch("/me", response_model=UserOut)
def update_me(
    body: ProfileUpdateIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(user, key, value)
    db.commit()
    return user
