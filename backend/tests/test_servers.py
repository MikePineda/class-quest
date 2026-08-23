"""POST/GET/DELETE /servers*, join, leaderboard, cohort."""
import io
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile

from app import models
from app.db import SessionLocal
from app.ids import new_id, utc_now_iso
from app.routers import servers as server_routes
from app.security import hash_password
from app.services import generate

from .helpers import make_ready_world


def _content(min_chars=450):
    text = "The training set teaches the model. " * 20
    while len(text) < min_chars:
        text += "More words about generalisation and validation follow here. "
    return text


def _register(client, email="owner@example.com", name="Owner"):
    r = client.post("/auth/register", json={
        "email": email, "password": "thistle marmalade rowboat", "display_name": name,
    })
    assert r.status_code == 201, r.text
    return r.json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _create_server(client, token, *, text=None, files=None, name="Course", pet="owl",
                    is_public="true"):
    data = {"name": name, "pet": pet, "is_public": is_public}
    if text is not None:
        data["text"] = text
    kwargs = {"data": data, "headers": _auth(token)}
    if files is not None:
        kwargs["files"] = files
    return client.post("/servers", **kwargs)


# ------------------------------------------------------------------- create


def test_create_server_with_pasted_text(client, monkeypatch):
    called = {}
    monkeypatch.setattr(generate, "start_pipeline", lambda server_id: called.setdefault("id", server_id) or True)

    token = _register(client)
    r = _create_server(client, token, text=_content())
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "processing"
    assert body["my_role"] == "owner"
    assert body["member_count"] == 1
    assert len(body["join_code"]) == 6
    assert called["id"] == body["id"]

    db = SessionLocal()
    try:
        server_id = body["id"]
        segments = (
            db.query(models.Segment).filter_by(server_id=server_id).order_by(models.Segment.seq).all()
        )
        assert [s.seq for s in segments] == list(range(len(segments)))
        assert len(segments) >= 1
        memberships = db.query(models.Membership).filter_by(server_id=server_id).all()
        assert len(memberships) == 1
        assert memberships[0].role == "owner"
    finally:
        db.close()


def test_create_server_with_file_and_text_two_documents_seq_continues(client, monkeypatch):
    monkeypatch.setattr(generate, "start_pipeline", lambda server_id: True)
    token = _register(client)
    file_bytes = _content(500).encode()
    files = [("files", ("notes.txt", io.BytesIO(file_bytes), "text/plain"))]
    r = _create_server(client, token, text=_content(500), files=files)
    assert r.status_code == 201, r.text
    server_id = r.json()["id"]

    db = SessionLocal()
    try:
        docs = db.query(models.Document).filter_by(server_id=server_id).order_by(models.Document.created_at).all()
        assert len(docs) == 2
        assert docs[0].filename == "notes.txt"
        assert docs[0].stored_path is not None
        assert docs[1].filename == "pasted.txt"
        assert docs[1].stored_path is None

        segments = db.query(models.Segment).filter_by(server_id=server_id).order_by(models.Segment.seq).all()
        assert [s.seq for s in segments] == list(range(len(segments)))
        doc_ids_in_seq_order = [s.document_id for s in segments]
        # every segment of doc0 precedes every segment of doc1
        first_doc1_idx = doc_ids_in_seq_order.index(docs[1].id)
        assert all(d == docs[0].id for d in doc_ids_in_seq_order[:first_doc1_idx])
    finally:
        db.close()


@pytest.mark.parametrize("client_filename", ["../outside.txt", "/tmp/outside.txt"])
def test_create_server_never_uses_client_filename_as_storage_path(
    client, monkeypatch, settings, client_filename,
):
    """Multipart filenames are metadata, never filesystem paths."""
    monkeypatch.setattr(generate, "start_pipeline", lambda server_id: True)
    token = _register(client)
    file_bytes = _content(500).encode()
    files = [("files", (client_filename, io.BytesIO(file_bytes), "text/plain"))]

    r = _create_server(client, token, files=files)
    assert r.status_code == 201, r.text
    server_id = r.json()["id"]

    db = SessionLocal()
    try:
        doc = db.query(models.Document).filter_by(server_id=server_id).one()
        stored_path = Path(doc.stored_path).resolve()
        server_dir = (settings.uploads_dir / server_id).resolve()

        assert doc.filename == client_filename  # original name remains display metadata
        assert stored_path.parent == server_dir
        assert stored_path.name != "outside.txt"
        assert stored_path.read_bytes() == file_bytes
        assert not (settings.uploads_dir / "outside.txt").exists()
    finally:
        db.close()


def test_upload_reader_stops_one_byte_after_configured_limit():
    class ReadSpy(io.BytesIO):
        requested_size = None

        def read(self, size=-1):
            self.requested_size = size
            return super().read(size)

    stream = ReadSpy(b"123456789")
    upload = UploadFile(filename="notes.txt", file=stream)

    with pytest.raises(HTTPException) as exc:
        server_routes._read_upload(upload, max_bytes=5)

    assert exc.value.status_code == 413
    assert stream.requested_size == 6


def test_upload_reader_accepts_content_at_configured_limit():
    upload = UploadFile(filename="notes.txt", file=io.BytesIO(b"12345"))
    assert server_routes._read_upload(upload, max_bytes=5) == b"12345"


def test_create_server_too_short_content_is_422(client, monkeypatch):
    monkeypatch.setattr(generate, "start_pipeline", lambda server_id: True)
    token = _register(client)
    r = _create_server(client, token, text="too short")
    assert r.status_code == 422


def test_create_server_too_many_files_is_413(client, monkeypatch, settings):
    monkeypatch.setattr(generate, "start_pipeline", lambda server_id: True)
    token = _register(client)
    files = [
        ("files", (f"f{i}.txt", io.BytesIO(b"hello world"), "text/plain"))
        for i in range(settings.max_files + 1)
    ]
    r = _create_server(client, token, files=files)
    assert r.status_code == 413


def test_create_server_unsupported_extension_is_422(client, monkeypatch):
    monkeypatch.setattr(generate, "start_pipeline", lambda server_id: True)
    token = _register(client)
    files = [("files", ("slides.zip", io.BytesIO(_content().encode()), "application/zip"))]
    r = _create_server(client, token, files=files)
    assert r.status_code == 422


# --------------------------------------------------------------------- list


def test_list_my_servers(client, monkeypatch):
    monkeypatch.setattr(generate, "start_pipeline", lambda server_id: True)
    token = _register(client)
    id_a = _create_server(client, token, text=_content(), name="A").json()["id"]
    id_b = _create_server(client, token, text=_content(), name="B").json()["id"]

    # created_at has only second resolution: force a deterministic order
    # instead of racing the wall clock.
    db = SessionLocal()
    try:
        db.get(models.Server, id_a).created_at = "2020-01-01T00:00:00Z"
        db.get(models.Server, id_b).created_at = "2020-01-02T00:00:00Z"
        db.commit()
    finally:
        db.close()

    r = client.get("/servers", headers=_auth(token))
    assert r.status_code == 200
    names = [s["name"] for s in r.json()["servers"]]
    assert names == ["B", "A"]  # newest first


def test_public_listing_hides_join_code_and_excludes_non_ready_private(client, monkeypatch):
    monkeypatch.setattr(generate, "start_pipeline", lambda server_id: True)
    token = _register(client)
    r = _create_server(client, token, text=_content(), is_public="true")
    server_id = r.json()["id"]

    # still "processing": not yet visible on the public listing
    pub = client.get("/servers/public").json()["servers"]
    assert all(s["id"] != server_id for s in pub)

    db = SessionLocal()
    try:
        server = db.get(models.Server, server_id)
        server.status = "ready"
        db.commit()
    finally:
        db.close()

    pub = client.get("/servers/public").json()["servers"]
    mine = next(s for s in pub if s["id"] == server_id)
    assert "join_code" not in mine or mine["join_code"] is None

    token2 = _register(client, email="other@example.com", name="Other")
    r2 = _create_server(client, token2, text=_content(), is_public="false")
    private_id = r2.json()["id"]
    db = SessionLocal()
    try:
        server = db.get(models.Server, private_id)
        server.status = "ready"
        db.commit()
    finally:
        db.close()
    pub = client.get("/servers/public").json()["servers"]
    assert all(s["id"] != private_id for s in pub)


# --------------------------------------------------------------------- join


def test_join_ok_already_member_404_and_lowercase(client, monkeypatch):
    monkeypatch.setattr(generate, "start_pipeline", lambda server_id: True)
    owner_token = _register(client)
    r = _create_server(client, owner_token, text=_content())
    join_code = r.json()["join_code"]

    student_token = _register(client, email="student@example.com", name="Student")
    r1 = client.post("/servers/join", json={"join_code": join_code.lower()}, headers=_auth(student_token))
    assert r1.status_code == 200, r1.text
    assert r1.json()["already_member"] is False
    assert r1.json()["server"]["join_code"] == join_code

    r2 = client.post("/servers/join", json={"join_code": join_code}, headers=_auth(student_token))
    assert r2.status_code == 200
    assert r2.json()["already_member"] is True

    r3 = client.post("/servers/join", json={"join_code": "ZZZZZZ"}, headers=_auth(student_token))
    assert r3.status_code == 404
    assert r3.json() == {"detail": "No server with that code"}


# ------------------------------------------------------------------ detail


def test_get_server_member_vs_public_non_member_vs_private_forbidden(client, monkeypatch):
    monkeypatch.setattr(generate, "start_pipeline", lambda server_id: True)
    owner_token = _register(client)
    r_public = _create_server(client, owner_token, text=_content(), is_public="true", name="Pub")
    public_id = r_public.json()["id"]
    r_private = _create_server(client, owner_token, text=_content(), is_public="false", name="Priv")
    private_id = r_private.json()["id"]

    outsider_token = _register(client, email="out@example.com", name="Out")

    r_member = client.get(f"/servers/{public_id}", headers=_auth(owner_token))
    assert r_member.status_code == 200
    assert r_member.json()["join_code"] is not None

    r_nonmember_public = client.get(f"/servers/{public_id}", headers=_auth(outsider_token))
    assert r_nonmember_public.status_code == 200
    assert r_nonmember_public.json()["join_code"] is None

    r_nonmember_private = client.get(f"/servers/{private_id}", headers=_auth(outsider_token))
    assert r_nonmember_private.status_code == 403


# ----------------------------------------------------------------- progress


def _bare_server(db, owner_id, status, name="P"):
    now = utc_now_iso()
    server = models.Server(
        id=new_id(), name=name, join_code=new_id()[:6].upper(), is_public=False,
        pet="owl", owner_id=owner_id, status=status, segment_count=0, created_at=now,
    )
    db.add(server)
    db.flush()
    db.add(models.Membership(id=new_id(), user_id=owner_id, server_id=server.id, role="owner", joined_at=now))
    return server


def _bare_world(db, server, status, stage=None, graph=False, quest=False, gauntlet=False, idx=0):
    now = utc_now_iso()
    w = models.World(
        id=new_id(), server_id=server.id, idx=idx, title="W", segment_start=0, segment_end=0,
        status=status, stage=stage,
        graph_json="{}" if graph else None, quest_json="{}" if quest else None,
        gauntlet_json="{}" if gauntlet else None, created_at=now,
    )
    db.add(w)
    return w


def test_progress_percent_pending_partial_ready(client):
    db = SessionLocal()
    try:
        owner = models.User(id=new_id(), email="p@example.com", password_hash=hash_password("x"),
                            display_name="P", created_at=utc_now_iso())
        db.add(owner)
        db.flush()

        pending = _bare_server(db, owner.id, "pending", "Pending")
        db.commit()

        processing = _bare_server(db, owner.id, "processing", "Processing")
        _bare_world(db, processing, "processing", stage="quest", graph=True, quest=True, idx=0)
        _bare_world(db, processing, "pending", idx=1)
        db.commit()

        ready = _bare_server(db, owner.id, "ready", "Ready")
        _bare_world(db, ready, "ready", stage="done", graph=True, quest=True, gauntlet=True, idx=0)
        db.commit()

        from app.security import create_token
        token = create_token(owner.id)
    finally:
        db.close()

    r = client.get(f"/servers/{pending.id}", headers=_auth(token))
    assert r.json()["progress"]["percent"] == 0

    r = client.get(f"/servers/{processing.id}", headers=_auth(token))
    prog = r.json()["progress"]
    # completed = 1 (planning) + 2 artifacts = 3; denom = 2*3+1 = 7 -> 43
    assert prog["percent"] == 43
    assert prog["stage"] == "quest"
    assert prog["worlds_total"] == 2

    r = client.get(f"/servers/{ready.id}", headers=_auth(token))
    assert r.json()["progress"]["percent"] == 100


# --------------------------------------------------------------- leaderboard


def test_leaderboard_ranks_including_zero_xp_member(client):
    db = SessionLocal()
    try:
        owner = models.User(id=new_id(), email="lb-owner@example.com", password_hash=hash_password("x"),
                            display_name="Owner", created_at=utc_now_iso())
        zero = models.User(id=new_id(), email="lb-zero@example.com", password_hash=hash_password("x"),
                           display_name="Zero", created_at=utc_now_iso())
        db.add_all([owner, zero])
        db.flush()

        server = _bare_server(db, owner.id, "ready", "LB")
        db.add(models.Membership(id=new_id(), user_id=zero.id, server_id=server.id, role="member",
                                 joined_at=utc_now_iso()))
        world = _bare_world(db, server, "ready", stage="done")
        db.flush()

        db.add(models.Attempt(
            id=new_id(), user_id=owner.id, server_id=server.id, world_id=world.id,
            game_id="q1", archetype="quest", scene_id="sc1", option_id="op1",
            correct=True, xp=10, created_at=utc_now_iso(),
        ))
        db.commit()

        from app.security import create_token
        token = create_token(owner.id)
        server_id = server.id
        owner_id, zero_id = owner.id, zero.id
    finally:
        db.close()

    r = client.get(f"/servers/{server_id}/leaderboard", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    ranks = {e["user_id"]: e for e in body["entries"]}
    assert ranks[owner_id]["rank"] == 1
    assert ranks[owner_id]["xp"] == 10
    assert ranks[zero_id]["xp"] == 0
    assert body["me"]["user_id"] == owner_id


# ------------------------------------------------------------------- cohort


def test_cohort_distribution_counts_and_pct(client):
    db = SessionLocal()
    try:
        owner = models.User(id=new_id(), email="co-owner@example.com", password_hash=hash_password("x"),
                            display_name="Owner", created_at=utc_now_iso())
        db.add(owner)
        db.flush()
        server = _bare_server(db, owner.id, "ready", "Cohort")
        db.commit()
        server_id = server.id
        from app.security import create_token
        owner_token = create_token(owner.id)

        world = make_ready_world(db, db.get(models.Server, server_id))
        db.commit()
        world_id = world.id
    finally:
        db.close()

    db = SessionLocal()
    try:
        code = db.get(models.Server, server_id).join_code
    finally:
        db.close()

    student_tokens = []
    for i in range(3):
        t = _register(client, email=f"cohort{i}@example.com", name=f"S{i}")
        student_tokens.append(t)
        r = client.post("/servers/join", json={"join_code": code}, headers=_auth(t))
        assert r.status_code == 200, r.text

    choices = ["op_same", "op_worse", "op_same"]
    for t, opt in zip(student_tokens, choices):
        r = client.post(
            f"/worlds/{world_id}/attempts",
            json={"archetype": "quest", "scene_id": "sc_pred_overfit", "option_id": opt},
            headers=_auth(t),
        )
        assert r.status_code == 200, r.text

    r = client.get(f"/servers/{server_id}/cohort", headers=_auth(owner_token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["predictions_made"] == 3
    entry = next(d for d in body["distribution"] if d["scene_id"] == "sc_pred_overfit")
    by_id = {o["option_id"]: o for o in entry["options"]}
    assert by_id["op_same"]["count"] == 2
    assert by_id["op_same"]["pct"] == 67
    assert by_id["op_worse"]["count"] == 1
    assert by_id["op_worse"]["pct"] == 33
    assert body["hardest_concept"]["concept_id"] == "overfitting"


# ------------------------------------------------------------------- delete


def test_delete_server_owner_then_404_member_403(client, monkeypatch):
    monkeypatch.setattr(generate, "start_pipeline", lambda server_id: True)
    owner_token = _register(client)
    r = _create_server(client, owner_token, text=_content())
    server_id = r.json()["id"]
    join_code = r.json()["join_code"]

    member_token = _register(client, email="member@example.com", name="Member")
    client.post("/servers/join", json={"join_code": join_code}, headers=_auth(member_token))

    r_forbidden = client.delete(f"/servers/{server_id}", headers=_auth(member_token))
    assert r_forbidden.status_code == 403

    r_del = client.delete(f"/servers/{server_id}", headers=_auth(owner_token))
    assert r_del.status_code == 204

    r_gone = client.get(f"/servers/{server_id}", headers=_auth(owner_token))
    assert r_gone.status_code == 404
