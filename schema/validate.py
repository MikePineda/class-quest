#!/usr/bin/env python3
"""Validate ClassQuest fixtures against the schemas.

Run from the repo root:  python3 schema/validate.py

Every bundle in fixtures/ is checked: one `<name>.graph.json` plus the games
that name its `graph_id`. Games are paired with their own graph rather than
with a single hardcoded one -- with two bundles present, validating the second
one's quest against the first one's concepts fails on every reference, and the
error says nothing useful about which file is actually wrong.

Checks the JSON Schema contract plus the cross-file invariants a schema cannot
express on its own:
  1. concept ids are unique
  2. prerequisites resolve and contain no cycles
  3. every source_span quote appears verbatim in the segment it cites
  4. every scene concept_id and option misconception_id resolves in the graph
  5. chapter order respects prerequisite order
  6. every game belongs to a graph that is present
"""
import json, sys, glob
from pathlib import Path
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "fixtures"
errors = []


def fail(where, msg):
    errors.append(f"{where}: {msg}")


def load(p):
    return json.loads(Path(p).read_text())


# A graph's source text is `<stem>_lecture.txt`, except the first bundle, which
# was named before there was a second one. Spelled out rather than guessed:
# falling back to "whatever lecture file exists" silently validated one
# bundle's quotes against another bundle's text.
SOURCE_TEXT = {"overfitting": "demo_lecture.txt"}


def segments_for(graph_path):
    """The source text a graph's spans quote, split the way the backend splits
    it (`services/fixtures.py`: strip, then blank lines)."""
    stem = graph_path.name.removesuffix(".graph.json")
    path = FIXTURES / SOURCE_TEXT.get(stem, f"{stem}_lecture.txt")
    if not path.exists():
        return path.name, None
    text = path.read_text().strip()
    return path.name, [p.strip() for p in text.split("\n\n") if p.strip()]


graph_schema = load(ROOT / "schema/course-graph.schema.json")
game_schema = load(ROOT / "schema/game.schema.json")

graph_paths = sorted(FIXTURES.glob("*.graph.json"))
game_paths = sorted(FIXTURES.glob("*.quest.json")) + sorted(FIXTURES.glob("*.gauntlet.json"))
if not graph_paths:
    fail("fixtures", "no *.graph.json found")

graphs = {}
for path in graph_paths:
    graph = load(path)
    key = graph.get("graph_id")
    if key in graphs:
        fail("fixtures", f"two graphs share graph_id {key}")
    graphs[key] = (path, graph)

# Pair each game with the graph it names, so an orphan is a named failure
# rather than a hundred unresolved references.
bundles = {key: [] for key in graphs}
for path in game_paths:
    game = load(path)
    key = game.get("graph_id")
    if key not in graphs:
        fail(path.name, f"graph_id {key} matches no graph in fixtures/")
        continue
    bundles[key].append(game)

for key, (graph_path, graph) in graphs.items():
    games = bundles[key]
    name = graph_path.name

    # 0. schema conformance
    for err in Draft202012Validator(graph_schema).iter_errors(graph):
        fail(f"graph schema [{name}]", f"{list(err.path)}: {err.message}")
    for g in games:
        for err in Draft202012Validator(game_schema).iter_errors(g):
            fail(f"game schema [{g.get('game_id')}]", f"{list(err.path)}: {err.message}")

    # 1. unique concept ids
    ids = [c["id"] for c in graph["concepts"]]
    if len(ids) != len(set(ids)):
        fail(name, "duplicate concept ids")
    concepts = {c["id"]: c for c in graph["concepts"]}

    # 2. prerequisites resolve, and the graph is acyclic
    for c in graph["concepts"]:
        for p in c["prerequisites"]:
            if p not in concepts:
                fail(name, f"{c['id']} requires unknown concept {p}")

    WHITE, GREY, BLACK = 0, 1, 2
    state = {i: WHITE for i in concepts}

    def visit(n, stack, concepts=concepts, state=state, name=name):
        if state[n] == GREY:
            fail(name, f"prerequisite cycle: {' -> '.join(stack + [n])}")
            return
        if state[n] == BLACK:
            return
        state[n] = GREY
        for p in concepts[n]["prerequisites"]:
            if p in concepts:
                visit(p, stack + [n])
        state[n] = BLACK

    for i in concepts:
        visit(i, [])

    # 3. grounding: a quote that is not in its segment is a hallucination, and
    #    the whole point of source_spans is that it cannot be one
    source_name, segments = segments_for(graph_path)
    if segments is None:
        fail(name, f"no source text: expected fixtures/{source_name}")
    else:
        declared = graph["source"]["segment_count"]
        if declared != len(segments):
            fail(name, f"source.segment_count is {declared} but {source_name} has {len(segments)} segments")
        for c in graph["concepts"]:
            for span in c["source_spans"]:
                sid = span["segment_id"]
                if sid >= len(segments):
                    fail(name, f"{c['id']} cites segment {sid}, past the end of {source_name}")
                elif span["quote"] not in segments[sid]:
                    fail(name, f"{c['id']} quote not found verbatim in segment {sid}: {span['quote'][:60]!r}")

    # 4. every reference in a game resolves back to the graph
    misconceptions = {m["id"] for c in graph["concepts"] for m in c["misconceptions"]}
    for g in games:
        tag = g["game_id"]
        for ch in g["chapters"]:
            for cid in ch["concept_ids"]:
                if cid not in concepts:
                    fail(tag, f"chapter {ch['id']} lists unknown concept {cid}")
            for sc in ch["scenes"]:
                if "concept_id" in sc and sc["concept_id"] not in concepts:
                    fail(tag, f"scene {sc['id']} references unknown concept {sc['concept_id']}")
                for op in sc.get("options", []):
                    mid = op.get("misconception_id")
                    if mid and mid not in misconceptions:
                        fail(tag, f"scene {sc['id']} option {op['id']} references unknown misconception {mid}")
                if sc.get("type") == "prediction":
                    n_correct = sum(1 for op in sc["options"] if op["correct"])
                    if n_correct != 1:
                        fail(tag, f"scene {sc['id']} has {n_correct} correct options, expected exactly 1")

    # 5. chapter order respects prerequisite order
    for g in games:
        seen = set()
        for ch in g["chapters"]:
            for cid in ch["concept_ids"]:
                if cid not in concepts:
                    continue
                for p in concepts[cid]["prerequisites"]:
                    if p not in seen and p not in ch["concept_ids"]:
                        fail(g["game_id"], f"chapter {ch['id']} teaches {cid} before its prerequisite {p}")
            seen.update(ch["concept_ids"])

if errors:
    print(f"FAILED, {len(errors)} problem(s):")
    for e in errors:
        print("  -", e)
    sys.exit(1)

for key, (graph_path, graph) in graphs.items():
    games = bundles[key]
    print(f"OK. graph={key} ({graph_path.name}) concepts={len(graph['concepts'])} games={len(games)}")
    for g in games:
        scenes = sum(len(ch["scenes"]) for ch in g["chapters"])
        print(f"  {g['archetype']:9s} {g['game_id']}  chapters={len(g['chapters'])} scenes={scenes}")
