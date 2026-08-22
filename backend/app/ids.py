"""Identifiers and timestamps. Ids are never produced by the model."""
import secrets
import uuid
from datetime import datetime, timezone

# No 0/O/1/I: join codes get read out loud and typed on phones.
JOIN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def new_id() -> str:
    return uuid.uuid4().hex


def artifact_id() -> str:
    """graph_id / game_id. 12 lowercase hex chars, matches ^[a-z0-9]{8,32}$."""
    return secrets.token_hex(6)


def join_code() -> str:
    return "".join(secrets.choice(JOIN_ALPHABET) for _ in range(6))


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
