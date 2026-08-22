"""Runtime validation and deterministic auto-repair of LLM-produced content.

Port of schema/validate.py into reusable functions. The model (MiniMax) emits
a CourseGraph and then Games; before anything is persisted we:

  1. autorepair_*  - salvage what can be salvaged without inventing content
                     (slugify ids, drop unverifiable concepts, break cycles,
                     clamp lengths, fix enums, re-sort chapters)
  2. validate_*    - return a list of error strings; empty means valid

Nothing here ever fabricates pedagogical content. If a graph ends up with
fewer than 3 verified concepts the repaired dict is returned anyway and
validate_graph says so; the caller decides whether to retry the model.
"""
import copy
import difflib
import json
import re
import unicodedata
from functools import lru_cache
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import best_match

from app.config import get_settings
from app.ids import artifact_id

FUZZY_THRESHOLD = 0.85
MIN_CONCEPTS = 3

SLUG_RE = re.compile(r"^[a-z0-9_]{2,48}$")
ARTIFACT_ID_RE = re.compile(r"^[a-z0-9]{8,32}$")
SCENE_TYPES = ("dialogue", "prediction", "simulation")

# Typographic characters the model (or a PDF) may emit that NFKC leaves alone.
_FOLD = str.maketrans({
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"',
    "–": "-", "—": "-", "‒": "-", "―": "-", "−": "-",
    "…": "...", " ": " ",
})


# ------------------------------------------------------------------ schemas


@lru_cache
def _schemas() -> tuple[dict, dict]:
    d = get_settings().schema_dir
    graph = json.loads((d / "course-graph.schema.json").read_text())
    game = json.loads((d / "game.schema.json").read_text())
    return graph, game


def graph_schema() -> dict:
    return _schemas()[0]


def game_schema() -> dict:
    return _schemas()[1]


@lru_cache
def _validator(which: str) -> Draft202012Validator:
    return Draft202012Validator(graph_schema() if which == "graph" else game_schema())


def _schema_errors(which: str, doc: Any) -> list[str]:
    out = []
    for err in sorted(_validator(which).iter_errors(doc), key=lambda e: e.json_path):
        # oneOf errors are unreadable; the best sub-error usually names the real problem.
        e = best_match(err.context) if err.context else err
        out.append(f"schema {e.json_path}: {e.message[:200]}")
    return out


def _enum(which: str, name: str) -> list[str]:
    """Enum values by $defs name. `widget` is declared inline on
    simulation_scene rather than as its own $def."""
    schema = graph_schema() if which == "graph" else game_schema()
    defs = schema["$defs"]
    node = defs[name] if name in defs else defs["simulation_scene"]["properties"][name]
    return list(node["enum"])


# ------------------------------------------------------------ text matching


def normalize(text: str) -> str:
    """NFKC, casefold, ASCII-fold typographic quotes/dashes, collapse whitespace."""
    text = unicodedata.normalize("NFKC", text).translate(_FOLD).casefold()
    return " ".join(text.split())


def best_window_ratio(needle: str, haystack: str) -> float:
    """Best SequenceMatcher ratio of `needle` against a sliding window of
    `haystack`. Coarse scan with step len/4, then a fine scan around the best
    coarse hit with windows of len +/- 20 percent."""
    n = len(needle)
    if n == 0 or not haystack:
        return 0.0
    if len(haystack) <= n:
        return difflib.SequenceMatcher(None, needle, haystack).ratio()

    def ratio(start: int, width: int) -> float:
        return difflib.SequenceMatcher(None, needle, haystack[start:start + width]).ratio()

    step = max(1, n // 4)
    coarse_best, coarse_start = 0.0, 0
    for start in range(0, len(haystack) - n + 1, step):
        r = ratio(start, n)
        if r > coarse_best:
            coarse_best, coarse_start = r, start
    if coarse_best >= 1.0:
        return coarse_best

    best = coarse_best
    widths = range(max(1, int(n * 0.8)), int(n * 1.2) + 1, max(1, n // 10))
    for start in range(max(0, coarse_start - step), min(len(haystack), coarse_start + step) + 1):
        for width in widths:
            r = ratio(start, width)
            if r > best:
                best = r
    return best


def span_matches(quote: str, segment: str) -> bool:
    """True when `quote` occurs in `segment` (after normalisation) or is a
    near-verbatim match (best window ratio >= FUZZY_THRESHOLD)."""
    q, s = normalize(quote), normalize(segment)
    if not q:
        return False
    if q in s:
        return True
    return best_window_ratio(q, s) >= FUZZY_THRESHOLD


# ---------------------------------------------------------------- helpers


def _is_str(x: Any) -> bool:
    return isinstance(x, str)


def _concept_list(graph: Any) -> list[dict]:
    if not isinstance(graph, dict) or not isinstance(graph.get("concepts"), list):
        return []
    return [c for c in graph["concepts"] if isinstance(c, dict) and _is_str(c.get("id"))]


def _prereqs(concept: dict) -> list[str]:
    p = concept.get("prerequisites")
    return [x for x in p if _is_str(x)] if isinstance(p, list) else []


def _find_cycles(concepts: dict[str, dict]) -> list[list[str]]:
    """DFS with white/grey/black colouring. Returns each cycle as the path
    [..., n, ..., n] so the caller can name it or cut the back-edge."""
    WHITE, GREY, BLACK = 0, 1, 2
    state = {cid: WHITE for cid in concepts}
    cycles: list[list[str]] = []

    def visit(n: str, stack: list[str]) -> None:
        if state[n] == GREY:
            cycles.append(stack[stack.index(n):] + [n])
            return
        if state[n] == BLACK:
            return
        state[n] = GREY
        for p in _prereqs(concepts[n]):
            if p in concepts:
                visit(p, stack + [n])
        state[n] = BLACK

    for cid in concepts:
        visit(cid, [])
    return cycles


def _depths(concepts: dict[str, dict]) -> dict[str, int]:
    """Longest prerequisite chain below each concept. Cycle-safe (a cycle
    counts as depth 0 for the node that closes it)."""
    memo: dict[str, int] = {}
    visiting: set[str] = set()

    def depth(cid: str) -> int:
        if cid in memo:
            return memo[cid]
        if cid in visiting:
            return 0
        visiting.add(cid)
        ps = [p for p in _prereqs(concepts[cid]) if p in concepts]
        d = 1 + max((depth(p) for p in ps), default=-1)
        visiting.discard(cid)
        memo[cid] = d
        return d

    return {cid: depth(cid) for cid in concepts}


def topological_order(graph: dict) -> list[str]:
    """Concept ids sorted by prerequisite depth, stable on document order."""
    concepts = {c["id"]: c for c in _concept_list(graph)}
    depths = _depths(concepts)
    return sorted(concepts, key=lambda cid: depths[cid])


def slugify(value: Any, fallback: str = "item") -> str:
    """Deterministic ^[a-z0-9_]{2,48}$ slug. Idempotent on valid slugs."""
    s = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
    s = re.sub(r"_+", "_", s)
    if len(s) < 2:
        s = f"{fallback}_{s}".strip("_") if s else fallback
    return s[:48]


def _unique_slug(value: Any, taken: set[str], fallback: str = "item") -> str:
    base = slugify(value, fallback)
    slug, n = base, 2
    while slug in taken:
        suffix = f"_{n}"
        slug = base[: 48 - len(suffix)] + suffix
        n += 1
    taken.add(slug)
    return slug


def _resolve_ref(ref: str, root: dict) -> dict:
    node: Any = root
    for part in ref.lstrip("#/").split("/"):
        node = node[part]
    return node


def _clamp_to_schema(data: Any, node: dict, root: dict) -> Any:
    """Walk data alongside its schema: truncate strings to maxLength and lists
    to maxItems. Never adds or removes keys; never changes types."""
    if "$ref" in node:
        node = _resolve_ref(node["$ref"], root)
    if "oneOf" in node and isinstance(data, dict):
        branches = [b if "$ref" not in b else _resolve_ref(b["$ref"], root) for b in node["oneOf"]]
        node = next(
            (b for b in branches
             if b.get("properties", {}).get("type", {}).get("const") == data.get("type")),
            branches[0],
        )
    if isinstance(data, str):
        limit = node.get("maxLength")
        return data[:limit] if limit is not None and len(data) > limit else data
    if isinstance(data, list):
        limit = node.get("maxItems")
        if limit is not None and len(data) > limit:
            data = data[:limit]
        items = node.get("items")
        return [_clamp_to_schema(x, items, root) for x in data] if items else data
    if isinstance(data, dict):
        props = node.get("properties", {})
        return {k: (_clamp_to_schema(v, props[k], root) if k in props else v)
                for k, v in data.items()}
    return data


# ------------------------------------------------------------- validate


def validate_graph(graph: Any, segments: list[str]) -> list[str]:
    """All the reasons `graph` is not a usable CourseGraph. Empty means valid."""
    if not isinstance(graph, dict):
        return ["graph is not a JSON object"]
    errors = _schema_errors("graph", graph)

    concept_list = _concept_list(graph)
    if len(concept_list) < MIN_CONCEPTS:
        errors.append(f"graph has {len(concept_list)} concepts, need at least {MIN_CONCEPTS}")

    ids = [c["id"] for c in concept_list]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        errors.append(f"duplicate concept id: {dup}")
    concepts = {c["id"]: c for c in concept_list}

    for c in concept_list:
        for p in _prereqs(c):
            if p not in concepts:
                errors.append(f"{c['id']} requires unknown concept {p}")
    for cycle in _find_cycles(concepts):
        errors.append(f"prerequisite cycle: {' -> '.join(cycle)}")

    n_seg = len(segments)
    source = graph.get("source")
    if isinstance(source, dict) and source.get("segment_count") != n_seg:
        errors.append(f"source.segment_count is {source.get('segment_count')}, expected {n_seg}")
    for c in concept_list:
        spans = c.get("source_spans")
        if not isinstance(spans, list):
            continue
        for i, sp in enumerate(spans):
            if not isinstance(sp, dict):
                continue
            sid, quote = sp.get("segment_id"), sp.get("quote")
            if not isinstance(sid, int) or isinstance(sid, bool) or not 0 <= sid < n_seg:
                errors.append(
                    f"concept {c['id']} span {i}: segment_id {sid!r} out of range ({n_seg} segments)"
                )
                continue
            if not _is_str(quote) or not span_matches(quote, segments[sid]):
                errors.append(f"concept {c['id']} span {i}: quote not found in segment {sid}")
    return errors


def validate_game(game: Any, graph: Any) -> list[str]:
    """All the reasons `game` is not a playable Game over `graph`."""
    if not isinstance(game, dict):
        return ["game is not a JSON object"]
    errors = _schema_errors("game", game)

    concepts = {c["id"]: c for c in _concept_list(graph)}
    misconceptions = {
        m["id"] for c in concepts.values()
        if isinstance(c.get("misconceptions"), list)
        for m in c["misconceptions"] if isinstance(m, dict) and _is_str(m.get("id"))
    }
    graph_id = graph.get("graph_id") if isinstance(graph, dict) else None
    if game.get("graph_id") != graph_id:
        errors.append(f"graph_id {game.get('graph_id')!r} does not match graph {graph_id!r}")

    chapters = [ch for ch in game.get("chapters", []) if isinstance(ch, dict)] \
        if isinstance(game.get("chapters"), list) else []
    for ch in chapters:
        tag = f"chapter {ch.get('id')}"
        for cid in ch.get("concept_ids", []) if isinstance(ch.get("concept_ids"), list) else []:
            if cid not in concepts:
                errors.append(f"{tag} lists unknown concept {cid}")
        scenes = ch.get("scenes") if isinstance(ch.get("scenes"), list) else []
        for sc in scenes:
            if not isinstance(sc, dict):
                continue
            stag = f"scene {sc.get('id')}"
            if "concept_id" in sc and sc["concept_id"] not in concepts:
                errors.append(f"{stag} references unknown concept {sc['concept_id']}")
            options = sc.get("options") if isinstance(sc.get("options"), list) else []
            for op in options:
                if not isinstance(op, dict):
                    continue
                mid = op.get("misconception_id")
                if mid is not None and mid not in misconceptions:
                    errors.append(
                        f"{stag} option {op.get('id')} references unknown misconception {mid}"
                    )
            if sc.get("type") == "prediction":
                n_correct = sum(1 for op in options if isinstance(op, dict) and op.get("correct") is True)
                if n_correct != 1:
                    errors.append(f"{stag} has {n_correct} correct options, expected exactly 1")

    seen: set[str] = set()
    for ch in chapters:
        cids = [c for c in ch.get("concept_ids", []) if c in concepts] \
            if isinstance(ch.get("concept_ids"), list) else []
        for cid in cids:
            for p in _prereqs(concepts[cid]):
                if p not in seen and p not in cids:
                    errors.append(
                        f"chapter {ch.get('id')} teaches {cid} before its prerequisite {p}"
                    )
        seen.update(cids)
    return errors


# ------------------------------------------------------------ autorepair


def autorepair_graph(graph: Any, segments: list[str]) -> tuple[dict, list[str]]:
    """Deterministic salvage of a model-produced CourseGraph. Returns
    (repaired, notes). Never invents concepts, spans or misconceptions."""
    notes: list[str] = []
    g = copy.deepcopy(graph) if isinstance(graph, dict) else {}

    if g.get("schema_version") != "1.0":
        g["schema_version"] = "1.0"
        notes.append("set schema_version to 1.0")
    if not _is_str(g.get("graph_id")) or not ARTIFACT_ID_RE.match(g["graph_id"]):
        g["graph_id"] = artifact_id()
        notes.append(f"regenerated graph_id -> {g['graph_id']}")
    source = g.get("source") if isinstance(g.get("source"), dict) else {}
    if not _is_str(source.get("title")):
        source["title"] = "Untitled"
        notes.append("source.title missing; set to 'Untitled'")
    if source.get("segment_count") != len(segments):
        source["segment_count"] = len(segments)
        notes.append(f"set source.segment_count = {len(segments)}")
    g["source"] = source

    raw = g.get("concepts") if isinstance(g.get("concepts"), list) else []
    concepts = [c for c in raw if isinstance(c, dict)]
    if len(concepts) != len(raw):
        notes.append(f"dropped {len(raw) - len(concepts)} non-object concept entries")

    # 1. slugify concept ids, remembering the remap for prerequisites
    id_map: dict[str, str] = {}
    for c in concepts:
        old = c.get("id")
        if _is_str(old) and SLUG_RE.match(old):
            continue
        new = slugify(old if old is not None else c.get("label", ""), "concept")
        id_map[str(old)] = new
        c["id"] = new
        notes.append(f"slugified concept id {old!r} -> {new}")

    # 2. dedupe ids (keep first)
    seen_ids: set[str] = set()
    deduped = []
    for c in concepts:
        if c["id"] in seen_ids:
            notes.append(f"dropped duplicate concept {c['id']}")
            continue
        seen_ids.add(c["id"])
        deduped.append(c)
    concepts = deduped

    # 3. spans: keep verified ones only; drop concepts with none. Misconceptions:
    #    slugify ids, drop concepts with none.
    survivors = []
    mis_taken: set[str] = set()
    for c in concepts:
        spans = c.get("source_spans") if isinstance(c.get("source_spans"), list) else []
        kept = []
        for sp in spans:
            if not isinstance(sp, dict):
                continue
            sid, quote = sp.get("segment_id"), sp.get("quote")
            ok = (isinstance(sid, int) and not isinstance(sid, bool)
                  and 0 <= sid < len(segments) and _is_str(quote)
                  and span_matches(quote, segments[sid]))
            if ok:
                kept.append({"segment_id": sid, "quote": quote})
        if len(kept) < len(spans):
            notes.append(f"concept {c['id']}: dropped {len(spans) - len(kept)} unverifiable span(s)")
        if not kept:
            notes.append(f"dropped concept {c['id']}: no verifiable source span")
            continue
        c["source_spans"] = kept

        mis = [m for m in (c.get("misconceptions") or []) if isinstance(m, dict)] \
            if isinstance(c.get("misconceptions"), list) else []
        if not mis:
            notes.append(f"dropped concept {c['id']}: no misconceptions")
            continue
        for m in mis:
            old = m.get("id")
            if _is_str(old) and SLUG_RE.match(old) and old not in mis_taken:
                mis_taken.add(old)
                continue
            m["id"] = _unique_slug(old if old is not None else m.get("statement", ""),
                                   mis_taken, "misconception")
            notes.append(f"concept {c['id']}: slugified misconception id {old!r} -> {m['id']}")
        c["misconceptions"] = mis
        survivors.append(c)
    concepts = survivors

    # 4. prerequisites: remap, drop unknown/self/duplicates
    known = {c["id"] for c in concepts}
    for c in concepts:
        out: list[str] = []
        for p in _prereqs(c):
            p = id_map.get(p, p)
            if p == c["id"] or p not in known:
                notes.append(f"concept {c['id']}: dropped prerequisite {p!r}")
                continue
            if p not in out:
                out.append(p)
        if not isinstance(c.get("prerequisites"), list):
            notes.append(f"concept {c['id']}: prerequisites missing; set to []")
        c["prerequisites"] = out

    # 5. break cycles by cutting the back-edge DFS found (repeat until acyclic)
    by_id = {c["id"]: c for c in concepts}
    for _ in range(len(concepts) + 1):
        cycles = _find_cycles(by_id)
        if not cycles:
            break
        path = cycles[0]
        tail, head = path[-2], path[-1]  # the edge that closed the cycle
        by_id[tail]["prerequisites"].remove(head)
        notes.append(f"broke prerequisite cycle {' -> '.join(path)} by dropping {tail} -> {head}")

    g["concepts"] = concepts
    # 6. string/list limits from the schema (maxLength / maxItems)
    clamped = _clamp_to_schema(g, graph_schema(), graph_schema())
    if clamped != g:
        notes.append("truncated over-long strings/lists to schema limits")
    return clamped, notes


def _fix_enum(value: Any, allowed: list[str], what: str, notes: list[str],
              default: str | None = None) -> str:
    """Return `value` if it is in the enum, else `default` (or the enum's first value)."""
    if value in allowed:
        return value
    fallback = default if default in allowed else allowed[0]
    notes.append(f"{what}: replaced invalid value {value!r} with {fallback}")
    return fallback


def _fix_props(scene: dict, allowed: list[str], notes: list[str]) -> None:
    if "props" not in scene:
        return
    props = scene["props"] if isinstance(scene["props"], list) else []
    kept = [p for p in props if p in allowed]
    if len(kept) != len(props):
        notes.append(f"scene {scene.get('id')}: dropped invalid props")
    scene["props"] = kept


def _repair_scene(sc: Any, known: set[str], misconceptions: set[str],
                  taken: set[str], notes: list[str]) -> dict | None:
    """Return the repaired scene or None when it has to be dropped."""
    if not isinstance(sc, dict) or sc.get("type") not in SCENE_TYPES:
        notes.append(f"dropped scene with unknown type {getattr(sc, 'get', lambda _: None)('type')!r}")
        return None
    old = sc.get("id")
    if not _is_str(old) or not SLUG_RE.match(old) or old in taken:
        sc["id"] = _unique_slug(old if old is not None else "scene", taken, "scene")
        notes.append(f"slugified scene id {old!r} -> {sc['id']}")
    else:
        taken.add(old)
    tag = f"scene {sc['id']}"
    _fix_props(sc, _enum("game", "prop"), notes)

    if sc["type"] == "dialogue":
        # The mentor is the server mascot that asks the questions: the safe default.
        sc["speaker"] = _fix_enum(sc.get("speaker"), _enum("game", "actor"),
                                  f"{tag} speaker", notes, default="mentor_owl")
        lines = [ln for ln in sc.get("lines", []) if _is_str(ln)] \
            if isinstance(sc.get("lines"), list) else []
        if not lines:
            notes.append(f"dropped {tag}: no lines")
            return None
        sc["lines"] = lines
        return sc

    if sc.get("concept_id") not in known:
        notes.append(f"dropped {tag}: unknown concept {sc.get('concept_id')!r}")
        return None

    if sc["type"] == "simulation":
        sc["widget"] = _fix_enum(sc.get("widget"), _enum("game", "widget"), f"{tag} widget", notes)
        return sc

    # prediction
    options = [op for op in sc.get("options", []) if isinstance(op, dict)] \
        if isinstance(sc.get("options"), list) else []
    op_taken: set[str] = set()
    kept: list[dict] = []
    for op in options:
        oid = op.get("id")
        if not _is_str(oid) or not SLUG_RE.match(oid) or oid in op_taken:
            op["id"] = _unique_slug(oid if oid is not None else "op", op_taken, "op")
            notes.append(f"{tag}: slugified option id {oid!r} -> {op['id']}")
        else:
            op_taken.add(oid)
        if not isinstance(op.get("correct"), bool):
            op["correct"] = bool(op.get("correct"))
        if op["correct"]:
            if "misconception_id" in op:
                op.pop("misconception_id")
                notes.append(f"{tag}: removed misconception_id from correct option {op['id']}")
        elif op.get("misconception_id") not in misconceptions:
            notes.append(f"{tag}: dropped option {op['id']} (misconception "
                         f"{op.get('misconception_id')!r} unknown)")
            continue
        kept.append(op)
    correct = [op for op in kept if op["correct"]]
    if not correct:
        notes.append(f"dropped {tag}: no correct option")
        return None
    if len(correct) > 1:
        first = correct[0]
        kept = [op for op in kept if not op["correct"] or op is first]
        notes.append(f"{tag}: kept first correct option {first['id']}, dropped {len(correct) - 1}")
    if len(kept) > 4:  # keep the correct one plus the first three distractors
        first = next(op for op in kept if op["correct"])
        kept = [first] + [op for op in kept if op is not first][:3]
        kept.sort(key=options.index)
        notes.append(f"{tag}: clamped options to 4")
    if len(kept) < 3:
        notes.append(f"dropped {tag}: only {len(kept)} option(s) left")
        return None
    sc["options"] = kept
    return sc


def autorepair_game(game: Any, graph: dict) -> tuple[dict, list[str]]:
    """Deterministic salvage of a model-produced Game against a valid graph."""
    notes: list[str] = []
    g = copy.deepcopy(game) if isinstance(game, dict) else {}
    concepts = {c["id"]: c for c in _concept_list(graph)}
    known = set(concepts)
    misconceptions = {
        m["id"] for c in concepts.values()
        if isinstance(c.get("misconceptions"), list)
        for m in c["misconceptions"] if isinstance(m, dict) and _is_str(m.get("id"))
    }

    if g.get("schema_version") != "1.0":
        g["schema_version"] = "1.0"
        notes.append("set schema_version to 1.0")
    if not _is_str(g.get("game_id")) or not ARTIFACT_ID_RE.match(g["game_id"]):
        g["game_id"] = artifact_id()
        notes.append(f"regenerated game_id -> {g['game_id']}")
    if g.get("graph_id") != graph.get("graph_id"):
        g["graph_id"] = graph.get("graph_id")
        notes.append(f"set graph_id = {g['graph_id']}")
    if not _is_str(g.get("title")):
        g["title"] = "Untitled"
        notes.append("title missing; set to 'Untitled'")

    raw = g.get("chapters") if isinstance(g.get("chapters"), list) else []
    chapters: list[dict] = []
    ch_taken: set[str] = set()
    sc_taken: set[str] = set()
    for ch in raw:
        if not isinstance(ch, dict):
            notes.append("dropped non-object chapter")
            continue
        old = ch.get("id")
        if not _is_str(old) or not SLUG_RE.match(old) or old in ch_taken:
            ch["id"] = _unique_slug(old if old is not None else "chapter", ch_taken, "chapter")
            notes.append(f"slugified chapter id {old!r} -> {ch['id']}")
        else:
            ch_taken.add(old)
        tag = f"chapter {ch['id']}"
        if not _is_str(ch.get("title")):
            ch["title"] = ch["id"].replace("_", " ").title()
        ch["background"] = _fix_enum(ch.get("background"), _enum("game", "background"),
                                     f"{tag} background", notes)

        scenes = [s for s in (
            _repair_scene(sc, known, misconceptions, sc_taken, notes)
            for sc in (ch.get("scenes") if isinstance(ch.get("scenes"), list) else [])
        ) if s is not None]
        if not scenes:
            notes.append(f"dropped {tag}: no scenes")
            continue
        ch["scenes"] = scenes

        cids_raw = ch.get("concept_ids") if isinstance(ch.get("concept_ids"), list) else []
        cids = [c for c in cids_raw if c in known]
        cids = list(dict.fromkeys(cids))
        if len(cids) != len(cids_raw):
            notes.append(f"{tag}: dropped unknown/duplicate concept_ids")
        if not cids:
            cids = list(dict.fromkeys(s["concept_id"] for s in scenes if "concept_id" in s))
            notes.append(f"{tag}: concept_ids derived from scenes")
        if not cids:
            notes.append(f"dropped {tag}: no concepts")
            continue
        ch["concept_ids"] = cids
        chapters.append(ch)

    # topological re-sort by max prerequisite depth, stable on document order
    depths = _depths(concepts)
    ordered = sorted(chapters, key=lambda ch: max(depths[c] for c in ch["concept_ids"]))
    if ordered != chapters:
        notes.append("re-sorted chapters into prerequisite order")
    chapters = ordered

    # prerequisites that no earlier chapter teaches: pull them into this chapter
    seen: set[str] = set()
    for ch in chapters:
        cids = list(ch["concept_ids"])
        i = 0
        while i < len(cids):
            for p in _prereqs(concepts[cids[i]]):
                if p in known and p not in seen and p not in cids:
                    cids.append(p)
                    notes.append(f"chapter {ch['id']}: added untaught prerequisite {p}")
            i += 1
        ch["concept_ids"] = sorted(cids, key=lambda c: depths[c])
        seen.update(cids)

    g["chapters"] = chapters
    clamped = _clamp_to_schema(g, game_schema(), game_schema())
    if clamped != g:
        notes.append("truncated over-long strings/lists to schema limits")
    return clamped, notes


# --------------------------------------------------------- derive_gauntlet


def derive_gauntlet(quest: dict, graph: dict) -> dict:
    """Deterministic fallback Gauntlet: one timed chapter over every
    prediction scene of the quest, in quest order, covering the whole graph."""
    chapters = quest.get("chapters") if isinstance(quest.get("chapters"), list) else []
    scenes = []
    for ch in chapters:
        for sc in ch.get("scenes", []) if isinstance(ch, dict) else []:
            if isinstance(sc, dict) and sc.get("type") == "prediction":
                s = copy.deepcopy(sc)
                s["id"] = f"g_{s.get('id', '')}"[:48]
                scenes.append(s)
    background = chapters[0].get("background") if chapters and isinstance(chapters[0], dict) \
        else None
    game = {
        "schema_version": "1.0",
        "game_id": artifact_id(),
        "graph_id": graph.get("graph_id"),
        "archetype": "gauntlet",
        "title": f"{quest.get('title', 'Quest')} — Gauntlet"[:120],
        "chapters": [{
            "id": "ch_run",
            "title": "Timed Run",
            "concept_ids": topological_order(graph),
            "background": background if background in _enum("game", "background") else "cavern",
            "scenes": scenes[:8],
        }],
    }
    return game
