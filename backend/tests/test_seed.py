"""The demo server seed: idempotent, never blocks startup, and produces a
server that plays end to end through the API."""
import json

from app import models
from app.config import get_settings
from app.db import Base, SessionLocal, engine
from app.ids import new_id
from app.services import fixtures, progress, scoring, seed, validators


def test_ensure_demo_server_creates_user_server_world():
    seed.ensure_demo_server()
    db = SessionLocal()
    try:
        users = db.query(models.User).filter_by(email=seed.DEMO_EMAIL).all()
        assert len(users) == 1
        servers = db.query(models.Server).filter_by(join_code=seed.DEMO_JOIN_CODE).all()
        assert len(servers) == 1
        server = servers[0]
        assert server.status == "ready"
        assert server.is_public is True
        worlds = db.query(models.World).filter_by(server_id=server.id).all()
        assert len(worlds) == 1
        assert worlds[0].status == "ready"
        segments = db.query(models.Segment).filter_by(server_id=server.id).all()
        assert len(segments) == 14
    finally:
        db.close()


def test_ensure_demo_server_is_idempotent():
    seed.ensure_demo_server()
    seed.ensure_demo_server()
    db = SessionLocal()
    try:
        assert db.query(models.User).filter_by(email=seed.DEMO_EMAIL).count() == 1
        assert db.query(models.Server).filter_by(join_code=seed.DEMO_JOIN_CODE).count() == 1
        assert db.query(models.World).count() == 1
    finally:
        db.close()


def test_demo_login_works_through_the_api(client):
    seed.ensure_demo_server()
    r = client.post("/auth/login", json={"email": seed.DEMO_EMAIL, "password": seed.DEMO_PASSWORD})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email"] == seed.DEMO_EMAIL


def test_demo_server_listed_public_with_null_join_code(client):
    seed.ensure_demo_server()
    r = client.get("/servers/public")
    assert r.status_code == 200
    servers = r.json()["servers"]
    demo = next(s for s in servers if s["join_code"] is None and s["pet"] == "owl")
    assert demo["status"] == "ready"
    assert demo["is_public"] is True


def test_demo_server_joinable(client):
    seed.ensure_demo_server()
    reg = client.post("/auth/register", json={
        "email": "student@example.com", "password": "thistle marmalade rowboat", "display_name": "Student",
    })
    token = reg.json()["token"]
    r = client.post(
        "/servers/join", json={"join_code": "DEMO01"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["already_member"] is False
    assert body["server"]["join_code"] == "DEMO01"


def test_seeded_world_validates():
    seed.ensure_demo_server()
    db = SessionLocal()
    try:
        server = db.query(models.Server).filter_by(join_code=seed.DEMO_JOIN_CODE).one()
        world = db.query(models.World).filter_by(server_id=server.id).one()
        graph = json.loads(world.graph_json)
        quest = json.loads(world.quest_json)
        gauntlet = json.loads(world.gauntlet_json)
        segments = [s.text for s in
                    db.query(models.Segment).filter_by(server_id=server.id).order_by(models.Segment.seq)]
        assert validators.validate_graph(graph, segments) == []
        assert validators.validate_game(quest, graph) == []
        assert validators.validate_game(gauntlet, graph) == []
    finally:
        db.close()


# --- the classmate cohort --------------------------------------------------


def _demo_server(db):
    return db.query(models.Server).filter_by(join_code=seed.DEMO_JOIN_CODE).one()


def test_cohort_creates_classmates_memberships_and_attempts():
    seed.ensure_demo_server()
    seed.ensure_demo_cohort()
    db = SessionLocal()
    try:
        server = _demo_server(db)
        assert len(seed.DEMO_COHORT) == 10
        for email in seed.COHORT_EMAILS:
            assert db.query(models.User).filter_by(email=email).count() == 1
        # 10 classmates + the demo owner.
        assert db.query(models.Membership).filter_by(server_id=server.id).count() == 11
        attempts = db.query(models.Attempt).filter_by(server_id=server.id).all()
        assert len(attempts) == 54
        assert {a.archetype for a in attempts} == {"quest", "gauntlet"}
        # Only real scenes and real options of the seeded world.
        world = db.query(models.World).filter_by(server_id=server.id).one()
        games = {"quest": json.loads(world.quest_json), "gauntlet": json.loads(world.gauntlet_json)}
        by_scene = {
            sc["id"]: sc
            for game in games.values()
            for ch in game["chapters"]
            for sc in ch["scenes"]
            if sc["type"] == "prediction"
        }
        for a in attempts:
            scene = by_scene[a.scene_id]
            option = next(o for o in scene["options"] if o["id"] == a.option_id)
            assert option["correct"] is a.correct
            assert a.game_id == (world.quest_id if a.archetype == "quest" else world.gauntlet_id)
    finally:
        db.close()


def test_cohort_xp_comes_from_the_scoring_rule():
    seed.ensure_demo_server()
    seed.ensure_demo_cohort()
    db = SessionLocal()
    try:
        server = _demo_server(db)
        for a in db.query(models.Attempt).filter_by(server_id=server.id):
            assert a.xp == scoring.xp_for_prediction(correct=a.correct, first_time=True)
    finally:
        db.close()


def test_cohort_is_idempotent():
    seed.ensure_demo_server()
    seed.ensure_demo_cohort()
    db = SessionLocal()
    try:
        server = _demo_server(db)
        users = db.query(models.User).count()
        memberships = db.query(models.Membership).filter_by(server_id=server.id).count()
        attempts = db.query(models.Attempt).filter_by(server_id=server.id).count()
    finally:
        db.close()

    seed.ensure_demo_cohort()
    seed.ensure_demo_cohort()

    db = SessionLocal()
    try:
        server = _demo_server(db)
        assert db.query(models.User).count() == users
        assert db.query(models.Membership).filter_by(server_id=server.id).count() == memberships
        assert db.query(models.Attempt).filter_by(server_id=server.id).count() == attempts
    finally:
        db.close()


def test_cohort_without_a_demo_server_is_a_no_op():
    """Never blocks startup, never half-creates a classroom."""
    seed.ensure_demo_cohort()
    db = SessionLocal()
    try:
        assert db.query(models.User).count() == 0
        assert db.query(models.Attempt).count() == 0
    finally:
        db.close()


def test_cohort_gives_a_meaningful_hardest_concept():
    seed.ensure_demo_server()
    seed.ensure_demo_cohort()
    db = SessionLocal()
    try:
        server = _demo_server(db)
        out = progress.cohort(db, server)
        assert out["members_count"] == 11
        assert out["predictions_made"] == 54

        hardest = out["hardest_concept"]
        assert hardest is not None
        assert hardest["concept_id"] == "validation_split"
        assert hardest["wrong_pct"] == 80

        # It is not a coin flip against the runner-up.
        scene = next(d for d in out["distribution"] if d["scene_id"] == "g_validation")
        wrong = [o for o in scene["options"] if not o["correct"] and o["count"]]
        assert {o["misconception_id"] for o in wrong} == {"tune_on_test"}
        top = max(wrong, key=lambda o: o["count"])
        assert top["option_id"] == "op_honest" and top["count"] == 7
    finally:
        db.close()


def test_cohort_leaderboard_has_a_real_spread():
    seed.ensure_demo_server()
    seed.ensure_demo_cohort()
    db = SessionLocal()
    try:
        server = _demo_server(db)
        entries = progress.leaderboard(db, server)
        assert len(entries) == 11
        xps = [e["xp"] for e in entries]
        assert xps == sorted(xps, reverse=True)
        assert xps == [60, 52, 52, 44, 44, 36, 36, 24, 20, 12, 0]
        assert entries[0]["display_name"] == "Elif Demir"
        # The demo learner starts last, with nothing to their name.
        assert entries[-1]["xp"] == 0
        # XP reconciles with the attempt rows.
        for e in entries:
            assert e["xp"] == progress.user_xp(db, e["user_id"], server_id=server.id)
    finally:
        db.close()


def test_cohort_is_deterministic_across_runs():
    def snapshot():
        db = SessionLocal()
        try:
            server = _demo_server(db)
            return [
                (e["display_name"], e["xp"], e["attempts"])
                for e in progress.leaderboard(db, server)
            ]
        finally:
            db.close()

    seed.ensure_demo_server()
    seed.ensure_demo_cohort()
    first = snapshot()

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    seed.ensure_demo_server()
    seed.ensure_demo_cohort()
    assert snapshot() == first


# --- which classroom the cohort joins --------------------------------------


def _other_server(db, *, status="ready", with_world=True):
    """A second server with the same fixture content, owned by someone else --
    stands in for the real generated course the pitch may run on."""
    content = fixtures.load_demo()
    now = "2026-01-01T00:00:00Z"
    owner = models.User(
        id=new_id(), email="teacher@example.com", password_hash="x",
        display_name="Teacher", role="teacher", created_at=now,
    )
    db.add(owner)
    db.flush()
    server = models.Server(
        id=new_id(), name="Real course", description=None, join_code="REAL01",
        is_public=True, pet="fox", owner_id=owner.id, status=status, error=None,
        segment_count=0, created_at=now,
    )
    db.add(server)
    db.flush()
    db.add(models.Membership(
        id=new_id(), user_id=owner.id, server_id=server.id, role="owner", joined_at=now,
    ))
    if with_world:
        db.add(models.World(
            id=new_id(), server_id=server.id, idx=0, title="Real world", blurb=None,
            segment_start=0, segment_end=0, status="ready", stage="done", error=None,
            graph_id="aaaaaaaa", quest_id="bbbbbbbb", gauntlet_id="cccccccc",
            graph_json=json.dumps(content.graph), quest_json=json.dumps(content.quest),
            gauntlet_json=json.dumps(content.gauntlet), created_at=now,
        ))
    db.commit()
    return server.id


def _target(monkeypatch, server_id: str):
    monkeypatch.setattr(get_settings(), "demo_cohort_server_id", server_id)


def test_cohort_joins_the_configured_server_instead_of_the_demo_one(monkeypatch):
    seed.ensure_demo_server()
    db = SessionLocal()
    try:
        other_id = _other_server(db)
    finally:
        db.close()

    _target(monkeypatch, other_id)
    seed.ensure_demo_cohort()

    db = SessionLocal()
    try:
        assert db.query(models.Attempt).filter_by(server_id=other_id).count() == 54
        assert db.query(models.Membership).filter_by(server_id=other_id).count() == 11
        # The demo server was left alone.
        demo = _demo_server(db)
        assert db.query(models.Attempt).filter_by(server_id=demo.id).count() == 0
        assert db.query(models.Membership).filter_by(server_id=demo.id).count() == 1
    finally:
        db.close()


def test_cohort_marker_is_per_server(monkeypatch):
    """Seeding classroom A must not make classroom B a no-op."""
    seed.ensure_demo_server()
    seed.ensure_demo_cohort()
    db = SessionLocal()
    try:
        other_id = _other_server(db)
        users_after_demo = db.query(models.User).count()
    finally:
        db.close()

    _target(monkeypatch, other_id)
    seed.ensure_demo_cohort()

    db = SessionLocal()
    try:
        # The same ten people, reused, not cloned (+1 is the other owner).
        assert db.query(models.User).count() == users_after_demo
        for email in seed.COHORT_EMAILS:
            assert db.query(models.User).filter_by(email=email).count() == 1
        assert db.query(models.Attempt).filter_by(server_id=other_id).count() == 54
        server = db.query(models.Server).filter_by(id=other_id).one()
        out = progress.cohort(db, server)
        assert out["hardest_concept"]["concept_id"] == "validation_split"
        assert [e["xp"] for e in out["entries"]] == [60, 52, 52, 44, 44, 36, 36, 24, 20, 12, 0]
    finally:
        db.close()


def test_cohort_with_an_unknown_server_id_is_a_no_op(monkeypatch):
    seed.ensure_demo_server()
    _target(monkeypatch, "does-not-exist")
    seed.ensure_demo_cohort()  # must not raise
    db = SessionLocal()
    try:
        assert db.query(models.Attempt).count() == 0
        for email in seed.COHORT_EMAILS:
            assert db.query(models.User).filter_by(email=email).count() == 0
    finally:
        db.close()


def test_blank_server_id_falls_back_to_the_demo_server(monkeypatch):
    seed.ensure_demo_server()
    _target(monkeypatch, "   ")
    seed.ensure_demo_cohort()
    db = SessionLocal()
    try:
        server = _demo_server(db)
        assert db.query(models.Attempt).filter_by(server_id=server.id).count() == 54
    finally:
        db.close()


def test_cohort_skips_a_server_that_is_not_ready(monkeypatch):
    seed.ensure_demo_server()
    db = SessionLocal()
    try:
        other_id = _other_server(db, status="processing")
    finally:
        db.close()
    _target(monkeypatch, other_id)
    seed.ensure_demo_cohort()
    db = SessionLocal()
    try:
        assert db.query(models.Attempt).filter_by(server_id=other_id).count() == 0
        assert db.query(models.Membership).filter_by(server_id=other_id).count() == 1
    finally:
        db.close()


def test_cohort_skips_a_server_with_no_playable_scenes(monkeypatch):
    seed.ensure_demo_server()
    db = SessionLocal()
    try:
        other_id = _other_server(db, with_world=False)
    finally:
        db.close()
    _target(monkeypatch, other_id)
    seed.ensure_demo_cohort()
    db = SessionLocal()
    try:
        assert db.query(models.Attempt).filter_by(server_id=other_id).count() == 0
    finally:
        db.close()


def test_cohort_never_rewrites_an_existing_attempt():
    """Production already has real people with real attempts on the target
    server. A re-seed may only ever add rows."""
    seed.ensure_demo_server()
    db = SessionLocal()
    try:
        server = _demo_server(db)
        world = db.query(models.World).filter_by(server_id=server.id).one()
        real = models.User(
            id=new_id(), email="real@example.com", password_hash="x",
            display_name="Real Person", role="student", created_at="2026-01-01T00:00:00Z",
        )
        db.add(real)
        db.flush()
        db.add(models.Membership(
            id=new_id(), user_id=real.id, server_id=server.id, role="member",
            joined_at="2026-01-01T00:00:00Z",
        ))
        attempt = models.Attempt(
            id=new_id(), user_id=real.id, server_id=server.id, world_id=world.id,
            game_id=world.gauntlet_id, archetype="gauntlet", scene_id="g_validation",
            option_id="op_optimistic", correct=True, xp=10,
            created_at="2026-01-01T00:00:00Z",
        )
        db.add(attempt)
        db.commit()
        before = (attempt.id, attempt.option_id, attempt.correct, attempt.xp, attempt.created_at)
    finally:
        db.close()

    seed.ensure_demo_cohort()
    seed.ensure_demo_cohort()

    db = SessionLocal()
    try:
        rows = db.query(models.Attempt).filter_by(id=before[0]).all()
        assert len(rows) == 1
        a = rows[0]
        assert (a.id, a.option_id, a.correct, a.xp, a.created_at) == before
        server = _demo_server(db)
        out = progress.cohort(db, server)
        assert out["members_count"] == 12
        assert out["predictions_made"] == 55
        assert out["hardest_concept"]["concept_id"] == "validation_split"
    finally:
        db.close()
