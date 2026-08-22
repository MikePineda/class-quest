#!/usr/bin/env python3
"""Validate ClassQuest fixtures against the schemas.

Run from the repo root:  python3 schema/validate.py

Checks the JSON Schema contract plus the four cross-file invariants a schema
cannot express on its own:
  1. concept ids are unique
  2. prerequisites resolve and contain no cycles
  3. every scene concept_id and option misconception_id resolves in the graph
  4. chapter order respects prerequisite order
"""
import json, sys, glob
from pathlib import Path
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parent.parent
errors = []


def fail(where, msg):
    errors.append(f"{where}: {msg}")


def load(p):
    return json.loads(Path(p).read_text())


graph_schema = load(ROOT / "schema/course-graph.schema.json")
game_schema = load(ROOT / "schema/game.schema.json")

graph = load(ROOT / "fixtures/overfitting.graph.json")
games = [load(p) for p in sorted(glob.glob(str(ROOT / "fixtures/*.quest.json")))
         + sorted(glob.glob(str(ROOT / "fixtures/*.gauntlet.json")))]

# 0. schema conformance
for err in Draft202012Validator(graph_schema).iter_errors(graph):
    fail("graph schema", f"{list(err.path)}: {err.message}")
for g in games:
    for err in Draft202012Validator(game_schema).iter_errors(g):
        fail(f"game schema [{g.get('game_id')}]", f"{list(err.path)}: {err.message}")

# 1. unique concept ids
ids = [c["id"] for c in graph["concepts"]]
if len(ids) != len(set(ids)):
    fail("graph", "duplicate concept ids")
concepts = {c["id"]: c for c in graph["concepts"]}

# 2. prerequisites resolve, and the graph is acyclic
for c in graph["concepts"]:
    for p in c["prerequisites"]:
        if p not in concepts:
            fail("graph", f"{c['id']} requires unknown concept {p}")

WHITE, GREY, BLACK = 0, 1, 2
state = {i: WHITE for i in concepts}


def visit(n, stack):
    if state[n] == GREY:
        fail("graph", f"prerequisite cycle: {' -> '.join(stack + [n])}")
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

# 3. every reference in a game resolves back to the graph
misconceptions = {m["id"] for c in graph["concepts"] for m in c["misconceptions"]}
for g in games:
    tag = g["game_id"]
    if g["graph_id"] != graph["graph_id"]:
        fail(tag, f"graph_id {g['graph_id']} does not match graph {graph['graph_id']}")
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

# 4. chapter order respects prerequisite order
for g in games:
    seen = set()
    for ch in g["chapters"]:
        for cid in ch["concept_ids"]:
            for p in concepts[cid]["prerequisites"]:
                if p not in seen and p not in ch["concept_ids"]:
                    fail(g["game_id"], f"chapter {ch['id']} teaches {cid} before its prerequisite {p}")
        seen.update(ch["concept_ids"])

if errors:
    print(f"FAILED, {len(errors)} problem(s):")
    for e in errors:
        print("  -", e)
    sys.exit(1)

print(f"OK. graph={graph['graph_id']} concepts={len(graph['concepts'])} games={len(games)}")
for g in games:
    scenes = sum(len(ch["scenes"]) for ch in g["chapters"])
    print(f"  {g['archetype']:9s} {g['game_id']}  chapters={len(g['chapters'])} scenes={scenes}")
