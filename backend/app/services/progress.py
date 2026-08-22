"""XP totals and the leaderboard/cohort/world-progress queries.

Attempts are the only source of XP (`models.Attempt.xp`), including the
`archetype="explain"` rows the worlds router writes alongside an
Explanation, so `user_xp` alone is enough to answer "how much XP does this
learner have" everywhere in the API.
"""
import json
from collections import Counter

from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models


def user_xp(db: Session, user_id: str, *, server_id: str | None = None,
            world_id: str | None = None) -> int:
    """Sum of Attempt.xp for a user, optionally scoped to a server or a world."""
    q = db.query(func.coalesce(func.sum(models.Attempt.xp), 0)).filter(
        models.Attempt.user_id == user_id
    )
    if server_id is not None:
        q = q.filter(models.Attempt.server_id == server_id)
    if world_id is not None:
        q = q.filter(models.Attempt.world_id == world_id)
    return int(q.scalar() or 0)


def _load(json_text: str | None) -> dict | None:
    return json.loads(json_text) if json_text else None


def prediction_scenes(game: dict | None) -> list[dict]:
    """Every `type: "prediction"` scene across a game's chapters, in order."""
    if not game:
        return []
    out: list[dict] = []
    for ch in game.get("chapters", []):
        for sc in ch.get("scenes", []):
            if sc.get("type") == "prediction":
                out.append(sc)
    return out


def leaderboard(db: Session, server: models.Server) -> list[dict]:
    """Every member (including zero-XP ones), ranked by xp desc then by
    earliest last-attempt (members who never attempted anything sort last
    among ties)."""
    members = db.query(models.Membership).filter_by(server_id=server.id).all()
    rows = []
    for m in members:
        xp, attempts, last = (
            db.query(
                func.coalesce(func.sum(models.Attempt.xp), 0),
                func.count(models.Attempt.id),
                func.max(models.Attempt.created_at),
            )
            .filter(models.Attempt.user_id == m.user_id, models.Attempt.server_id == server.id)
            .one()
        )
        user = db.get(models.User, m.user_id)
        rows.append({
            "user_id": m.user_id,
            "display_name": user.display_name if user else "?",
            "xp": int(xp or 0),
            "attempts": int(attempts or 0),
            "_last": last or "9999-99-99T99:99:99Z",  # no attempts sorts last among ties
        })
    rows.sort(key=lambda r: (-r["xp"], r["_last"]))
    entries = []
    for i, r in enumerate(rows, start=1):
        entries.append({
            "rank": i, "user_id": r["user_id"], "display_name": r["display_name"],
            "xp": r["xp"], "attempts": r["attempts"],
        })
    return entries


def _first_attempts(db: Session, world_id: str, scene_id: str) -> list[models.Attempt]:
    """One attempt per user for (world, scene): their earliest by created_at."""
    rows = (
        db.query(models.Attempt)
        .filter_by(world_id=world_id, scene_id=scene_id)
        .order_by(models.Attempt.created_at)
        .all()
    )
    seen: set[str] = set()
    first: list[models.Attempt] = []
    for a in rows:
        if a.user_id in seen:
            continue
        seen.add(a.user_id)
        first.append(a)
    return first


def cohort(db: Session, server: models.Server) -> dict:
    """Leaderboard plus the prediction-option distribution and hardest concept,
    computed over every ready world of the server. Counts are first-attempts
    only (one per user per scene)."""
    entries = leaderboard(db, server)
    members_count = db.query(models.Membership).filter_by(server_id=server.id).count()

    worlds = db.query(models.World).filter_by(server_id=server.id, status="ready").all()
    distribution: list[dict] = []
    predictions_made = 0
    # concept_id -> {"label", "correct", "total"}
    concept_stats: dict[str, dict] = {}

    for w in worlds:
        graph = _load(w.graph_json) or {}
        concepts = {c["id"]: c for c in graph.get("concepts", [])}
        scenes: dict[str, dict] = {}
        for game in (_load(w.quest_json), _load(w.gauntlet_json)):
            for sc in prediction_scenes(game):
                scenes[sc["id"]] = sc

        for scene_id, sc in scenes.items():
            first = _first_attempts(db, w.id, scene_id)
            if not first:
                continue
            total = len(first)
            predictions_made += total
            counts = Counter(a.option_id for a in first)
            options_out = []
            for op in sc.get("options", []):
                c = counts.get(op["id"], 0)
                entry = {
                    "option_id": op["id"], "text": op["text"], "correct": op["correct"],
                    "count": c, "pct": round(100 * c / total) if total else 0,
                }
                if op.get("misconception_id"):
                    entry["misconception_id"] = op["misconception_id"]
                options_out.append(entry)
            distribution.append({
                "world_id": w.id, "scene_id": scene_id,
                "concept_id": sc.get("concept_id"), "options": options_out,
            })

            concept_id = sc.get("concept_id")
            concept = concepts.get(concept_id)
            label = concept["label"] if concept else concept_id
            stat = concept_stats.setdefault(concept_id, {"label": label, "correct": 0, "total": 0})
            stat["correct"] += sum(1 for a in first if a.correct)
            stat["total"] += total

    hardest_concept = None
    if concept_stats:
        worst_id, worst = min(
            concept_stats.items(), key=lambda kv: kv[1]["correct"] / kv[1]["total"]
        )
        hardest_concept = {
            "concept_id": worst_id, "label": worst["label"],
            "wrong_pct": round(100 * (1 - worst["correct"] / worst["total"])),
        }

    return {
        "entries": entries, "members_count": members_count,
        "predictions_made": predictions_made, "distribution": distribution,
        "hardest_concept": hardest_concept,
    }


def world_progress(db: Session, user_id: str, world: models.World) -> dict:
    """This user's XP/scene/explanation progress on one world. Only quest and
    gauntlet attempts count as "scenes"; the explain archetype has its own
    `explained_concept_ids` list."""
    quest = _load(world.quest_json)
    gauntlet = _load(world.gauntlet_json)
    scenes_total = len(prediction_scenes(quest)) + len(prediction_scenes(gauntlet))

    attempts = (
        db.query(models.Attempt)
        .filter_by(world_id=world.id, user_id=user_id)
        .filter(models.Attempt.archetype.in_(["quest", "gauntlet"]))
        .all()
    )
    by_scene: dict[str, list[models.Attempt]] = {}
    for a in attempts:
        by_scene.setdefault(a.scene_id, []).append(a)
    scenes_attempted = len(by_scene)
    scenes_correct = sum(1 for lst in by_scene.values() if any(a.correct for a in lst))

    explained = (
        db.query(models.Explanation.concept_id)
        .filter_by(world_id=world.id, user_id=user_id)
        .filter(models.Explanation.verdict.in_(["pass", "partial"]))
        .distinct()
        .all()
    )
    explained_concept_ids = [row[0] for row in explained]

    return {
        "xp": user_xp(db, user_id, world_id=world.id),
        "scenes_total": scenes_total,
        "scenes_attempted": scenes_attempted,
        "scenes_correct": scenes_correct,
        "explained_concept_ids": explained_concept_ids,
    }
