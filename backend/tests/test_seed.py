"""The demo server seed: idempotent, never blocks startup, and produces a
server that plays end to end through the API."""
import json

from app import models
from app.db import SessionLocal
from app.services import seed, validators


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
        "email": "student@example.com", "password": "password123", "display_name": "Student",
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
