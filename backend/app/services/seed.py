"""Demo server seed (Plan B for the pitch): a ready-to-play server so the demo
never depends on a live LLM call. Idempotent, and never allowed to block
startup -- any problem here is logged, not raised.
"""
import json
import logging
from dataclasses import dataclass

from app import models
from app.config import get_settings
from app.db import session_scope
from app.ids import new_id, utc_now_iso
from app.security import hash_password
from app.services import fixtures, scoring, validators

log = logging.getLogger("classquest.seed")

DEMO_EMAIL = "demo@classquest.app"
DEMO_PASSWORD = "demo1234"
DEMO_JOIN_CODE = "DEMO01"
DEMO_GRAPH_ID = "wk3ml0a1"
DEMO_QUEST_ID = "q7kp2wm4"
DEMO_GAUNTLET_ID = "g3xn8vr1"

PY_JOIN_CODE = "PY101A"
PY_GRAPH_ID = "pyb1as1c"
PY_QUEST_ID = "pyq1w4k7"
PY_GAUNTLET_ID = "pyg2m8t5"


@dataclass(frozen=True)
class ServerSpec:
    """One seeded server. `join_code` doubles as the idempotency marker: the
    demo *user* cannot serve as one for a second server, because in production
    that user already exists and the check would skip forever."""

    bundle: str
    join_code: str
    name: str
    blurb: str
    world_title: str
    graph_id: str
    quest_id: str
    gauntlet_id: str


DEMO_SPEC = ServerSpec(
    bundle="overfitting",
    join_code=DEMO_JOIN_CODE,
    name="Demo: Intro to ML — Week 3",
    blurb="Training data, generalisation and overfitting.",
    world_title="Week 3",
    graph_id=DEMO_GRAPH_ID,
    quest_id=DEMO_QUEST_ID,
    gauntlet_id=DEMO_GAUNTLET_ID,
)

PY_SPEC = ServerSpec(
    bundle="pybasics",
    join_code=PY_JOIN_CODE,
    name="Demo: Programming Fundamentals — Week 1",
    blurb="Variables, types, printing, lists and loops.",
    world_title="Week 1",
    graph_id=PY_GRAPH_ID,
    quest_id=PY_QUEST_ID,
    gauntlet_id=PY_GAUNTLET_ID,
)


def ensure_demo_server() -> None:
    """Both hand-written servers, owned by the demo account."""
    for spec in (DEMO_SPEC, PY_SPEC):
        try:
            _ensure_server(spec)
        except Exception:
            log.exception("seed: failed to create %s", spec.join_code)


def _demo_user(db, now: str) -> models.User:
    """The demo account, created on first need. In production it already
    exists, which is exactly why it cannot be a seeding marker."""
    user = db.query(models.User).filter_by(email=DEMO_EMAIL).one_or_none()
    if user is not None:
        return user
    user = models.User(
        id=new_id(), email=DEMO_EMAIL, password_hash=hash_password(DEMO_PASSWORD),
        display_name="Demo Learner", role="student", created_at=now,
    )
    db.add(user)
    db.flush()
    return user


def _ensure_server(spec: ServerSpec) -> None:
    with session_scope() as db:
        existing = db.query(models.Server.id).filter_by(join_code=spec.join_code).first()
        if existing is not None:
            log.info("seed: %s already exists, skipping", spec.join_code)
            return

        content = fixtures.load_bundle(spec.bundle)
        source = fixtures.BUNDLES[spec.bundle].source

        graph_errors = validators.validate_graph(content.graph, content.segments)
        if graph_errors:
            log.error("seed: %s graph failed validation: %s", spec.bundle, graph_errors)
        quest_errors = validators.validate_game(content.quest, content.graph)
        if quest_errors:
            log.error("seed: %s quest failed validation: %s", spec.bundle, quest_errors)
        gauntlet_errors = validators.validate_game(content.gauntlet, content.graph)
        if gauntlet_errors:
            log.error("seed: %s gauntlet failed validation: %s", spec.bundle, gauntlet_errors)

        now = utc_now_iso()
        user = _demo_user(db, now)

        server = models.Server(
            id=new_id(), name=spec.name, description=None,
            join_code=spec.join_code, is_public=True, pet="owl", owner_id=user.id,
            status="ready", error=None, segment_count=len(content.segments), created_at=now,
        )
        db.add(server)
        db.flush()

        db.add(models.Membership(
            id=new_id(), user_id=user.id, server_id=server.id, role="owner", joined_at=now,
        ))

        document = models.Document(
            id=new_id(), server_id=server.id, filename=source,
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
            id=new_id(), server_id=server.id, idx=0,
            title=content.quest.get("title", spec.world_title),
            blurb=spec.blurb,
            segment_start=0, segment_end=len(content.segments) - 1, status="ready",
            stage="done", error=None,
            graph_id=spec.graph_id, quest_id=spec.quest_id, gauntlet_id=spec.gauntlet_id,
            graph_json=json.dumps(content.graph), quest_json=json.dumps(content.quest),
            gauntlet_json=json.dumps(content.gauntlet), created_at=now,
        )
        db.add(world)
        db.flush()

        db.add(models.GenerationEvent(
            id=new_id(), server_id=server.id, world_id=world.id, stage="done", level="info",
            message="Demo world seeded", created_at=now,
        ))

        log.info("seed: created server %s with world %s", spec.join_code, world.id)


# ------------------------------------------------------------------ cohort

# The demo needs the classroom to look alive: a leaderboard with a real spread
# and a cohort heatmap that points at one concept. `_ensure_demo_server`
# returns early once the demo user exists (and in production it already does),
# so this has its own idempotency marker and its own lifespan call.
#
# Which classroom is an env var (DEMO_COHORT_SERVER_ID), because the server the
# pitch runs on may be a real generated course owned by someone else's account,
# not the seeded DEMO01 one. Empty falls back to the demo server.
#
# Nothing here is random and nothing is tied to the fixture world. The scenes
# are discovered from whatever the target server actually holds, and the wrong
# answers come from an explicit per-classmate table applied to scene positions.

COHORT_PASSWORD = "demo1234"

# (display_name, email local part)
DEMO_COHORT: tuple[tuple[str, str], ...] = (
    ("Elif Demir", "elif"),
    ("Aisha Rahman", "aisha"),
    ("Bruno Alves", "bruno"),
    ("Chen Wei", "chen"),
    ("Dara Okoye", "dara"),
    ("Farid Haddad", "farid"),
    ("Gemma Ricci", "gemma"),
    ("Hugo Martins", "hugo"),
    ("Ines Costa", "ines"),
    ("Jonas Berg", "jonas"),
)

COHORT_EMAILS = tuple(f"{local}@classquest.app" for _, local in DEMO_COHORT)

# One scene is singled out as the class's blind spot so `hardest_concept` is
# never a coin flip: 8 of the 10 get it wrong, 7 of them on the same option.
# Indexes are into DEMO_COHORT.
_HARD_WRONG_PRIMARY = (1, 2, 3, 4, 5, 7, 9)
_HARD_WRONG_SECONDARY = (6,)

# Everything else: per classmate, which *other* scene positions they get wrong
# and which they never reach. Positions are taken modulo _PATTERN_PERIOD so the
# table applies to a world with any number of scenes; the aggregate wrong rate
# stays around a third, well clear of the blind spot's 80%.
_PATTERN_PERIOD = 5
# classmate index -> (wrong offsets, skipped offsets)
_ANSWER_PATTERN: tuple[tuple[tuple[int, ...], tuple[int, ...]], ...] = (
    ((), ()),               # Elif   - top of the board
    ((), ()),               # Aisha
    ((), ()),               # Bruno
    ((1,), ()),             # Chen
    ((4,), ()),             # Dara
    ((2, 3), ()),           # Farid
    ((0, 3), ()),           # Gemma
    ((1, 2, 3, 4), ()),     # Hugo   - bottom of the board
    ((0, 4), (2, 3)),       # Ines   - stopped partway through
    ((), (1, 2, 3, 4)),     # Jonas  - only just started
)


def ensure_demo_cohort() -> None:
    """Populate every seeded classroom, or just the one the env var names.

    Both hand-written servers get a class, so whichever one the pitch opens
    has a leaderboard with a spread rather than a single lonely row.
    """
    configured = get_settings().demo_cohort_server_id.strip()
    if configured:
        try:
            _ensure_demo_cohort(configured)
        except Exception:
            log.exception("seed: failed to create demo cohort")
        return
    for spec in (DEMO_SPEC, PY_SPEC):
        try:
            _ensure_demo_cohort("", join_code=spec.join_code)
        except Exception:
            log.exception("seed: failed to create cohort for %s", spec.join_code)


def _prediction_scenes(game_json: str | None) -> list[dict]:
    """Every `type: "prediction"` scene of a stored game, in order -- the same
    walk `services/progress.py` does."""
    if not game_json:
        return []
    game = json.loads(game_json)
    return [
        scene
        for chapter in game.get("chapters", [])
        for scene in chapter.get("scenes", [])
        if scene.get("type") == "prediction" and isinstance(scene.get("id"), str)
    ]


def _split_options(scene: dict) -> tuple[str | None, list[dict]]:
    """(correct option id, wrong options in scene order)."""
    correct = None
    wrong = []
    for option in scene.get("options", []):
        if not isinstance(option.get("id"), str):
            continue
        if option.get("correct"):
            if correct is None:
                correct = option["id"]
        else:
            wrong.append(option)
    return correct, wrong


def _playable_scenes(db, server_id: str) -> list[dict]:
    """Every answerable prediction scene of every ready world of a server,
    flattened into one ordered list."""
    out: list[dict] = []
    worlds = (
        db.query(models.World)
        .filter_by(server_id=server_id, status="ready")
        .order_by(models.World.idx)
        .all()
    )
    for world in worlds:
        for archetype, game_id, game_json in (
            ("quest", world.quest_id, world.quest_json),
            ("gauntlet", world.gauntlet_id, world.gauntlet_json),
        ):
            if not game_id:
                continue
            for scene in _prediction_scenes(game_json):
                correct, wrong = _split_options(scene)
                if correct is None or not wrong:
                    continue
                out.append({
                    "world_id": world.id, "archetype": archetype, "game_id": game_id,
                    "scene_id": scene["id"], "concept_id": scene.get("concept_id"),
                    "correct": correct, "wrong": wrong,
                })
    return out


def _blind_spot(scenes: list[dict]) -> int | None:
    """Index of the scene the cohort will mostly get wrong.

    Preferring a scene whose concept has no other scene, and whose wrong
    options all carry the same belief, is what makes `hardest_concept`
    meaningful: the errors concentrate on one concept AND on one misconception
    instead of averaging out across a concept's other scenes.
    """
    if not scenes:
        return None
    per_concept: dict = {}
    for s in scenes:
        per_concept[s["concept_id"]] = per_concept.get(s["concept_id"], 0) + 1

    def rank(i: int) -> tuple:
        s = scenes[i]
        beliefs = {o.get("misconception_id") for o in s["wrong"] if o.get("misconception_id")}
        return (
            per_concept.get(s["concept_id"], 0) == 1,   # concept owns this scene alone
            len(beliefs) == 1,                          # every wrong answer means one thing
            bool(beliefs),                              # ...at least it diagnoses something
            i,                                          # last such scene, deterministically
        )

    return max(range(len(scenes)), key=rank)


def _target_server(db, server_id: str, join_code: str = DEMO_JOIN_CODE) -> models.Server | None:
    """The configured server, or the seeded one with this join code. A bad id
    is a warning, never a crash: the cohort is a garnish."""
    if server_id:
        server = db.get(models.Server, server_id)
        if server is None:
            log.warning("seed: DEMO_COHORT_SERVER_ID %s not found, skipping cohort", server_id)
            return None
        if server.status != "ready":
            log.warning(
                "seed: DEMO_COHORT_SERVER_ID %s is %s, not ready, skipping cohort",
                server_id, server.status,
            )
            return None
        return server
    server = db.query(models.Server).filter_by(join_code=join_code).one_or_none()
    if server is None:
        log.warning("seed: no server with join code %s, skipping cohort", join_code)
    return server


def _ensure_demo_cohort(server_id: str, join_code: str = DEMO_JOIN_CODE) -> None:
    with session_scope() as db:
        server = _target_server(db, server_id, join_code)
        if server is None:
            return

        # Idempotency is per server, not global: the users are global rows, so
        # seeding classroom A must not make classroom B a no-op. The marker is
        # the first classmate's membership on *this* server.
        first = db.query(models.User).filter_by(email=COHORT_EMAILS[0]).one_or_none()
        if first is not None and db.query(models.Membership.id).filter_by(
            user_id=first.id, server_id=server.id
        ).first() is not None:
            log.info("seed: cohort already on server %s, skipping", server.id)
            return

        scenes = _playable_scenes(db, server.id)
        if not scenes:
            log.warning("seed: server %s has no answerable scenes, skipping cohort", server.id)
            return
        hard = _blind_spot(scenes)
        others = [i for i in range(len(scenes)) if i != hard]

        now = utc_now_iso()
        # One shared bcrypt hash: ten of them at startup is a second of nothing.
        password_hash = hash_password(COHORT_PASSWORD)
        created = 0

        for who, (display_name, local) in enumerate(DEMO_COHORT):
            email = f"{local}@classquest.app"
            user = db.query(models.User).filter_by(email=email).one_or_none()
            if user is None:
                user = models.User(
                    id=new_id(), email=email, password_hash=password_hash,
                    display_name=display_name, role="student", created_at=now,
                )
                db.add(user)
                db.flush()

            if db.query(models.Membership.id).filter_by(
                user_id=user.id, server_id=server.id
            ).first() is None:
                db.add(models.Membership(
                    id=new_id(), user_id=user.id, server_id=server.id,
                    role="member", joined_at=now,
                ))

            wrong_at, skip_at = _ANSWER_PATTERN[who]
            for position, index in enumerate(others):
                if position % _PATTERN_PERIOD in skip_at:
                    continue
                scene = scenes[index]
                if position % _PATTERN_PERIOD in wrong_at:
                    options = scene["wrong"]
                    option_id = options[(who + position) % len(options)]["id"]
                else:
                    option_id = scene["correct"]
                created += _record(db, user, server, scene, option_id)

            if hard is not None:
                scene = scenes[hard]
                if who in _HARD_WRONG_PRIMARY:
                    option_id = scene["wrong"][0]["id"]
                elif who in _HARD_WRONG_SECONDARY:
                    option_id = scene["wrong"][-1]["id"]
                else:
                    option_id = scene["correct"]
                created += _record(db, user, server, scene, option_id)

        log.info(
            "seed: cohort on server %s -- %d classmates, %d attempts",
            server.id, len(DEMO_COHORT), created,
        )


def _record(db, user: models.User, server: models.Server, scene: dict, option_id: str) -> int:
    """Insert one first-time attempt. Never touches an existing row: a real
    learner's history on this server has to survive a re-seed untouched."""
    existing = db.query(models.Attempt.id).filter_by(
        world_id=scene["world_id"], user_id=user.id, scene_id=scene["scene_id"],
    ).first()
    if existing is not None:
        return 0
    correct = option_id == scene["correct"]
    db.add(models.Attempt(
        id=new_id(), user_id=user.id, server_id=server.id, world_id=scene["world_id"],
        game_id=scene["game_id"], archetype=scene["archetype"], scene_id=scene["scene_id"],
        option_id=option_id, correct=correct,
        # These are first answers by construction, so the leaderboard
        # reconciles against the same rule the live endpoint uses.
        xp=scoring.xp_for_prediction(correct=correct, first_time=True),
        created_at=utc_now_iso(),
    ))
    return 1
