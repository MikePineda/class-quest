"""Generation pipeline. The model is replaced by fakes patched onto
`app.services.generate.llm.call_json`; the end-to-end tests run the real
pipeline in fixture mode (LLM_API_KEY is empty under tests)."""
import copy
import json
import re
import threading

import pytest
from sqlalchemy import select

from app import ids
from app.db import SessionLocal
from app.models import Document, GenerationEvent, Segment, Server, User, World
from app.services import fixtures, generate, llm, validators

ARTIFACT_RE = re.compile(r"^[a-z0-9]{8,32}$")


def _w(start, end, title="T", blurb="B"):
    return {"title": title, "blurb": blurb, "segment_start": start, "segment_end": end}


def _ranges(plan):
    return [(w["segment_start"], w["segment_end"]) for w in plan]


def _assert_tiles(plan, n):
    """Ranges are contiguous, non-overlapping and cover exactly 0..n-1."""
    assert plan, "plan is empty"
    assert plan[0]["segment_start"] == 0
    assert plan[-1]["segment_end"] == n - 1
    for prev, cur in zip(plan, plan[1:]):
        assert cur["segment_start"] == prev["segment_end"] + 1
    for w in plan:
        assert w["segment_start"] <= w["segment_end"]
        assert isinstance(w["title"], str) and w["title"].strip()
        assert isinstance(w["blurb"], str)


# --- _fix_plan -------------------------------------------------------------


def test_fix_plan_keeps_a_clean_plan():
    plan = generate._fix_plan({"worlds": [_w(0, 4, "A", "a"), _w(5, 9, "B", "b")]}, 10, 6)
    assert _ranges(plan) == [(0, 4), (5, 9)]
    assert [w["title"] for w in plan] == ["A", "B"]
    assert [w["blurb"] for w in plan] == ["a", "b"]


def test_fix_plan_accepts_a_bare_list():
    plan = generate._fix_plan([_w(0, 2), _w(3, 5)], 6, 6)
    assert _ranges(plan) == [(0, 2), (3, 5)]


def test_fix_plan_resolves_overlaps():
    plan = generate._fix_plan({"worlds": [_w(0, 5), _w(3, 9)]}, 10, 6)
    assert _ranges(plan) == [(0, 5), (6, 9)]
    _assert_tiles(plan, 10)


def test_fix_plan_fills_gaps():
    plan = generate._fix_plan({"worlds": [_w(0, 2), _w(6, 9)]}, 10, 6)
    assert _ranges(plan) == [(0, 2), (3, 9)]
    _assert_tiles(plan, 10)


def test_fix_plan_extends_last_world_to_cover_the_tail():
    plan = generate._fix_plan({"worlds": [_w(0, 3), _w(4, 6)]}, 12, 6)
    assert _ranges(plan) == [(0, 3), (4, 11)]


def test_fix_plan_sorts_and_handles_reversed_bounds():
    plan = generate._fix_plan({"worlds": [_w(7, 9, "Late"), _w(6, 0, "Early")]}, 10, 6)
    assert _ranges(plan) == [(0, 6), (7, 9)]
    assert [w["title"] for w in plan] == ["Early", "Late"]


def test_fix_plan_clamps_out_of_range():
    plan = generate._fix_plan({"worlds": [_w(-3, 4), _w(5, 40)]}, 10, 6)
    assert _ranges(plan) == [(0, 4), (5, 9)]


def test_fix_plan_drops_worlds_swallowed_by_earlier_ones():
    plan = generate._fix_plan({"worlds": [_w(0, 8, "Big"), _w(2, 4, "Inner"), _w(9, 9, "Tail")]}, 10, 6)
    assert _ranges(plan) == [(0, 8), (9, 9)]
    assert [w["title"] for w in plan] == ["Big", "Tail"]


def test_fix_plan_drops_worlds_beyond_the_end():
    plan = generate._fix_plan({"worlds": [_w(0, 9), _w(10, 15), _w(16, 20)]}, 10, 6)
    assert _ranges(plan) == [(0, 9)]


def test_fix_plan_truncates_to_max_worlds_and_last_absorbs_rest():
    worlds = [_w(i * 2, i * 2 + 1) for i in range(6)]  # 6 worlds over 12 segments
    plan = generate._fix_plan({"worlds": worlds}, 12, 3)
    assert _ranges(plan) == [(0, 1), (2, 3), (4, 11)]


def test_fix_plan_junk_items_are_skipped_and_string_ints_accepted():
    raw = {
        "worlds": [
            "nope",
            42,
            {"title": "no bounds"},
            {"segment_start": "0", "segment_end": "3", "title": "S"},
            {"segment_start": 4, "segment_end": None},
            {"segment_start": "four", "segment_end": 7},
            _w(4, 7, "Fine"),
        ]
    }
    plan = generate._fix_plan(raw, 8, 6)
    assert _ranges(plan) == [(0, 3), (4, 7)]
    assert [w["title"] for w in plan] == ["S", "Fine"]


@pytest.mark.parametrize("raw", [None, "text", 7, [], {}, {"worlds": "x"}, {"worlds": []},
                                 {"worlds": [{"title": "no bounds"}]}])
def test_fix_plan_unusable_input_returns_empty(raw):
    assert generate._fix_plan(raw, 10, 6) == []


def test_fix_plan_defaults_missing_or_blank_titles_and_blurbs():
    raw = {"worlds": [
        {"segment_start": 0, "segment_end": 2},
        {"segment_start": 3, "segment_end": 5, "title": "   ", "blurb": None},
        {"segment_start": 6, "segment_end": 9, "title": 123, "blurb": ["x"]},
    ]}
    plan = generate._fix_plan(raw, 10, 6)
    assert len(plan) == 3
    for k, w in enumerate(plan, start=1):
        assert w["title"].strip() and str(k) in w["title"]
        assert isinstance(w["blurb"], str)


def test_fix_plan_caps_over_long_titles_and_blurbs():
    raw = {"worlds": [_w(0, 9, "t" * 500, "b" * 900)]}
    plan = generate._fix_plan(raw, 10, 6)
    assert len(plan[0]["title"]) <= 120
    assert len(plan[0]["blurb"]) <= 200


def test_fix_plan_single_segment_document():
    plan = generate._fix_plan({"worlds": [_w(0, 0)]}, 1, 6)
    assert _ranges(plan) == [(0, 0)]


def test_fix_plan_zero_segments_is_empty():
    assert generate._fix_plan({"worlds": [_w(0, 3)]}, 0, 6) == []


# --- _even_chunks ----------------------------------------------------------


def test_even_chunks_fourteen_segments():
    plan = generate._even_chunks(14, 6, "Intro ML")
    _assert_tiles(plan, 14)
    assert len(plan) == 3  # min(6, ceil(14/6))
    assert plan[0]["title"] == "Intro ML — Part 1"
    assert plan[-1]["title"] == "Intro ML — Part 3"


def test_even_chunks_respects_max_worlds():
    plan = generate._even_chunks(60, 4, "X")
    _assert_tiles(plan, 60)
    assert len(plan) == 4
    sizes = [w["segment_end"] - w["segment_start"] + 1 for w in plan]
    assert max(sizes) - min(sizes) <= 1


def test_even_chunks_small_inputs():
    assert _ranges(generate._even_chunks(1, 6, "X")) == [(0, 0)]
    assert _ranges(generate._even_chunks(5, 6, "X")) == [(0, 4)]
    assert generate._even_chunks(0, 6, "X") == []


# --- plan_worlds -----------------------------------------------------------


def test_plan_worlds_uses_model_output(monkeypatch):
    calls = []

    def fake(system, user, **kw):
        calls.append(kw)
        return {"worlds": [_w(0, 6, "First half", "a"), _w(7, 13, "Second half", "b")]}

    monkeypatch.setattr(generate.llm, "call_json", fake)
    plan = generate.plan_worlds("C", "d", ["s"] * 14, 6)
    assert _ranges(plan) == [(0, 6), (7, 13)]
    assert calls[0]["max_tokens"] == 2000
    assert calls[0]["temperature"] == 0.3


def test_plan_worlds_falls_back_on_format_error(monkeypatch):
    def fake(system, user, **kw):
        raise llm.LLMFormatError("nope")

    monkeypatch.setattr(generate.llm, "call_json", fake)
    plan = generate.plan_worlds("Course", "", ["s"] * 14, 6)
    assert plan == generate._even_chunks(14, 6, "Course")


def test_plan_worlds_falls_back_on_llm_error_and_junk(monkeypatch):
    def boom(system, user, **kw):
        raise llm.LLMError("timeout")

    monkeypatch.setattr(generate.llm, "call_json", boom)
    assert generate.plan_worlds("C", "", ["s"] * 20, 6) == generate._even_chunks(20, 6, "C")

    monkeypatch.setattr(generate.llm, "call_json", lambda s, u, **kw: {"worlds": "garbage"})
    assert generate.plan_worlds("C", "", ["s"] * 20, 6) == generate._even_chunks(20, 6, "C")


def test_plan_worlds_never_raises(monkeypatch):
    def boom(system, user, **kw):
        raise RuntimeError("unexpected")

    monkeypatch.setattr(generate.llm, "call_json", boom)
    assert generate.plan_worlds("C", "", ["s"] * 9, 6) == generate._even_chunks(9, 6, "C")


def test_plan_worlds_fixture_mode_demo_segments_is_one_world():
    demo = fixtures.load_demo()
    plan = generate.plan_worlds("Whatever", "", demo.segments, 6)
    assert _ranges(plan) == [(0, 13)]
    assert plan[0]["title"] == demo.title


def test_plan_worlds_fixture_mode_other_segments_is_even_chunks():
    plan = generate.plan_worlds("Other", "", ["foo"] * 14, 6)
    assert plan == generate._even_chunks(14, 6, "Other")


# --- gen_graph -------------------------------------------------------------


@pytest.fixture
def demo():
    return fixtures.load_demo()


def _world_segments(demo):
    return [(i, s) for i, s in enumerate(demo.segments)]


def _install(monkeypatch, *responses):
    calls = []
    queue = list(responses)

    def fake(system, user, **kw):
        calls.append({"system": system, "user": user, **kw})
        item = queue.pop(0)
        if isinstance(item, Exception):
            raise item
        return copy.deepcopy(item)

    monkeypatch.setattr(generate.llm, "call_json", fake)
    return calls


def test_gen_graph_happy_path_overwrites_graph_id(monkeypatch, demo):
    raw = copy.deepcopy(demo.graph)
    raw["graph_id"] = "BOGUS ID!!"
    raw["source"]["segment_count"] = 999
    calls = _install(monkeypatch, raw)
    graph = generate.gen_graph("Week 3", _world_segments(demo), demo.segments)
    assert len(calls) == 1
    assert calls[0]["max_tokens"] == 8000 and calls[0]["temperature"] == 0.2
    assert ARTIFACT_RE.match(graph["graph_id"]) and graph["graph_id"] != "wk3ml0a1"
    assert graph["source"]["segment_count"] == 14
    assert validators.validate_graph(graph, demo.segments) == []


def test_gen_graph_repairs_once_when_first_output_has_errors(monkeypatch, demo):
    # A cycle that autorepair can break is not enough: use an unknown
    # prerequisite on every concept so too few survive and the model is asked.
    bad = copy.deepcopy(demo.graph)
    for c in bad["concepts"]:
        c["source_spans"] = [{"segment_id": 0, "quote": "this sentence is not in the lecture"}]
    calls = _install(monkeypatch, bad, copy.deepcopy(demo.graph))
    graph = generate.gen_graph("Week 3", _world_segments(demo), demo.segments)
    assert len(calls) == 2
    repair_user = calls[1]["user"]
    assert "Your output failed validation:" in repair_user
    assert "Return the complete corrected JSON object. Do not explain." in repair_user
    assert "\n- " in repair_user
    assert validators.validate_graph(graph, demo.segments) == []


def test_gen_graph_cycle_is_autorepaired_without_a_second_call(monkeypatch, demo):
    bad = copy.deepcopy(demo.graph)
    next(c for c in bad["concepts"] if c["id"] == "training_data")["prerequisites"] = ["overfitting"]
    calls = _install(monkeypatch, bad)
    graph = generate.gen_graph("Week 3", _world_segments(demo), demo.segments)
    assert len(calls) == 1
    assert validators.validate_graph(graph, demo.segments) == []


def test_gen_graph_raises_when_both_attempts_fail(monkeypatch, demo):
    bad = copy.deepcopy(demo.graph)
    for c in bad["concepts"]:
        c["source_spans"] = [{"segment_id": 0, "quote": "not in the lecture at all"}]
    calls = _install(monkeypatch, bad, copy.deepcopy(bad))
    with pytest.raises(generate.GenerationError) as ei:
        generate.gen_graph("Week 3", _world_segments(demo), demo.segments)
    assert len(calls) == 2
    # Same rule as the quest: the stage is prefixed once, by `_generate_world`.
    assert not str(ei.value).startswith("graph:")
    assert "concepts" in str(ei.value)


def test_gen_graph_uses_world_subrange_but_global_segment_ids(monkeypatch, demo):
    # A world covering segments 4..10 still validates spans against the full list.
    raw = copy.deepcopy(demo.graph)
    calls = _install(monkeypatch, raw)
    world = [(i, demo.segments[i]) for i in range(2, 11)]
    graph = generate.gen_graph("Middle", world, demo.segments)
    assert "=== SEGMENT 2 ===" in calls[0]["user"]
    assert "=== SEGMENT 0 ===" not in calls[0]["user"]
    assert graph["source"]["segment_count"] == 14
    assert graph["source"]["title"] == "Middle"


def test_gen_graph_llm_error_becomes_generation_error(monkeypatch, demo):
    _install(monkeypatch, llm.LLMError("boom"))
    with pytest.raises(generate.GenerationError):
        generate.gen_graph("W", _world_segments(demo), demo.segments)


def test_gen_graph_fixture_mode_returns_demo_graph_with_fresh_id(demo):
    graph = generate.gen_graph("My World", _world_segments(demo), demo.segments)
    assert ARTIFACT_RE.match(graph["graph_id"]) and graph["graph_id"] != "wk3ml0a1"
    assert graph["source"]["title"] == "My World"
    assert validators.validate_graph(graph, demo.segments) == []


def test_gen_graph_fixture_mode_short_document_clamps_spans(demo):
    segs = ["alpha", "beta", "gamma"]
    graph = generate.gen_graph("Tiny", [(0, "alpha"), (1, "beta"), (2, "gamma")], segs)
    assert graph["source"]["segment_count"] == 3
    for c in graph["concepts"]:
        for sp in c["source_spans"]:
            assert 0 <= sp["segment_id"] <= 2


# --- gen_quest / gen_gauntlet ---------------------------------------------


def test_gen_quest_happy_path(monkeypatch, demo):
    graph = copy.deepcopy(demo.graph)
    graph["graph_id"] = ids.artifact_id()
    raw = copy.deepcopy(demo.quest)
    raw["game_id"] = "BAD"
    raw["graph_id"] = "wrong"
    raw["archetype"] = "gauntlet"
    calls = _install(monkeypatch, raw)
    quest = generate.gen_quest(graph, "Title", "blurb")
    assert len(calls) == 1
    assert calls[0]["max_tokens"] == 8000
    assert quest["archetype"] == "quest"
    assert quest["graph_id"] == graph["graph_id"]
    assert ARTIFACT_RE.match(quest["game_id"]) and quest["game_id"] != "q7kp2wm4"
    assert validators.validate_game(quest, graph) == []


def test_gen_quest_repairs_once_then_raises(monkeypatch, demo):
    graph = demo.graph
    calls = _install(monkeypatch, {"chapters": []}, {"nothing": True})
    with pytest.raises(generate.GenerationError) as ei:
        generate.gen_quest(graph, "T", "b")
    assert len(calls) == 2
    # The stage is named once, by `_generate_world`, not here: this message is
    # what gets that prefix, so a "quest:" in it would come out doubled.
    assert not str(ei.value).startswith("quest:")
    assert "chapters" in str(ei.value)


def test_gen_gauntlet_happy_path(monkeypatch, demo):
    calls = _install(monkeypatch, copy.deepcopy(demo.gauntlet))
    g = generate.gen_gauntlet(demo.graph, "T")
    assert calls[0]["max_tokens"] == 4000
    assert g["archetype"] == "gauntlet"
    assert ARTIFACT_RE.match(g["game_id"]) and g["game_id"] != "g3xn8vr1"
    assert validators.validate_game(g, demo.graph) == []


def test_gen_gauntlet_falls_back_to_derive_when_model_is_unusable(monkeypatch, demo):
    calls = _install(monkeypatch, {"junk": 1}, {"junk": 2})
    warnings = []
    g = generate.gen_gauntlet(demo.graph, "T", quest=demo.quest, on_warn=warnings.append)
    assert len(calls) == 2
    assert g["archetype"] == "gauntlet"
    assert g["graph_id"] == demo.graph["graph_id"]
    assert validators.validate_game(g, demo.graph) == []
    ids_in = [s["id"] for ch in g["chapters"] for s in ch["scenes"]]
    assert ids_in == ["g_sc_pred_training", "g_sc_pred_overfit", "g_sc_transfer_overfit"]
    assert warnings and "derive" in warnings[0].lower() or "fallback" in warnings[0].lower()


def test_gen_gauntlet_without_quest_raises_when_model_is_unusable(monkeypatch, demo):
    _install(monkeypatch, {"junk": 1}, {"junk": 2})
    with pytest.raises(generate.GenerationError):
        generate.gen_gauntlet(demo.graph, "T")


def test_fixture_mode_games_share_the_graph_id(demo):
    graph = generate.gen_graph("W", _world_segments(demo), demo.segments)
    quest = generate.gen_quest(graph, "W", "b")
    gauntlet = generate.gen_gauntlet(graph, "W", quest=quest)
    assert quest["graph_id"] == gauntlet["graph_id"] == graph["graph_id"]
    assert quest["game_id"] != gauntlet["game_id"]
    assert validators.validate_game(quest, graph) == []
    assert validators.validate_game(gauntlet, graph) == []


# --- end to end ------------------------------------------------------------


def _seed_server(segments: list[str]) -> str:
    now = ids.utc_now_iso()
    with SessionLocal() as db:
        user = User(id=ids.new_id(), email="t@example.com", password_hash="x",
                    display_name="T", created_at=now)
        db.add(user)
        db.flush()
        server = Server(id=ids.new_id(), name="Intro ML", description="Week 3",
                        join_code="ABC234", pet="owl", owner_id=user.id, status="pending",
                        segment_count=len(segments), created_at=now)
        db.add(server)
        db.flush()
        doc = Document(id=ids.new_id(), server_id=server.id, filename="lecture.txt",
                       content_type="text/plain", char_count=sum(map(len, segments)),
                       created_at=now)
        db.add(doc)
        db.flush()
        for i, text in enumerate(segments):
            db.add(Segment(id=ids.new_id(), server_id=server.id, document_id=doc.id,
                           seq=i, text=text))
        db.commit()
        return server.id


def _events(db, server_id):
    rows = db.execute(
        select(GenerationEvent).where(GenerationEvent.server_id == server_id)
    ).scalars().all()
    return rows


def test_run_pipeline_end_to_end_in_fixture_mode(demo):
    server_id = _seed_server(demo.segments)
    generate.run_pipeline(server_id)

    with SessionLocal() as db:
        server = db.get(Server, server_id)
        assert server.status == "ready", server.error
        assert server.error is None
        worlds = db.execute(select(World).where(World.server_id == server_id)).scalars().all()
        assert len(worlds) == 1
        w = worlds[0]
        assert w.status == "ready" and w.stage is None and w.error is None
        assert w.idx == 0 and (w.segment_start, w.segment_end) == (0, 13)
        assert w.title == demo.title
        graph = json.loads(w.graph_json)
        quest = json.loads(w.quest_json)
        gauntlet = json.loads(w.gauntlet_json)
        assert w.graph_id == graph["graph_id"] and ARTIFACT_RE.match(w.graph_id)
        assert w.quest_id == quest["game_id"] and w.gauntlet_id == gauntlet["game_id"]
        assert validators.validate_graph(graph, demo.segments) == []
        assert validators.validate_game(quest, graph) == []
        assert validators.validate_game(gauntlet, graph) == []
        events = _events(db, server_id)
        stages = [e.stage for e in events]
        for stage in ("ingest", "plan", "graph", "quest", "gauntlet", "done"):
            assert stage in stages, stages
        assert stages.index("ingest") < stages.index("plan") < stages.index("graph")
        assert stages.index("gauntlet") < stages.index("done")
        assert all(e.level in ("info", "warn", "error") for e in events)
        assert all(e.created_at for e in events)
        world_events = [e for e in events if e.world_id == w.id]
        assert {e.stage for e in world_events} >= {"graph", "quest", "gauntlet"}
    assert server_id not in generate._inflight


def test_run_pipeline_marks_world_and_server_failed(monkeypatch, demo):
    def boom(graph, title, blurb):
        raise RuntimeError("quest exploded")

    monkeypatch.setattr(generate, "gen_quest", boom)
    server_id = _seed_server(demo.segments)
    with generate._inflight_lock:
        generate._inflight.add(server_id)
    generate.run_pipeline(server_id)

    assert server_id not in generate._inflight
    with SessionLocal() as db:
        server = db.get(Server, server_id)
        assert server.status == "failed"
        assert server.error == "All worlds failed to generate"
        w = db.execute(select(World).where(World.server_id == server_id)).scalars().one()
        assert w.status == "failed"
        assert w.stage is None
        assert "quest exploded" in w.error
        assert w.graph_json is not None  # the graph stage had already been stored
        assert w.quest_json is None
        events = _events(db, server_id)
        assert any(e.level == "error" and "quest exploded" in e.message for e in events)
        assert events[-1].stage == "done"


def test_run_pipeline_missing_server_releases_guard():
    sid = ids.new_id()
    with generate._inflight_lock:
        generate._inflight.add(sid)
    generate.run_pipeline(sid)  # must not raise
    assert sid not in generate._inflight


def test_run_pipeline_with_no_segments_fails_cleanly():
    server_id = _seed_server([])
    generate.run_pipeline(server_id)
    with SessionLocal() as db:
        server = db.get(Server, server_id)
        assert server.status == "failed"
        assert server.error
        assert _events(db, server_id)[-1].stage == "done"


def test_run_pipeline_survives_a_crash_after_planning(monkeypatch, demo):
    def boom(*a, **kw):
        raise RuntimeError("planner died badly")

    monkeypatch.setattr(generate, "plan_worlds", boom)
    server_id = _seed_server(demo.segments)
    generate.run_pipeline(server_id)
    assert server_id not in generate._inflight
    with SessionLocal() as db:
        server = db.get(Server, server_id)
        assert server.status == "failed"
        assert "planner died badly" in server.error


# --- start_pipeline --------------------------------------------------------


def test_start_pipeline_rejects_while_in_flight(monkeypatch):
    release = threading.Event()
    started = threading.Event()
    seen = []

    def fake_run(server_id):
        seen.append(server_id)
        started.set()
        release.wait(timeout=5)

    monkeypatch.setattr(generate, "run_pipeline", fake_run)
    sid = ids.new_id()
    try:
        assert generate.start_pipeline(sid) is True
        assert started.wait(timeout=5)
        assert generate.start_pipeline(sid) is False
        assert generate.start_pipeline(ids.new_id()) is True  # other servers are fine
        release.set()
        for _ in range(200):
            if sid not in generate._inflight:
                break
            threading.Event().wait(0.01)
        assert sid not in generate._inflight
        assert generate.start_pipeline(sid) is True  # guard released after the run
        assert seen.count(sid) == 2
    finally:
        release.set()
        with generate._inflight_lock:
            generate._inflight.clear()


def test_start_pipeline_thread_is_daemon(monkeypatch):
    captured = {}

    class FakeThread:
        def __init__(self, *, target, args, daemon=False, name=None):
            captured.update(target=target, args=args, daemon=daemon)

        def start(self):
            pass

    monkeypatch.setattr(generate.threading, "Thread", FakeThread)
    sid = ids.new_id()
    try:
        assert generate.start_pipeline(sid) is True
        assert captured["daemon"] is True
        assert captured["args"] == (sid,)
    finally:
        with generate._inflight_lock:
            generate._inflight.discard(sid)


class TestEffectiveMaxWorlds:
    """The world count must follow the amount of content, not just the ceiling.

    A 14-segment upload split into 6 worlds gives ~2 segments each: thin worlds
    and 18 LLM calls before anything is playable. _even_chunks already used a
    one-world-per-six-segments rule; the planner now uses the same one, so the
    model is asked for a sensible number and cannot exceed it.
    """

    def test_short_upload_gets_a_single_world(self):
        assert generate._effective_max_worlds(5, 6) == 1
        assert generate._effective_max_worlds(6, 6) == 1

    def test_medium_upload_scales_with_content(self):
        assert generate._effective_max_worlds(14, 6) == 3
        assert generate._effective_max_worlds(20, 6) == 4

    def test_long_upload_is_capped_by_the_setting(self):
        assert generate._effective_max_worlds(200, 6) == 6
        assert generate._effective_max_worlds(200, 2) == 2

    def test_never_returns_less_than_one(self):
        assert generate._effective_max_worlds(1, 6) == 1
        assert generate._effective_max_worlds(0, 6) == 1

    def test_matches_the_deterministic_fallback(self):
        for n in (1, 5, 13, 14, 25, 60):
            assert len(generate._even_chunks(n, 6, "S")) == generate._effective_max_worlds(n, 6)

    def test_plan_worlds_caps_an_over_eager_model(self, monkeypatch):
        segments = [f"segment {i}" for i in range(14)]
        raw = {"worlds": [
            {"title": f"W{i}", "blurb": "", "segment_start": i * 2, "segment_end": i * 2 + 1}
            for i in range(6)
        ]}
        monkeypatch.setattr(generate.llm, "call_json", lambda *a, **k: raw)
        plan = generate.plan_worlds("Course", None, segments, 6)
        assert len(plan) <= 3
        assert plan[0]["segment_start"] == 0
        assert plan[-1]["segment_end"] == 13

    def test_planner_prompt_is_asked_for_the_effective_number(self, monkeypatch):
        segments = [f"segment {i}" for i in range(14)]
        seen = {}

        def fake_prompt(name, desc, segs, max_worlds):
            seen["max_worlds"] = max_worlds
            return ("sys", "user")

        monkeypatch.setattr(generate.prompts, "planner_prompt", fake_prompt)
        monkeypatch.setattr(generate.llm, "call_json", lambda *a, **k: {"worlds": []})
        generate.plan_worlds("Course", None, segments, 6)
        assert seen["max_worlds"] == 3


def test_failed_world_error_names_the_stage(monkeypatch, demo):
    """A world's error reaches the user through the API, so it has to say which
    stage died. A bare exception string means an SSH session to find out."""
    def boom(graph, title, blurb):
        raise RuntimeError("boom")

    monkeypatch.setattr(generate, "gen_quest", boom)
    server_id = _seed_server(demo.segments)
    generate.run_pipeline(server_id)

    with SessionLocal() as db:
        w = db.execute(select(World).where(World.server_id == server_id)).scalars().one()
        assert w.error.startswith("quest: "), w.error
        assert "boom" in w.error
        # Exactly once. The stage used to be prefixed by the raiser as well as
        # here, and the learner was shown "quest: quest: ...".
        assert w.error.count("quest:") == 1, w.error
