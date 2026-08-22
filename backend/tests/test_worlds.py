"""GET /worlds/{id}, attempts, progress, explain."""
from app import models
from app.db import SessionLocal
from app.ids import new_id, utc_now_iso
from app.security import create_token, hash_password
from app.services import explain

from .helpers import make_ready_world


def _register(client, email="a@example.com", name="A"):
    r = client.post("/auth/register", json={
        "email": email, "password": "password123", "display_name": name,
    })
    assert r.status_code == 201, r.text
    return r.json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _server_and_world(db, *, is_public=True, owner_email="owner@example.com"):
    now = utc_now_iso()
    owner = models.User(id=new_id(), email=owner_email, password_hash=hash_password("x"),
                        display_name="Owner", created_at=now)
    db.add(owner)
    db.flush()
    server = models.Server(
        id=new_id(), name="S", join_code=new_id()[:6].upper(), is_public=is_public,
        pet="owl", owner_id=owner.id, status="pending", segment_count=0, created_at=now,
    )
    db.add(server)
    db.flush()
    db.add(models.Membership(id=new_id(), user_id=owner.id, server_id=server.id, role="owner",
                             joined_at=now))
    world = make_ready_world(db, server)
    db.commit()
    return owner, server, world


def _setup(client):
    db = SessionLocal()
    try:
        owner, server, world = _server_and_world(db)
        token = create_token(owner.id)
        return token, server.id, world.id
    finally:
        db.close()


# --------------------------------------------------------------------- get


def test_get_world_returns_graph_and_games_and_progress(client):
    token, _server_id, world_id = _setup(client)
    r = client.get(f"/worlds/{world_id}", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["graph"]["graph_id"] == "wk3ml0a1"
    assert body["games"]["quest"]["game_id"] == "q7kp2wm4"
    assert body["games"]["gauntlet"]["game_id"] == "g3xn8vr1"
    assert body["my_progress"] == {
        "xp": 0, "scenes_total": 5, "scenes_attempted": 0, "scenes_correct": 0,
        "explained_concept_ids": [],
    }


def test_get_world_not_ready_returns_nulls(client):
    db = SessionLocal()
    try:
        now = utc_now_iso()
        owner = models.User(id=new_id(), email="nr@example.com", password_hash=hash_password("x"),
                            display_name="O", created_at=now)
        db.add(owner)
        db.flush()
        server = models.Server(id=new_id(), name="S", join_code=new_id()[:6].upper(),
                               is_public=True, pet="owl", owner_id=owner.id, status="processing",
                               segment_count=0, created_at=now)
        db.add(server)
        db.flush()
        db.add(models.Membership(id=new_id(), user_id=owner.id, server_id=server.id, role="owner",
                                 joined_at=now))
        world = models.World(id=new_id(), server_id=server.id, idx=0, title="W",
                             segment_start=0, segment_end=0, status="processing", stage="graph",
                             created_at=now)
        db.add(world)
        db.commit()
        token = create_token(owner.id)
        world_id = world.id
    finally:
        db.close()

    r = client.get(f"/worlds/{world_id}", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["graph"] is None
    assert body["games"]["quest"] is None
    assert body["games"]["gauntlet"] is None


def test_non_member_on_private_server_is_403(client):
    db = SessionLocal()
    try:
        _owner, _server, world = _server_and_world(db, is_public=False)
        world_id = world.id
    finally:
        db.close()
    outsider = _register(client, email="out@example.com", name="Out")
    r = client.get(f"/worlds/{world_id}", headers=_auth(outsider))
    assert r.status_code == 403


# ---------------------------------------------------------------- attempts


def test_attempt_correct_then_repeat(client):
    token, server_id, world_id = _setup(client)
    r1 = client.post(
        f"/worlds/{world_id}/attempts",
        json={"archetype": "quest", "scene_id": "sc_pred_overfit", "option_id": "op_worse"},
        headers=_auth(token),
    )
    assert r1.status_code == 200, r1.text
    b1 = r1.json()
    assert b1["correct"] is True
    assert b1["xp_awarded"] == 10
    assert b1["first_time"] is True
    assert b1["misconception"] is None
    assert b1["world_xp"] == 10
    assert b1["server_xp"] == 10

    r2 = client.post(
        f"/worlds/{world_id}/attempts",
        json={"archetype": "quest", "scene_id": "sc_pred_overfit", "option_id": "op_worse"},
        headers=_auth(token),
    )
    assert r2.status_code == 200
    b2 = r2.json()
    assert b2["xp_awarded"] == 0
    assert b2["first_time"] is False


def test_attempt_wrong_awards_2_xp_and_misconception(client):
    token, _server_id, world_id = _setup(client)
    r = client.post(
        f"/worlds/{world_id}/attempts",
        json={"archetype": "quest", "scene_id": "sc_pred_overfit", "option_id": "op_same"},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["correct"] is False
    assert body["xp_awarded"] == 2
    assert body["misconception"]["id"] == "high_train_high_test"
    assert body["reveal"]


def test_attempt_unknown_scene_and_option_404(client):
    token, _server_id, world_id = _setup(client)
    r = client.post(
        f"/worlds/{world_id}/attempts",
        json={"archetype": "quest", "scene_id": "nope", "option_id": "op_worse"},
        headers=_auth(token),
    )
    assert r.status_code == 404

    r2 = client.post(
        f"/worlds/{world_id}/attempts",
        json={"archetype": "quest", "scene_id": "sc_pred_overfit", "option_id": "nope"},
        headers=_auth(token),
    )
    assert r2.status_code == 404


def test_attempt_on_dialogue_scene_is_422(client):
    token, _server_id, world_id = _setup(client)
    r = client.post(
        f"/worlds/{world_id}/attempts",
        json={"archetype": "quest", "scene_id": "sc_open", "option_id": "whatever"},
        headers=_auth(token),
    )
    assert r.status_code == 422


def test_attempt_gauntlet_archetype_reads_gauntlet_game(client):
    token, _server_id, world_id = _setup(client)
    r = client.post(
        f"/worlds/{world_id}/attempts",
        json={"archetype": "gauntlet", "scene_id": "g_overfit", "option_id": "op_worse"},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["correct"] is True

    # a quest-only scene id does not exist in the gauntlet game
    r2 = client.post(
        f"/worlds/{world_id}/attempts",
        json={"archetype": "gauntlet", "scene_id": "sc_pred_overfit", "option_id": "op_worse"},
        headers=_auth(token),
    )
    assert r2.status_code == 404


# ---------------------------------------------------------------- progress


def test_progress_aggregation(client):
    token, _server_id, world_id = _setup(client)
    client.post(
        f"/worlds/{world_id}/attempts",
        json={"archetype": "quest", "scene_id": "sc_pred_overfit", "option_id": "op_same"},
        headers=_auth(token),
    )
    client.post(
        f"/worlds/{world_id}/attempts",
        json={"archetype": "quest", "scene_id": "sc_pred_overfit", "option_id": "op_worse"},
        headers=_auth(token),
    )
    r = client.get(f"/worlds/{world_id}/progress", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    scene = next(s for s in body["scenes"] if s["scene_id"] == "sc_pred_overfit")
    assert scene["attempts"] == 2
    assert scene["best_correct"] is True
    assert scene["chosen_option_id"] == "op_same"  # first attempt's choice
    assert body["xp"] == 2  # first attempt wrong=2xp, repeat=0xp


# ----------------------------------------------------------------- explain

_CONCEPT = "overfitting"


def test_explain_happy_path_first_pass_then_repeat(client, monkeypatch):
    token, _server_id, world_id = _setup(client)
    monkeypatch.setattr(
        explain, "grade_explanation",
        lambda concept, text: {"score": 82, "verdict": "pass", "feedback": "Great.",
                               "misconception_id": None},
    )
    r1 = client.post(
        f"/worlds/{world_id}/explain",
        json={"concept_id": _CONCEPT, "text": "A" * 30},
        headers=_auth(token),
    )
    assert r1.status_code == 200, r1.text
    b1 = r1.json()
    assert b1["xp_awarded"] == 25
    assert b1["concept"]["id"] == _CONCEPT
    assert b1["world_xp"] == 25

    r2 = client.post(
        f"/worlds/{world_id}/explain",
        json={"concept_id": _CONCEPT, "text": "B" * 30},
        headers=_auth(token),
    )
    assert r2.status_code == 200
    assert r2.json()["xp_awarded"] == 0

    db = SessionLocal()
    try:
        rows = db.query(models.Explanation).filter_by(world_id=world_id).all()
        assert len(rows) == 2
    finally:
        db.close()


def test_explain_unknown_concept_404(client, monkeypatch):
    token, _server_id, world_id = _setup(client)
    monkeypatch.setattr(
        explain, "grade_explanation",
        lambda concept, text: {"score": 82, "verdict": "pass", "feedback": "x",
                               "misconception_id": None},
    )
    r = client.post(
        f"/worlds/{world_id}/explain",
        json={"concept_id": "not_a_concept", "text": "A" * 30},
        headers=_auth(token),
    )
    assert r.status_code == 404


def test_explain_short_text_422(client):
    token, _server_id, world_id = _setup(client)
    r = client.post(
        f"/worlds/{world_id}/explain",
        json={"concept_id": _CONCEPT, "text": "too short"},
        headers=_auth(token),
    )
    assert r.status_code == 422


def test_explain_grader_unavailable_503(client, monkeypatch):
    token, _server_id, world_id = _setup(client)

    def _boom(concept, text):
        raise explain.GraderUnavailable("down")

    monkeypatch.setattr(explain, "grade_explanation", _boom)
    r = client.post(
        f"/worlds/{world_id}/explain",
        json={"concept_id": _CONCEPT, "text": "A" * 30},
        headers=_auth(token),
    )
    assert r.status_code == 503
