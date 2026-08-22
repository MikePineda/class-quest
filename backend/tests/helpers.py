"""Shared test helpers for building a ready world without running the pipeline."""
import json

from app import models
from app.ids import new_id, utc_now_iso
from app.services import fixtures

GRAPH_ID = "wk3ml0a1"
QUEST_ID = "q7kp2wm4"
GAUNTLET_ID = "g3xn8vr1"


def make_ready_world(db, server: models.Server) -> models.World:
    """Insert 14 fixture segments (if the server has none) and one ready
    World with the demo fixture content verbatim. Marks the server ready.
    Flushes parents before children since models have no relationship()s."""
    content = fixtures.load_demo()
    now = utc_now_iso()

    has_segments = db.query(models.Segment.id).filter_by(server_id=server.id).first() is not None
    if not has_segments:
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
        id=new_id(), server_id=server.id, idx=0, title=content.quest.get("title", "World 1"),
        blurb="Training data, generalisation and overfitting.",
        segment_start=0, segment_end=13, status="ready", stage="done", error=None,
        graph_id=GRAPH_ID, quest_id=QUEST_ID, gauntlet_id=GAUNTLET_ID,
        graph_json=json.dumps(content.graph), quest_json=json.dumps(content.quest),
        gauntlet_json=json.dumps(content.gauntlet), created_at=now,
    )
    db.add(world)

    server.status = "ready"
    server.segment_count = 14
    db.flush()
    return world
