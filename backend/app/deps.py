"""FastAPI dependencies: who is calling, and may they see this server/world.

Membership helpers return the Membership row (or None) alongside the parent
rows so routers can branch on role without a second query.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app import models
from app.db import get_db
from app.security import TokenError, decode_token

bearer = HTTPBearer(auto_error=False)

_UNAUTHENTICATED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


def _user_from_creds(creds: HTTPAuthorizationCredentials | None, db: Session) -> models.User | None:
    if creds is None or not creds.credentials:
        return None
    try:
        user_id = decode_token(creds.credentials)
    except TokenError:
        return None
    return db.get(models.User, user_id)


def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> models.User:
    user = _user_from_creds(creds, db)
    if user is None:
        raise _UNAUTHENTICATED
    return user


def current_user_optional(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> models.User | None:
    """Like current_user, but a missing/invalid token yields None instead of 401."""
    return _user_from_creds(creds, db)


def _membership_for(
    server: models.Server, user: models.User, db: Session
) -> models.Membership | None:
    membership = (
        db.query(models.Membership)
        .filter_by(server_id=server.id, user_id=user.id)
        .one_or_none()
    )
    if membership is None and not server.is_public:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this server")
    return membership


def require_membership(
    server_id: str,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> tuple[models.Server, models.Membership | None]:
    """404 unknown server; 403 private + not a member; public servers pass anyone."""
    server = db.get(models.Server, server_id)
    if server is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Server not found")
    return server, _membership_for(server, user, db)


def world_and_membership(
    world_id: str,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> tuple[models.World, models.Server, models.Membership | None]:
    """Same rules as require_membership, resolved through the world's server."""
    world = db.get(models.World, world_id)
    if world is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "World not found")
    server = db.get(models.Server, world.server_id)
    if server is None:  # orphaned row; treat as missing
        raise HTTPException(status.HTTP_404_NOT_FOUND, "World not found")
    return world, server, _membership_for(server, user, db)
