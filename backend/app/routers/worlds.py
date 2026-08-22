"""Worlds: read one world's content/progress, record prediction attempts,
grade Explain-to-Win submissions."""
import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db
from app.deps import current_user, world_and_membership
from app.ids import new_id, utc_now_iso
from app.services import explain, progress, scoring

router = APIRouter(prefix="/worlds", tags=["worlds"])


# ------------------------------------------------------------------ helpers


def _load(json_text: str | None) -> dict | None:
    return json.loads(json_text) if json_text else None


def _find_scene(game: dict | None, scene_id: str) -> dict | None:
    if not game:
        return None
    for ch in game.get("chapters", []):
        for sc in ch.get("scenes", []):
            if sc.get("id") == scene_id:
                return sc
    return None


def _find_misconception(graph: dict | None, misconception_id: str | None) -> dict | None:
    if not graph or not misconception_id:
        return None
    for concept in graph.get("concepts", []):
        for m in concept.get("misconceptions", []):
            if m.get("id") == misconception_id:
                return {"id": m["id"], "statement": m["statement"], "correction": m["correction"]}
    return None


def _find_concept(graph: dict | None, concept_id: str) -> dict | None:
    if not graph:
        return None
    return next((c for c in graph.get("concepts", []) if c.get("id") == concept_id), None)


# ------------------------------------------------------------------- routes


@router.get("/{world_id}", response_model=schemas.WorldDetail)
def get_world(
    wsm: tuple = Depends(world_and_membership),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    world, _server, _membership = wsm
    graph = _load(world.graph_json)
    quest = _load(world.quest_json)
    gauntlet = _load(world.gauntlet_json)
    concept_count = len(graph.get("concepts", [])) if graph else 0
    scene_count = len(progress.prediction_scenes(quest)) + len(progress.prediction_scenes(gauntlet))
    prog = progress.world_progress(db, user.id, world)
    my_completion = (prog["scenes_attempted"] / scene_count) if scene_count else 0.0

    return schemas.WorldDetail(
        id=world.id, idx=world.idx, title=world.title, blurb=world.blurb,
        status=world.status, stage=world.stage, error=world.error,
        graph_id=world.graph_id, quest_id=world.quest_id, gauntlet_id=world.gauntlet_id,
        concept_count=concept_count, scene_count=scene_count,
        my_xp=prog["xp"], my_completion=my_completion,
        server_id=world.server_id, segment_start=world.segment_start, segment_end=world.segment_end,
        graph=graph, games=schemas.GamesOut(quest=quest, gauntlet=gauntlet),
        my_progress=schemas.MyProgress(**prog),
    )


@router.post("/{world_id}/attempts", response_model=schemas.AttemptOut)
def create_attempt(
    body: schemas.AttemptIn,
    wsm: tuple = Depends(world_and_membership),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    world, server, _membership = wsm
    if world.status != "ready":
        raise HTTPException(status.HTTP_409_CONFLICT, "World is not ready")

    if body.archetype == "quest":
        game, game_id = _load(world.quest_json), world.quest_id
    else:
        game, game_id = _load(world.gauntlet_json), world.gauntlet_id

    scene = _find_scene(game, body.scene_id)
    if scene is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown scene")
    if scene.get("type") != "prediction":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Scene is not a prediction")
    option = next((o for o in scene.get("options", []) if o.get("id") == body.option_id), None)
    if option is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown option")

    correct = bool(option["correct"])
    first_time = (
        db.query(models.Attempt.id)
        .filter_by(world_id=world.id, user_id=user.id, scene_id=body.scene_id)
        .first()
        is None
    )
    xp = scoring.xp_for_prediction(correct=correct, first_time=first_time)

    attempt = models.Attempt(
        id=new_id(), user_id=user.id, server_id=server.id, world_id=world.id,
        game_id=game_id, archetype=body.archetype, scene_id=body.scene_id,
        option_id=body.option_id, correct=correct, xp=xp, created_at=utc_now_iso(),
    )
    db.add(attempt)
    db.commit()

    misconception = None
    if not correct:
        graph = _load(world.graph_json)
        misconception = _find_misconception(graph, option.get("misconception_id"))

    return schemas.AttemptOut(
        attempt_id=attempt.id, correct=correct, xp_awarded=xp, first_time=first_time,
        misconception=misconception, reveal=scene["reveal"],
        world_xp=progress.user_xp(db, user.id, world_id=world.id),
        server_xp=progress.user_xp(db, user.id, server_id=server.id),
    )


@router.get("/{world_id}/progress", response_model=schemas.ProgressOut)
def get_progress(
    wsm: tuple = Depends(world_and_membership),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    world, _server, _membership = wsm
    attempts = (
        db.query(models.Attempt)
        .filter_by(world_id=world.id, user_id=user.id)
        .filter(models.Attempt.archetype.in_(["quest", "gauntlet"]))
        .order_by(models.Attempt.created_at)
        .all()
    )
    by_scene: dict[str, list[models.Attempt]] = {}
    for a in attempts:
        by_scene.setdefault(a.scene_id, []).append(a)

    scenes = [
        schemas.SceneProgress(
            scene_id=scene_id, archetype=lst[0].archetype, attempts=len(lst),
            best_correct=any(a.correct for a in lst), chosen_option_id=lst[0].option_id,
        )
        for scene_id, lst in by_scene.items()
    ]

    explanation_rows = (
        db.query(models.Explanation)
        .filter_by(world_id=world.id, user_id=user.id)
        .order_by(models.Explanation.created_at)
        .all()
    )
    explanations = [
        schemas.ExplanationProgress(
            concept_id=e.concept_id, score=e.score, verdict=e.verdict, created_at=e.created_at,
        )
        for e in explanation_rows
    ]

    return schemas.ProgressOut(
        world_id=world.id, xp=progress.user_xp(db, user.id, world_id=world.id),
        scenes=scenes, explanations=explanations,
    )


@router.post("/{world_id}/explain", response_model=schemas.ExplainOut)
def explain_concept(
    body: schemas.ExplainIn,
    wsm: tuple = Depends(world_and_membership),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    world, server, _membership = wsm
    if world.status != "ready":
        raise HTTPException(status.HTTP_409_CONFLICT, "World is not ready")

    graph = _load(world.graph_json)
    concept = _find_concept(graph, body.concept_id)
    if concept is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown concept")

    try:
        result = explain.grade_explanation(concept, body.text)
    except explain.GraderUnavailable as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Grader unavailable, try again") from e

    score = scoring.clamp_score(result["score"])
    verdict = result["verdict"]
    feedback = result["feedback"]
    misconception_id = result.get("misconception_id")

    first_time = (
        db.query(models.Explanation.id)
        .filter_by(world_id=world.id, user_id=user.id, concept_id=body.concept_id)
        .filter(models.Explanation.verdict.in_(["pass", "partial"]))
        .first()
        is None
    )
    xp = scoring.xp_for_explain(verdict, first_time=first_time)
    now = utc_now_iso()

    db.add(models.Explanation(
        id=new_id(), user_id=user.id, world_id=world.id, concept_id=body.concept_id,
        text=body.text, score=score, verdict=verdict, feedback=feedback,
        misconception_id=misconception_id, created_at=now,
    ))
    db.add(models.Attempt(
        id=new_id(), user_id=user.id, server_id=server.id, world_id=world.id,
        game_id=world.graph_id, archetype="explain", scene_id=f"explain:{body.concept_id}",
        option_id=None, correct=(verdict == "pass"), xp=xp, created_at=now,
    ))
    db.commit()

    return schemas.ExplainOut(
        score=score, verdict=verdict, xp_awarded=xp, feedback=feedback,
        misconception_id=misconception_id,
        concept=schemas.ConceptOut(id=concept["id"], label=concept["label"], summary=concept["summary"]),
        world_xp=progress.user_xp(db, user.id, world_id=world.id),
        server_xp=progress.user_xp(db, user.id, server_id=server.id),
    )
