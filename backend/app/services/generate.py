"""The generation pipeline: uploaded segments -> worlds -> CourseGraph -> Quest
+ Gauntlet.

`start_pipeline` fires a daemon thread; `run_pipeline` does the work and is
also called directly by tests (synchronously, in fixture mode). Every step
opens its own short-lived session via `db.session_scope()` so no single
long-lived transaction blocks the one SQLite writer while an LLM call is in
flight. A world that fails does not sink the others: the server is `ready`
if at least one world made it, `failed` only if none did.
"""
import json
import logging
import math
import secrets
import threading
import time

from sqlalchemy import select

from app import db, ids
from app.config import get_settings
from app.models import GenerationEvent, Segment, Server, World
from app.services import fixtures, llm, prompts, validators

log = logging.getLogger("classquest.generate")
settings = get_settings()


class GenerationError(Exception):
    """A graph/quest/gauntlet ladder exhausted its one repair attempt without
    producing a document that validates."""


# --------------------------------------------------------------- in-flight


_inflight: set[str] = set()
_inflight_lock = threading.Lock()


def start_pipeline(server_id: str) -> bool:
    """Fire the pipeline in a daemon thread. False (no-op) if this server is
    already being generated."""
    with _inflight_lock:
        if server_id in _inflight:
            return False
        _inflight.add(server_id)

    threading.Thread(target=_run_and_release, args=(server_id,), daemon=True).start()
    return True


def _run_and_release(server_id: str) -> None:
    """Thread target: run the pipeline, then release the guard regardless of
    what `run_pipeline` (possibly patched out in tests) does with it."""
    try:
        run_pipeline(server_id)
    finally:
        with _inflight_lock:
            _inflight.discard(server_id)


# ------------------------------------------------------------------- events


def _event_id() -> str:
    """Nanosecond-timestamp-prefixed id: unique, and it sorts lexicographically
    in creation order. `generation_events` has no ORDER BY on its read path
    (the progress screen polls `WHERE server_id = ?`), and there is an index
    on (server_id, id) that a plain uuid4 id would return in random order."""
    return f"{time.time_ns():016x}{secrets.token_hex(4)}"


def log_event(db_session, server_id: str, stage: str, message: str, *,
               world_id: str | None = None, level: str = "info") -> None:
    db_session.add(GenerationEvent(
        id=_event_id(),
        server_id=server_id,
        world_id=world_id,
        stage=stage,
        level=level,
        message=str(message),
        created_at=ids.utc_now_iso(),
    ))


# -------------------------------------------------------------------- plan


def _to_int(value) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return None
    return None


def _clean_title(value, limit: int = 120) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()[:limit]
    return None


def _clean_blurb(value, limit: int = 200) -> str | None:
    if isinstance(value, str):
        return value[:limit]
    return None


def _fix_plan(raw, n: int, max_worlds: int) -> list[dict]:
    """Pure repair of the planner's raw output into a list of world dicts
    that tile [0, n-1] exactly: contiguous, non-overlapping, no gaps. Never
    raises; unusable input becomes an empty list."""
    if n <= 0:
        return []
    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict):
        items = raw.get("worlds")
    else:
        items = None
    if not isinstance(items, list):
        return []

    parsed = []
    for item in items:
        if not isinstance(item, dict):
            continue
        start = _to_int(item.get("segment_start"))
        end = _to_int(item.get("segment_end"))
        if start is None or end is None:
            continue
        if start > end:
            start, end = end, start
        start = max(0, min(start, n - 1))
        end = max(0, min(end, n - 1))
        parsed.append({
            "start": start, "end": end,
            "title": _clean_title(item.get("title")),
            "blurb": _clean_blurb(item.get("blurb")),
        })

    parsed.sort(key=lambda p: p["start"])

    kept = []
    last_end = -1
    for p in parsed:
        forced_start = last_end + 1
        if forced_start > p["end"]:
            continue  # swallowed by an earlier world, or past the end
        kept.append({"start": forced_start, "end": p["end"],
                     "title": p["title"], "blurb": p["blurb"]})
        last_end = p["end"]

    if not kept:
        return []

    if len(kept) > max_worlds:
        kept = kept[:max_worlds]
    kept[-1]["end"] = n - 1  # the last world always absorbs the tail

    result = []
    for k, p in enumerate(kept, start=1):
        result.append({
            "title": p["title"] or f"World {k}",
            "blurb": p["blurb"] if p["blurb"] is not None else "",
            "segment_start": p["start"],
            "segment_end": p["end"],
        })
    return result


def _even_chunks(n: int, max_worlds: int, server_name: str) -> list[dict]:
    """Deterministic fallback plan: as-even-as-possible contiguous chunks,
    roughly one world per 6 segments."""
    if n <= 0:
        return []
    k = max(1, min(max_worlds, math.ceil(n / 6)))
    base, rem = divmod(n, k)
    worlds = []
    start = 0
    for i in range(k):
        size = base + (1 if i < rem else 0)
        end = start + size - 1
        worlds.append({
            "title": f"{server_name} — Part {i + 1}",
            "blurb": "",
            "segment_start": start,
            "segment_end": end,
        })
        start = end + 1
    return worlds


def plan_worlds(server_name: str, description: str | None, segments: list[str],
                 max_worlds: int) -> list[dict]:
    """Ask the model to split `segments` into worlds; repair or fall back to
    an even split. Never raises."""
    n = len(segments)
    try:
        system, user = prompts.planner_prompt(server_name, description, segments, max_worlds)
        raw = llm.call_json(system, user, max_tokens=2000, temperature=0.3)
    except llm.FixtureMode:
        demo = fixtures.load_demo()
        if segments == demo.segments:
            return [{"title": demo.title, "blurb": "", "segment_start": 0, "segment_end": n - 1}]
        return _even_chunks(n, max_worlds, server_name)
    except Exception:  # noqa: BLE001 - plan_worlds must never raise
        return _even_chunks(n, max_worlds, server_name)

    plan = _fix_plan(raw, n, max_worlds)
    return plan if plan else _even_chunks(n, max_worlds, server_name)


# --------------------------------------------------------------- fixtures


def _fixture_graph(world_title: str, all_segments: list[str]) -> dict:
    demo = fixtures.load_demo()
    graph = demo.graph
    graph["graph_id"] = ids.artifact_id()
    graph.setdefault("source", {})
    graph["source"]["segment_count"] = len(all_segments)
    graph["source"]["title"] = world_title
    n = len(all_segments)
    if n < 14:
        for concept in graph.get("concepts", []):
            for span in concept.get("source_spans", []):
                sid = span.get("segment_id")
                if isinstance(sid, int) and not isinstance(sid, bool):
                    span["segment_id"] = min(sid, max(n - 1, 0))
    return graph


def _fixture_quest(graph: dict, _title: str) -> dict:
    demo = fixtures.load_demo()
    quest = demo.quest
    quest["game_id"] = ids.artifact_id()
    quest["graph_id"] = graph.get("graph_id")
    return quest


def _fixture_gauntlet(graph: dict, _title: str) -> dict:
    demo = fixtures.load_demo()
    gauntlet = demo.gauntlet
    gauntlet["game_id"] = ids.artifact_id()
    gauntlet["graph_id"] = graph.get("graph_id")
    return gauntlet


# ------------------------------------------------------------------ repair


def _validation_failure_message(original_user: str, doc: dict, errors: list[str]) -> str:
    bullets = "".join(f"\n- {e}" for e in errors)
    return (
        original_user + "\n\n"
        "Your previous answer:\n" + json.dumps(doc) + "\n\n"
        f"Your output failed validation:{bullets}\n"
        "Return the complete corrected JSON object. Do not explain."
    )


# ------------------------------------------------------------------- graph


def gen_graph(world_title: str, segments_for_world: list[tuple[int, str]],
              all_segments: list[str]) -> dict:
    system, user = prompts.graph_prompt(world_title, segments_for_world, len(all_segments))
    try:
        raw = llm.call_json(system, user, max_tokens=8000, temperature=0.2)
    except llm.FixtureMode:
        return _fixture_graph(world_title, all_segments)
    except (llm.LLMError, llm.LLMFormatError) as e:
        raise GenerationError(f"graph: {e}") from e

    repaired, _notes = validators.autorepair_graph(raw, all_segments)
    errors = validators.validate_graph(repaired, all_segments)
    if errors:
        repair_user = _validation_failure_message(user, repaired, errors)
        try:
            raw2 = llm.call_json(system, repair_user, max_tokens=8000, temperature=0.2)
        except (llm.LLMError, llm.LLMFormatError) as e:
            raise GenerationError(f"graph: {'; '.join(errors[:3])}") from e
        repaired, _notes = validators.autorepair_graph(raw2, all_segments)
        errors = validators.validate_graph(repaired, all_segments)
        if errors:
            raise GenerationError(f"graph: {'; '.join(errors[:3])}")

    repaired["graph_id"] = ids.artifact_id()
    repaired.setdefault("source", {})
    repaired["source"]["segment_count"] = len(all_segments)
    repaired["source"]["title"] = world_title
    return repaired


# ------------------------------------------------------------------- quest


def gen_quest(graph: dict, title: str, blurb: str) -> dict:
    system, user = prompts.quest_prompt(graph, title, blurb)
    try:
        raw = llm.call_json(system, user, max_tokens=8000, temperature=0.3)
    except llm.FixtureMode:
        return _fixture_quest(graph, title)
    except (llm.LLMError, llm.LLMFormatError) as e:
        raise GenerationError(f"quest: {e}") from e

    repaired, _notes = validators.autorepair_game(raw, graph)
    errors = validators.validate_game(repaired, graph)
    if errors:
        repair_user = _validation_failure_message(user, repaired, errors)
        try:
            raw2 = llm.call_json(system, repair_user, max_tokens=8000, temperature=0.3)
        except (llm.LLMError, llm.LLMFormatError) as e:
            raise GenerationError(f"quest: {'; '.join(errors[:3])}") from e
        repaired, _notes = validators.autorepair_game(raw2, graph)
        errors = validators.validate_game(repaired, graph)
        if errors:
            raise GenerationError(f"quest: {'; '.join(errors[:3])}")

    repaired["game_id"] = ids.artifact_id()
    repaired["graph_id"] = graph.get("graph_id")
    repaired["archetype"] = "quest"
    return repaired


# ---------------------------------------------------------------- gauntlet


def _noop_warn(_message: str) -> None:
    return None


def _gauntlet_fallback_or_raise(quest, graph, on_warn, errors) -> dict:
    if quest is None:
        raise GenerationError(f"gauntlet: {'; '.join(errors[:3])}")
    on_warn(
        "gauntlet generation failed validation; falling back to derive_gauntlet: "
        + "; ".join(errors[:3])
    )
    return validators.derive_gauntlet(quest, graph)


def gen_gauntlet(graph: dict, title: str, quest: dict | None = None,
                  on_warn=None) -> dict:
    if on_warn is None:
        on_warn = _noop_warn

    system, user = prompts.gauntlet_prompt(graph, title)
    try:
        raw = llm.call_json(system, user, max_tokens=4000, temperature=0.3)
    except llm.FixtureMode:
        return _fixture_gauntlet(graph, title)
    except (llm.LLMError, llm.LLMFormatError) as e:
        return _gauntlet_fallback_or_raise(quest, graph, on_warn, [str(e)])

    repaired, _notes = validators.autorepair_game(raw, graph)
    errors = validators.validate_game(repaired, graph)
    if errors:
        repair_user = _validation_failure_message(user, repaired, errors)
        try:
            raw2 = llm.call_json(system, repair_user, max_tokens=4000, temperature=0.3)
        except (llm.LLMError, llm.LLMFormatError):
            return _gauntlet_fallback_or_raise(quest, graph, on_warn, errors)
        repaired, _notes = validators.autorepair_game(raw2, graph)
        errors = validators.validate_game(repaired, graph)
        if errors:
            return _gauntlet_fallback_or_raise(quest, graph, on_warn, errors)

    repaired["game_id"] = ids.artifact_id()
    repaired["graph_id"] = graph.get("graph_id")
    repaired["archetype"] = "gauntlet"
    return repaired


# -------------------------------------------------------------------- run


def _fail_server(server_id: str, message: str) -> None:
    with db.session_scope() as s:
        server = s.get(Server, server_id)
        if server is None:
            return
        server.status = "failed"
        server.error = message[:500]
        log_event(s, server_id, "done", message[:2000], level="error")


def _run_world(server_id: str, world_id: str, all_segments: list[str]) -> bool:
    """Graph -> quest -> gauntlet for one world. Never raises: a failure is
    recorded on the world and False is returned so the server can still be
    ready from the other worlds."""
    with db.session_scope() as s:
        world = s.get(World, world_id)
        title = world.title
        blurb = world.blurb or ""
        start, end = world.segment_start, world.segment_end
        world.status = "processing"
        world.stage = "graph"
    seg_slice = [(i, all_segments[i]) for i in range(start, end + 1)]

    stage = "graph"
    try:
        graph = gen_graph(title, seg_slice, all_segments)
        with db.session_scope() as s:
            world = s.get(World, world_id)
            world.graph_json = json.dumps(graph)
            world.graph_id = graph["graph_id"]
            world.stage = "quest"
            log_event(s, server_id, "graph", f"Graph ready for '{title}'", world_id=world_id)
        stage = "quest"

        quest = gen_quest(graph, title, blurb)
        with db.session_scope() as s:
            world = s.get(World, world_id)
            world.quest_json = json.dumps(quest)
            world.quest_id = quest["game_id"]
            world.stage = "gauntlet"
            log_event(s, server_id, "quest", f"Quest ready for '{title}'", world_id=world_id)
        stage = "gauntlet"

        def _on_warn(msg: str) -> None:
            with db.session_scope() as s2:
                log_event(s2, server_id, "gauntlet", msg, world_id=world_id, level="warn")

        gauntlet = gen_gauntlet(graph, title, quest=quest, on_warn=_on_warn)
        with db.session_scope() as s:
            world = s.get(World, world_id)
            world.gauntlet_json = json.dumps(gauntlet)
            world.gauntlet_id = gauntlet["game_id"]
            world.stage = None
            world.status = "ready"
            log_event(s, server_id, "gauntlet", f"Gauntlet ready for '{title}'", world_id=world_id)
        return True
    except Exception as e:  # noqa: BLE001 - a world failing must not sink the pipeline
        with db.session_scope() as s:
            world = s.get(World, world_id)
            world.status = "failed"
            world.stage = None
            world.error = str(e)[:500]
            log_event(s, server_id, stage, f"{title}: {e}", world_id=world_id, level="error")
        return False


def _run_pipeline_inner(server_id: str) -> None:
    with db.session_scope() as s:
        server = s.get(Server, server_id)
        if server is None:
            return
        seg_rows = s.execute(
            select(Segment).where(Segment.server_id == server_id).order_by(Segment.seq)
        ).scalars().all()
        segments = [r.text for r in seg_rows]
        server_name, description = server.name, server.description
        log_event(s, server_id, "ingest", f"Ingested {len(segments)} segment(s)")

    plan = plan_worlds(server_name, description, segments, settings.max_worlds)
    if not plan:
        _fail_server(server_id, "No worlds could be planned (not enough source material)")
        return

    world_ids: list[str] = []
    with db.session_scope() as s:
        log_event(s, server_id, "plan", f"Planned {len(plan)} world(s)")
        for idx, w in enumerate(plan):
            world = World(
                id=ids.new_id(),
                server_id=server_id,
                idx=idx,
                title=w["title"],
                blurb=w.get("blurb"),
                segment_start=w["segment_start"],
                segment_end=w["segment_end"],
                status="pending",
                stage=None,
                created_at=ids.utc_now_iso(),
            )
            s.add(world)
            s.flush()
            world_ids.append(world.id)

    any_ready = False
    for world_id in world_ids:
        if _run_world(server_id, world_id, segments):
            any_ready = True

    with db.session_scope() as s:
        server = s.get(Server, server_id)
        if any_ready:
            server.status = "ready"
            server.error = None
            log_event(s, server_id, "done", "Pipeline finished")
        else:
            server.status = "failed"
            server.error = "All worlds failed to generate"
            log_event(s, server_id, "done", "All worlds failed to generate", level="error")


def run_pipeline(server_id: str) -> None:
    """Blocking. Opens its own short-lived sessions. Always releases the
    in-flight guard, even on an unexpected crash."""
    try:
        try:
            _run_pipeline_inner(server_id)
        except Exception as e:  # noqa: BLE001 - guarantee a failed status, not a silent thread death
            log.exception("pipeline crashed for server %s", server_id)
            try:
                _fail_server(server_id, f"pipeline crashed: {e}")
            except Exception:  # noqa: BLE001 - the crash record itself must never re-crash the thread
                log.exception("failed to record pipeline crash for server %s", server_id)
    finally:
        with _inflight_lock:
            _inflight.discard(server_id)
