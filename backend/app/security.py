"""Passwords (bcrypt) and bearer tokens (HS256 JWT, no refresh)."""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import get_settings

# 10 rounds: the box is an ARM Ampere and 12 rounds makes login feel broken.
_ROUNDS = 10


class TokenError(Exception):
    pass


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt(rounds=_ROUNDS)).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except (ValueError, TypeError):
        return False


def create_token(user_id: str, expires_hours: int | None = None) -> str:
    s = get_settings()
    hours = s.jwt_expire_hours if expires_hours is None else expires_hours
    now = datetime.now(timezone.utc)
    payload = {"sub": user_id, "iat": now, "exp": now + timedelta(hours=hours)}
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> str:
    try:
        payload = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise TokenError(str(e)) from e
    sub = payload.get("sub")
    if not sub:
        raise TokenError("missing sub")
    return sub
