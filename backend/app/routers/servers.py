"""Servers: create (ingest + kick off generation), list, join, poll, delete.

`/public` and `/join` are declared before `/{server_id}` so they are not
shadowed by the path parameter route.
"""
import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app import models, schemas
from app.config import get_settings
from app.db import get_db
from app.deps import current_user, current_user_optional, require_membership
from app.ids import join_code as new_join_code
from app.ids import new_id, utc_now_iso
from app.services import generate, ingest, progress

router = APIRouter(prefix="/servers", tags=["servers"])


# ------------------------------------------------------------------ helpers


def _server_summary(
    db: Session, server: models.Server, user_id: str | None, membership: models.Membership | None
) -> schemas.ServerSummary:
    my_role = membership.role if membership else None
    my_xp = progress.user_xp(db, user_id, server_id=server.id) if user_id else 0
    member_count = db.query(models.Membership).filter_by(server_id=server.id).count()
    world_count = db.query(models.World).filter_by(server_id=server.id).count()
    return schemas.ServerSummary(
        id=server.id,
        name=server.name,
        description=server.description,
        join_code=server.join_code if my_role is not None else None,
        is_public=server.is_public,
        pet=server.pet,
        status=server.status,
        error=server.error,
        owner_id=server.owner_id,
        member_count=member_count,
        world_count=world_count,
        my_role=my_role,
        my_xp=my_xp,
        created_at=server.created_at,
    )


def _world_summary(db: Session, world: models.World, user_id: str) -> schemas.WorldSummary:
    graph = json.loads(world.graph_json) if world.graph_json else None
    quest = json.loads(world.quest_json) if world.quest_json else None
    gauntlet = json.loads(world.gauntlet_json) if world.gauntlet_json else None
    concept_count = len(graph.get("concepts", [])) if graph else 0
    scene_count = len(progress.prediction_scenes(quest)) + len(progress.prediction_scenes(gauntlet))
    prog = progress.world_progress(db, user_id, world)
    my_completion = (prog["scenes_attempted"] / scene_count) if scene_count else 0.0
    return schemas.WorldSummary(
        id=world.id,
        idx=world.idx,
        title=world.title,
        blurb=world.blurb,
        status=world.status,
        stage=world.stage,
        error=world.error,
        graph_id=world.graph_id,
        quest_id=world.quest_id,
        gauntlet_id=world.gauntlet_id,
        concept_count=concept_count,
        scene_count=scene_count,
        my_xp=prog["xp"],
        my_completion=my_completion,
    )


def _server_progress(db: Session, server: models.Server, worlds: list[models.World]) -> schemas.ServerProgressOut:
    worlds_total = len(worlds)
    worlds_ready = sum(1 for w in worlds if w.status == "ready")
    worlds_failed = sum(1 for w in worlds if w.status == "failed")
    stage = next((w.stage for w in worlds if w.status == "processing"), None)

    if server.status == "ready":
        percent = 100
    elif not worlds:
        percent = 0
    else:
        completed = 1  # planning is done once world rows exist
        for w in worlds:
            completed += sum(1 for f in (w.graph_json, w.quest_json, w.gauntlet_json) if f)
        percent = round(100 * completed / (worlds_total * 3 + 1))

    events = (
        db.query(models.GenerationEvent)
        .filter_by(server_id=server.id)
        .order_by(models.GenerationEvent.created_at.desc())
        .limit(20)
        .all()
    )
    log = [
        schemas.GenerationEventOut(
            stage=e.stage, level=e.level, message=e.message, world_id=e.world_id, at=e.created_at
        )
        for e in reversed(events)  # oldest -> newest
    ]
    return schemas.ServerProgressOut(
        worlds_total=worlds_total, worlds_ready=worlds_ready, worlds_failed=worlds_failed,
        stage=stage, percent=percent, log=log,
    )


def _unique_join_code(db: Session) -> str:
    for _ in range(50):
        code = new_join_code()
        if not db.query(models.Server.id).filter_by(join_code=code).first():
            return code
    raise RuntimeError("could not mint a unique join code")  # pragma: no cover


# ------------------------------------------------------------------- routes


@router.post("", response_model=schemas.ServerSummary, status_code=status.HTTP_201_CREATED)
def create_server(
    name: str = Form(...),
    description: str | None = Form(None),
    is_public: bool = Form(False),
    pet: str = Form(..., max_length=32),
    text: str | None = Form(None),
    files: list[UploadFile] = File(default=[]),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    s = get_settings()
    if len(files) > s.max_files:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            f"Too many files: max {s.max_files}")

    max_bytes = s.max_upload_mb * 1024 * 1024
    items: list[tuple[str, bytes]] = []
    for f in files:
        data = f.file.read()
        if len(data) > max_bytes:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                                f"{f.filename} exceeds {s.max_upload_mb} MB")
        items.append((f.filename, data))

    try:
        docs = ingest.ingest_files(
            items, text, min_total_chars=s.min_total_chars, max_total_chars=s.max_total_chars
        )
    except ingest.IngestError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e

    now = utc_now_iso()
    server = models.Server(
        id=new_id(), name=name, description=description, join_code=_unique_join_code(db),
        is_public=is_public, pet=pet, owner_id=user.id, status="processing", error=None,
        segment_count=0, created_at=now,
    )
    db.add(server)
    db.flush()  # no relationship()s: children need server.id to exist in the DB

    db.add(models.Membership(
        id=new_id(), user_id=user.id, server_id=server.id, role="owner", joined_at=now,
    ))

    n_files = len(items)
    document_rows: list[models.Document] = []
    for i, doc in enumerate(docs):
        stored_path = None
        if i < n_files:
            filename, data = items[i]
            doc_dir = s.uploads_dir / server.id
            doc_dir.mkdir(parents=True, exist_ok=True)
            path = doc_dir / filename
            path.write_bytes(data)
            stored_path = str(path)
        d = models.Document(
            id=new_id(), server_id=server.id, filename=doc.filename,
            content_type=doc.content_type, char_count=doc.char_count,
            stored_path=stored_path, created_at=now,
        )
        db.add(d)
        document_rows.append(d)
    db.flush()  # segments reference document_id

    seq = 0
    for doc, d in zip(docs, document_rows):
        for seg_text in doc.segments:
            db.add(models.Segment(
                id=new_id(), server_id=server.id, document_id=d.id, seq=seq, text=seg_text,
            ))
            seq += 1
    server.segment_count = seq
    db.commit()
    db.refresh(server)

    generate.start_pipeline(server.id)

    membership = db.query(models.Membership).filter_by(server_id=server.id, user_id=user.id).one()
    return _server_summary(db, server, user.id, membership)


@router.get("", response_model=schemas.ServersOut)
def list_my_servers(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(models.Server, models.Membership)
        .join(models.Membership, models.Membership.server_id == models.Server.id)
        .filter(models.Membership.user_id == user.id)
        .order_by(models.Server.created_at.desc())
        .all()
    )
    servers = [_server_summary(db, server, user.id, membership) for server, membership in rows]
    return schemas.ServersOut(servers=servers)


@router.get("/public", response_model=schemas.ServersOut)
def list_public_servers(
    user: models.User | None = Depends(current_user_optional), db: Session = Depends(get_db)
):
    rows = (
        db.query(models.Server)
        .filter_by(is_public=True, status="ready")
        .order_by(models.Server.created_at.desc())
        .limit(50)
        .all()
    )
    servers = [_server_summary(db, server, None, None) for server in rows]
    return schemas.ServersOut(servers=servers)


@router.post("/join", response_model=schemas.JoinOut)
def join_server(
    body: schemas.JoinIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)
):
    server = db.query(models.Server).filter_by(join_code=body.join_code).one_or_none()
    if server is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No server with that code")

    membership = (
        db.query(models.Membership).filter_by(server_id=server.id, user_id=user.id).one_or_none()
    )
    already_member = membership is not None
    if membership is None:
        membership = models.Membership(
            id=new_id(), user_id=user.id, server_id=server.id, role="member",
            joined_at=utc_now_iso(),
        )
        db.add(membership)
        db.commit()

    return schemas.JoinOut(
        server=_server_summary(db, server, user.id, membership), already_member=already_member,
    )


@router.get("/{server_id}", response_model=schemas.ServerDetail)
def get_server(
    sm: tuple = Depends(require_membership),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    server, membership = sm
    worlds = db.query(models.World).filter_by(server_id=server.id).order_by(models.World.idx).all()
    summary = _server_summary(db, server, user.id, membership)
    return schemas.ServerDetail(
        **summary.model_dump(),
        progress=_server_progress(db, server, worlds),
        worlds=[_world_summary(db, w, user.id) for w in worlds],
    )


@router.get("/{server_id}/leaderboard", response_model=schemas.LeaderboardOut)
def get_leaderboard(
    sm: tuple = Depends(require_membership),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    server, _membership = sm
    entries = progress.leaderboard(db, server)
    me = next((e for e in entries if e["user_id"] == user.id and e["attempts"] > 0), None)
    return schemas.LeaderboardOut(server_id=server.id, me=me, entries=entries)


@router.get("/{server_id}/cohort", response_model=schemas.CohortOut)
def get_cohort(
    sm: tuple = Depends(require_membership),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    server, _membership = sm
    result = progress.cohort(db, server)
    me = next((e for e in result["entries"] if e["user_id"] == user.id and e["attempts"] > 0), None)
    return schemas.CohortOut(server_id=server.id, me=me, **result)


@router.delete("/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_server(sm: tuple = Depends(require_membership), db: Session = Depends(get_db)):
    server, membership = sm
    if membership is None or membership.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner can delete this server")

    db.query(models.Attempt).filter_by(server_id=server.id).delete(synchronize_session=False)
    world_ids = [w.id for w in db.query(models.World.id).filter_by(server_id=server.id)]
    if world_ids:
        db.query(models.Explanation).filter(
            models.Explanation.world_id.in_(world_ids)
        ).delete(synchronize_session=False)
    db.query(models.GenerationEvent).filter_by(server_id=server.id).delete(synchronize_session=False)
    db.query(models.World).filter_by(server_id=server.id).delete(synchronize_session=False)
    db.query(models.Segment).filter_by(server_id=server.id).delete(synchronize_session=False)
    db.query(models.Document).filter_by(server_id=server.id).delete(synchronize_session=False)
    db.query(models.Membership).filter_by(server_id=server.id).delete(synchronize_session=False)
    db.delete(server)
    db.commit()
    return None
