"""Demo server seed (Plan B for the pitch): a ready-to-play server so the demo
never depends on a live LLM call. Idempotent, and never allowed to block
startup -- any problem here is logged, not raised.
"""
import json
import logging

from app import models
from app.db import session_scope
from app.ids import new_id, utc_now_iso
from app.security import hash_password
from app.services import fixtures, validators

log = logging.getLogger("classquest.seed")

DEMO_EMAIL = "demo@classquest.app"
DEMO_PASSWORD = "demo1234"
DEMO_JOIN_CODE = "DEMO01"
DEMO_GRAPH_ID = "wk3ml0a1"
DEMO_QUEST_ID = "q7kp2wm4"
DEMO_GAUNTLET_ID = "g3xn8vr1"


def ensure_demo_server() -> None:
    try:
        _ensure_demo_server()
    except Exception:
        log.exception("seed: failed to create demo server")


def _ensure_demo_server() -> None:
    with session_scope() as db:
        existing = db.query(models.User.id).filter_by(email=DEMO_EMAIL).first()
        if existing is not None:
            log.info("seed: demo user already exists, skipping")
            return

        content = fixtures.load_demo()

        graph_errors = validators.validate_graph(content.graph, content.segments)
        if graph_errors:
            log.error("seed: demo graph failed validation: %s", graph_errors)
        quest_errors = validators.validate_game(content.quest, content.graph)
        if quest_errors:
            log.error("seed: demo quest failed validation: %s", quest_errors)
        gauntlet_errors = validators.validate_game(content.gauntlet, content.graph)
        if gauntlet_errors:
            log.error("seed: demo gauntlet failed validation: %s", gauntlet_errors)

        now = utc_now_iso()
        user = models.User(
            id=new_id(), email=DEMO_EMAIL, password_hash=hash_password(DEMO_PASSWORD),
            display_name="Demo Learner", role="student", created_at=now,
        )
        db.add(user)
        db.flush()

        server = models.Server(
            id=new_id(), name="Demo: Intro to ML — Week 3", description=None,
            join_code=DEMO_JOIN_CODE, is_public=True, pet="owl", owner_id=user.id,
            status="ready", error=None, segment_count=len(content.segments), created_at=now,
        )
        db.add(server)
        db.flush()

        db.add(models.Membership(
            id=new_id(), user_id=user.id, server_id=server.id, role="owner", joined_at=now,
        ))

        document = models.Document(
            id=new_id(), server_id=server.id, filename="demo_lecture.txt",
            content_type="text/plain", char_count=sum(len(s) for s in content.segments),
            stored_path=None, created_at=now,
        )
        db.add(document)
        db.flush()

        for seq, text in enumerate(content.segments):
            db.add(models.Segment(
                id=new_id(), server_id=server.id, document_id=document.id, seq=seq, text=text,
            ))

        world = models.World(
            id=new_id(), server_id=server.id, idx=0, title=content.quest.get("title", "Week 3"),
            blurb="Training data, generalisation and overfitting.",
            segment_start=0, segment_end=len(content.segments) - 1, status="ready",
            stage="done", error=None,
            graph_id=DEMO_GRAPH_ID, quest_id=DEMO_QUEST_ID, gauntlet_id=DEMO_GAUNTLET_ID,
            graph_json=json.dumps(content.graph), quest_json=json.dumps(content.quest),
            gauntlet_json=json.dumps(content.gauntlet), created_at=now,
        )
        db.add(world)
        db.flush()

        db.add(models.GenerationEvent(
            id=new_id(), server_id=server.id, world_id=world.id, stage="done", level="info",
            message="Demo world seeded", created_at=now,
        ))

        log.info("seed: created demo user/server/world")
