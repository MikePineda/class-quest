"""GET /worlds/{id}, attempts, progress, explain."""
from app import models
from app.db import SessionLocal
from app.ids import new_id, utc_now_iso
from app.security import create_token, hash_password
from app.services import explain

from .helpers import make_ready_world


def _register(client, email="a@example.com", name="A"):
    r = client.post("/auth/register", json={
        "email": email, "password": "thistle marmalade rowboat", "display_name": name,
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
        "xp": 0, "scenes_total": 6, "scenes_attempted": 0, "scenes_correct": 0,
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


# ------------------------------------------------------------ explain/turn

# Three learner turns that walk the fixture student from 47 to a pass on the
# bundled `overfitting` concept. Only the learner turns are ever scored, so the
# `student` lines here stand in for whatever the server said last time.
_CHAT = [
    {"role": "learner",
     "text": "Overfitting is when a model learns the training data too well."},
    {"role": "student",
     "text": "Wait — I thought 99 percent on training means roughly 99 percent on new data. "
             "Why is that not right?"},
    {"role": "learner",
     "text": "The two scores decouple once the model starts fitting noise: training error "
             "keeps falling while the error on new data rises, so a near perfect training "
             "score with no validation check is a warning sign, not a result."},
    {"role": "student",
     "text": "Wait — I thought Overfitting means the data was dirty. Why is that not right?"},
    {"role": "learner",
     "text": "The data can be perfectly clean. Overfitting is about the model having enough "
             "capacity to memorise whatever it is given, so it captures noise specific to "
             "the training set."},
]


def _rows(world_id):
    db = SessionLocal()
    try:
        return (
            db.query(models.Explanation).filter_by(world_id=world_id).count(),
            db.query(models.Attempt).filter_by(world_id=world_id, archetype="explain").count(),
        )
    finally:
        db.close()


def _turn(client, token, world_id, turns, concept=_CONCEPT):
    return client.post(
        f"/worlds/{world_id}/explain/turn",
        json={"concept_id": concept, "turns": turns},
        headers=_auth(token),
    )


def test_explain_turn_mid_conversation_writes_nothing(client):
    token, _server_id, world_id = _setup(client)
    r = _turn(client, token, world_id, _CHAT[:1])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["done"] is False
    assert body["result"] is None
    assert body["question"]
    assert body["targeted_misconception_id"] == "high_train_high_test"
    assert 0 < body["understanding"] < 100
    assert body["turns_remaining"] == 3

    # Nothing is persisted until the student is done: no rows, no XP.
    assert _rows(world_id) == (0, 0)
    prog = client.get(f"/worlds/{world_id}/progress", headers=_auth(token)).json()
    assert prog["xp"] == 0
    assert prog["explanations"] == []


def test_explain_turn_completed_conversation_awards_once(client):
    token, _server_id, world_id = _setup(client)
    r = _turn(client, token, world_id, _CHAT)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["done"] is True
    assert body["question"] is None
    assert body["turns_remaining"] == 0
    result = body["result"]
    assert result["verdict"] == "pass"
    assert result["xp_awarded"] == 25
    assert result["world_xp"] == 25
    assert result["concept"]["id"] == _CONCEPT
    assert body["understanding"] == result["score"]

    assert _rows(world_id) == (1, 1)

    db = SessionLocal()
    try:
        row = db.query(models.Explanation).filter_by(world_id=world_id).one()
        assert "learner:" in row.text and "student:" in row.text
        assert _CHAT[0]["text"] in row.text
        assert row.score == result["score"] and row.verdict == "pass"
    finally:
        db.close()

    # A second completed conversation on the same concept stores a second row
    # but pays nothing.
    r2 = _turn(client, token, world_id, _CHAT)
    assert r2.status_code == 200
    assert r2.json()["result"]["xp_awarded"] == 0
    assert _rows(world_id) == (2, 2)


def test_explain_turn_unknown_concept_404(client):
    token, _server_id, world_id = _setup(client)
    assert _turn(client, token, world_id, _CHAT, concept="not_a_concept").status_code == 404


def test_explain_turn_not_ready_409(client):
    token, _server_id, world_id = _setup(client)
    db = SessionLocal()
    try:
        db.get(models.World, world_id).status = "processing"
        db.commit()
    finally:
        db.close()
    assert _turn(client, token, world_id, _CHAT[:1]).status_code == 409


def test_explain_turn_rejects_bad_transcripts_422(client):
    token, _server_id, world_id = _setup(client)
    long_line = {"role": "learner", "text": "a" * 700}
    cases = {
        "too many turns": [dict(_CHAT[0]) for _ in range(13)],
        "last turn is the student's": [_CHAT[0], _CHAT[1]],
        "not enough learner text": [{"role": "learner", "text": "too short"}],
        "one oversized turn": [{"role": "learner", "text": "a" * 1201}],
        "transcript over the total cap": [long_line for _ in range(12)],
    }
    for name, turns in cases.items():
        assert _turn(client, token, world_id, turns).status_code == 422, name
    assert _rows(world_id) == (0, 0)


def test_explain_turn_non_member_on_private_server_is_403(client):
    db = SessionLocal()
    try:
        _owner, _server, world = _server_and_world(db, is_public=False)
        world_id = world.id
    finally:
        db.close()
    outsider = _register(client, email="out2@example.com", name="Out")
    assert _turn(client, outsider, world_id, _CHAT[:1]).status_code == 403
