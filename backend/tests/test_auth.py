"""Auth routes + the dependency helpers in app/deps.py."""
import pytest
from fastapi import APIRouter, Depends

from app import models
from app.db import SessionLocal
from app.ids import new_id, utc_now_iso
from app.security import create_token, hash_password

REG = {"email": "Ada@Example.com", "password": "correct-horse", "display_name": "  Ada  "}


def _register(client, **overrides):
    return client.post("/auth/register", json={**REG, **overrides})


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------- register


def test_register_returns_token_and_user(client):
    r = _register(client)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["token"]
    assert body["token_type"] == "bearer"
    user = body["user"]
    assert user["email"] == "ada@example.com"  # lowercased + stripped
    assert user["display_name"] == "Ada"  # stripped
    assert user["role"] is None
    assert user["industry"] is None
    assert user["about"] is None
    assert user["id"] and user["created_at"]
    assert "password" not in user and "password_hash" not in user


def test_register_duplicate_email_is_409(client):
    assert _register(client).status_code == 201
    r = _register(client, email="ADA@example.com", display_name="Other")
    assert r.status_code == 409
    assert r.json() == {"detail": "Email already registered"}


def test_register_short_password_is_422(client):
    assert _register(client, password="1234567").status_code == 422


def test_register_bad_email_is_422(client):
    assert _register(client, email="not-an-email").status_code == 422
    assert _register(client, email="a b@example.com").status_code == 422


def test_register_blank_display_name_is_422(client):
    assert _register(client, display_name="   ").status_code == 422


# ---------------------------------------------------------------- login


def test_login_ok(client):
    _register(client)
    r = client.post("/auth/login", json={"email": "ADA@example.com ", "password": REG["password"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token"]
    assert body["token_type"] == "bearer"
    assert body["user"]["email"] == "ada@example.com"


def test_login_wrong_password_is_401(client):
    _register(client)
    r = client.post("/auth/login", json={"email": REG["email"], "password": "wrong-password"})
    assert r.status_code == 401
    assert r.json() == {"detail": "Invalid email or password"}


def test_login_unknown_email_is_401_with_same_body(client):
    r = client.post("/auth/login", json={"email": "nobody@example.com", "password": "whatever1"})
    assert r.status_code == 401
    assert r.json() == {"detail": "Invalid email or password"}


# ---------------------------------------------------------------- /auth/me


def test_me_without_token_is_401(client):
    r = client.get("/auth/me")
    assert r.status_code == 401
    assert r.json() == {"detail": "Not authenticated"}
    assert r.headers.get("WWW-Authenticate") == "Bearer"


def test_me_with_garbage_token_is_401(client):
    r = client.get("/auth/me", headers=_auth("not.a.jwt"))
    assert r.status_code == 401
    assert r.json() == {"detail": "Not authenticated"}


def test_me_with_token_for_deleted_user_is_401(client):
    r = client.get("/auth/me", headers=_auth(create_token("doesnotexist")))
    assert r.status_code == 401
    assert r.json() == {"detail": "Not authenticated"}


def test_me_returns_user(client):
    token = _register(client).json()["token"]
    r = client.get("/auth/me", headers=_auth(token))
    assert r.status_code == 200
    assert r.json()["email"] == "ada@example.com"
    assert r.json()["display_name"] == "Ada"


def test_patch_me_partial_update(client):
    token = _register(client).json()["token"]
    r = client.patch("/auth/me", headers=_auth(token), json={"role": "teacher", "industry": "Law"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == "teacher"
    assert body["industry"] == "Law"
    assert body["display_name"] == "Ada"  # untouched
    assert body["about"] is None  # untouched

    # A second partial update leaves the earlier fields in place.
    r = client.patch("/auth/me", headers=_auth(token), json={"about": "Hi there"})
    body = r.json()
    assert body["about"] == "Hi there"
    assert body["role"] == "teacher"
    assert body["industry"] == "Law"

    # And it is persisted, not just echoed.
    assert client.get("/auth/me", headers=_auth(token)).json()["about"] == "Hi there"


def test_patch_me_invalid_role_is_422(client):
    token = _register(client).json()["token"]
    r = client.patch("/auth/me", headers=_auth(token), json={"role": "wizard"})
    assert r.status_code == 422


def test_patch_me_without_token_is_401(client):
    assert client.patch("/auth/me", json={"role": "teacher"}).status_code == 401


# ---------------------------------------------------------------- deps


def _mount_throwaway(client):
    """A tiny router that exposes the membership dependencies for testing."""
    from app.deps import current_user_optional, require_membership, world_and_membership

    r = APIRouter()

    @r.get("/_t/servers/{server_id}")
    def _server(sm=Depends(require_membership)):
        server, membership = sm
        return {"server_id": server.id, "member_role": membership.role if membership else None}

    @r.get("/_t/worlds/{world_id}")
    def _world(wsm=Depends(world_and_membership)):
        world, server, membership = wsm
        return {
            "world_id": world.id,
            "server_id": server.id,
            "member_role": membership.role if membership else None,
        }

    @r.get("/_t/whoami")
    def _whoami(user=Depends(current_user_optional)):
        return {"user_id": user.id if user else None}

    client.app.include_router(r)


@pytest.fixture
def world_setup(client):
    """Owner + outsider users, a private and a public server, one world each."""
    _mount_throwaway(client)
    now = utc_now_iso()
    db = SessionLocal()
    try:
        owner = models.User(
            id=new_id(), email="owner@example.com", password_hash=hash_password("password1"),
            display_name="Owner", created_at=now,
        )
        outsider = models.User(
            id=new_id(), email="out@example.com", password_hash=hash_password("password1"),
            display_name="Outsider", created_at=now,
        )
        db.add_all([owner, outsider])
        db.flush()
        private = models.Server(
            id=new_id(), name="Private", join_code="ABCDEF", is_public=False, pet="fox",
            owner_id=owner.id, status="ready", created_at=now,
        )
        public = models.Server(
            id=new_id(), name="Public", join_code="GHJKMN", is_public=True, pet="owl",
            owner_id=owner.id, status="ready", created_at=now,
        )
        db.add_all([private, public])
        db.flush()
        db.add(models.Membership(
            id=new_id(), user_id=owner.id, server_id=private.id, role="owner", joined_at=now,
        ))
        private_world = models.World(
            id=new_id(), server_id=private.id, idx=0, title="W0", segment_start=0,
            segment_end=1, status="ready", created_at=now,
        )
        public_world = models.World(
            id=new_id(), server_id=public.id, idx=0, title="W0", segment_start=0,
            segment_end=1, status="ready", created_at=now,
        )
        db.add_all([private_world, public_world])
        db.commit()
        return {
            "owner": _auth(create_token(owner.id)),
            "outsider": _auth(create_token(outsider.id)),
            "private": private.id,
            "public": public.id,
            "private_world": private_world.id,
            "public_world": public_world.id,
        }
    finally:
        db.close()


def test_require_membership_member_passes(client, world_setup):
    r = client.get(f"/_t/servers/{world_setup['private']}", headers=world_setup["owner"])
    assert r.status_code == 200, r.text
    assert r.json() == {"server_id": world_setup["private"], "member_role": "owner"}


def test_require_membership_private_non_member_is_403(client, world_setup):
    r = client.get(f"/_t/servers/{world_setup['private']}", headers=world_setup["outsider"])
    assert r.status_code == 403
    assert r.json() == {"detail": "Not a member of this server"}


def test_require_membership_public_non_member_passes(client, world_setup):
    r = client.get(f"/_t/servers/{world_setup['public']}", headers=world_setup["outsider"])
    assert r.status_code == 200
    assert r.json() == {"server_id": world_setup["public"], "member_role": None}


def test_require_membership_unknown_server_is_404(client, world_setup):
    r = client.get("/_t/servers/nope", headers=world_setup["owner"])
    assert r.status_code == 404


def test_require_membership_needs_auth(client, world_setup):
    r = client.get(f"/_t/servers/{world_setup['public']}")
    assert r.status_code == 401


def test_world_and_membership_member_passes(client, world_setup):
    r = client.get(f"/_t/worlds/{world_setup['private_world']}", headers=world_setup["owner"])
    assert r.status_code == 200, r.text
    assert r.json() == {
        "world_id": world_setup["private_world"],
        "server_id": world_setup["private"],
        "member_role": "owner",
    }


def test_world_and_membership_private_non_member_is_403(client, world_setup):
    r = client.get(f"/_t/worlds/{world_setup['private_world']}", headers=world_setup["outsider"])
    assert r.status_code == 403
    assert r.json() == {"detail": "Not a member of this server"}


def test_world_and_membership_public_non_member_passes(client, world_setup):
    r = client.get(f"/_t/worlds/{world_setup['public_world']}", headers=world_setup["outsider"])
    assert r.status_code == 200
    assert r.json()["member_role"] is None


def test_world_and_membership_unknown_world_is_404(client, world_setup):
    r = client.get("/_t/worlds/nope", headers=world_setup["owner"])
    assert r.status_code == 404


def test_current_user_optional(client, world_setup):
    assert client.get("/_t/whoami").json() == {"user_id": None}
    assert client.get("/_t/whoami", headers=_auth("garbage")).json() == {"user_id": None}
    r = client.get("/_t/whoami", headers=world_setup["owner"])
    assert r.json()["user_id"] is not None
