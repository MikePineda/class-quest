"""Runtime validator + auto-repair. Each invariant from schema/validate.py gets
a fault-injection test, and autorepair must turn every injected fault back
into a document that validates."""
import copy
import json
import re

import pytest

from app.services import validators as v


def _load(fixtures_dir, name):
    return json.loads((fixtures_dir / name).read_text())


@pytest.fixture
def graph(fixtures_dir):
    return _load(fixtures_dir, "overfitting.graph.json")


@pytest.fixture
def quest(fixtures_dir):
    return _load(fixtures_dir, "overfitting.quest.json")


@pytest.fixture
def gauntlet(fixtures_dir):
    return _load(fixtures_dir, "overfitting.gauntlet.json")


@pytest.fixture
def segments(fixtures_dir):
    text = (fixtures_dir / "demo_lecture.txt").read_text()
    return [p for p in text.strip().split("\n\n") if p.strip()]


def _concept(graph, cid):
    return next(c for c in graph["concepts"] if c["id"] == cid)


def _scene(game, sid):
    return next(s for ch in game["chapters"] for s in ch["scenes"] if s["id"] == sid)


# --------------------------------------------------------------------- happy path


def test_demo_lecture_has_fourteen_segments(segments, graph):
    assert len(segments) == graph["source"]["segment_count"] == 14


def test_fixture_graph_is_valid(graph, segments):
    assert v.validate_graph(graph, segments) == []


def test_fixture_games_are_valid(graph, quest, gauntlet):
    assert v.validate_game(quest, graph) == []
    assert v.validate_game(gauntlet, graph) == []


# ------------------------------------------------------------ graph fault injection


def test_duplicate_concept_id_is_rejected(graph, segments):
    graph["concepts"].append(copy.deepcopy(graph["concepts"][0]))
    assert any("duplicate" in e for e in v.validate_graph(graph, segments))


def test_unknown_prerequisite_is_rejected(graph, segments):
    _concept(graph, "overfitting")["prerequisites"].append("bayes_rule")
    assert any("unknown concept bayes_rule" in e for e in v.validate_graph(graph, segments))


def test_prerequisite_cycle_is_rejected(graph, segments):
    _concept(graph, "training_data")["prerequisites"].append("overfitting")
    assert any("cycle" in e for e in v.validate_graph(graph, segments))


def test_unverifiable_quote_is_rejected(graph, segments):
    _concept(graph, "overfitting")["source_spans"][0]["quote"] = "Penguins are excellent models."
    errs = v.validate_graph(graph, segments)
    assert any("quote" in e and "overfitting" in e for e in errs)


def test_segment_id_out_of_range_is_rejected(graph, segments):
    _concept(graph, "overfitting")["source_spans"][0]["segment_id"] = 99
    assert any("segment_id" in e for e in v.validate_graph(graph, segments))


def test_wrong_segment_count_is_rejected(graph, segments):
    graph["source"]["segment_count"] = 3
    assert any("segment_count" in e for e in v.validate_graph(graph, segments))


def test_schema_violation_is_reported(graph, segments):
    _concept(graph, "overfitting")["bloom_level"] = "memorise"
    assert any("is not one of" in e for e in v.validate_graph(graph, segments))


def test_non_object_graph_is_rejected(segments):
    assert v.validate_graph(["not", "a", "graph"], segments)


# ------------------------------------------------------------- game fault injection


def test_graph_id_mismatch_is_rejected(graph, quest):
    quest["graph_id"] = "deadbeef00"
    assert any("graph_id" in e for e in v.validate_game(quest, graph))


def test_unknown_misconception_is_rejected(graph, quest):
    _scene(quest, "sc_pred_overfit")["options"][0]["misconception_id"] = "ghost"
    assert any("unknown misconception ghost" in e for e in v.validate_game(quest, graph))


def test_unknown_scene_concept_is_rejected(graph, quest):
    _scene(quest, "sc_sim_curve")["concept_id"] = "ghost"
    assert any("unknown concept ghost" in e for e in v.validate_game(quest, graph))


def test_unknown_chapter_concept_is_rejected(graph, quest):
    quest["chapters"][0]["concept_ids"].append("ghost")
    assert any("unknown concept ghost" in e for e in v.validate_game(quest, graph))


def test_two_correct_options_are_rejected(graph, gauntlet):
    _scene(gauntlet, "g_overfit")["options"][2]["correct"] = True
    del _scene(gauntlet, "g_overfit")["options"][2]["misconception_id"]
    assert any("2 correct options" in e for e in v.validate_game(gauntlet, graph))


def test_chapter_before_prerequisite_is_rejected(graph, quest):
    quest["chapters"].reverse()
    assert any("before its prerequisite" in e for e in v.validate_game(quest, graph))


def test_bad_enum_is_rejected(graph, quest):
    quest["chapters"][0]["background"] = "swamp"
    assert any("is not one of" in e for e in v.validate_game(quest, graph))


# ------------------------------------------------------------------- normalisation


def test_normalize_folds_smart_quotes_dashes_and_whitespace():
    fancy = "It’s  a “held-out” set — really…"
    assert v.normalize(fancy) == 'it\'s a "held-out" set - really...'


def test_fuzzy_match_accepts_one_changed_word(graph, segments):
    span = _concept(graph, "generalisation")["source_spans"][0]
    span["quote"] = "Generalisation is the capacity to perform well on previously unseen inputs."
    assert v.validate_graph(graph, segments) == []


def test_fuzzy_match_rejects_unrelated_text(segments):
    assert not v.span_matches("The quick brown fox jumps over the lazy dog.", segments[3])


def test_fuzzy_threshold_is_exposed():
    assert v.FUZZY_THRESHOLD == 0.85


# --------------------------------------------------------------- autorepair graph


def test_autorepair_leaves_a_valid_graph_alone(graph, segments):
    repaired, notes = v.autorepair_graph(graph, segments)
    assert repaired == graph
    assert notes == []


def test_autorepair_dedupes_concept_ids(graph, segments):
    graph["concepts"].append(copy.deepcopy(graph["concepts"][0]))
    repaired, notes = v.autorepair_graph(graph, segments)
    assert v.validate_graph(repaired, segments) == []
    assert len(repaired["concepts"]) == 5
    assert notes


def test_autorepair_drops_unknown_prerequisite(graph, segments):
    _concept(graph, "overfitting")["prerequisites"].append("bayes_rule")
    repaired, _ = v.autorepair_graph(graph, segments)
    assert v.validate_graph(repaired, segments) == []
    assert "bayes_rule" not in _concept(repaired, "overfitting")["prerequisites"]


def test_autorepair_breaks_cycles(graph, segments):
    _concept(graph, "training_data")["prerequisites"].append("overfitting")
    repaired, notes = v.autorepair_graph(graph, segments)
    assert v.validate_graph(repaired, segments) == []
    assert any("cycle" in n for n in notes)


def test_autorepair_drops_concepts_with_no_verifiable_span(graph, segments):
    _concept(graph, "regularisation")["source_spans"][0]["quote"] = "Penguins are excellent."
    repaired, _ = v.autorepair_graph(graph, segments)
    assert v.validate_graph(repaired, segments) == []
    assert [c["id"] for c in repaired["concepts"]] == [
        "training_data", "generalisation", "overfitting", "validation_split",
    ]


def test_autorepair_keeps_only_verified_spans(graph, segments):
    _concept(graph, "overfitting")["source_spans"][1]["quote"] = "Penguins are excellent."
    repaired, _ = v.autorepair_graph(graph, segments)
    assert v.validate_graph(repaired, segments) == []
    assert len(_concept(repaired, "overfitting")["source_spans"]) == 1


def test_autorepair_fixes_segment_count_and_version(graph, segments):
    graph["source"]["segment_count"] = 3
    graph["schema_version"] = "0.9"
    repaired, _ = v.autorepair_graph(graph, segments)
    assert v.validate_graph(repaired, segments) == []
    assert repaired["source"]["segment_count"] == 14
    assert repaired["schema_version"] == "1.0"


def test_autorepair_regenerates_bad_graph_id(graph, segments):
    graph["graph_id"] = "Week 3!"
    repaired, _ = v.autorepair_graph(graph, segments)
    assert v.validate_graph(repaired, segments) == []
    assert re.fullmatch(r"[a-z0-9]{8,32}", repaired["graph_id"])


def test_autorepair_slugifies_ids_and_remaps_references(graph, segments):
    _concept(graph, "training_data")["id"] = "Training Data"
    _concept(graph, "generalisation")["prerequisites"] = ["Training Data"]
    _concept(graph, "overfitting")["prerequisites"] = ["Training Data", "generalisation"]
    _concept(graph, "overfitting")["misconceptions"][0]["id"] = "High-Train High-Test"
    repaired, _ = v.autorepair_graph(graph, segments)
    assert v.validate_graph(repaired, segments) == []
    assert _concept(repaired, "generalisation")["prerequisites"] == ["training_data"]
    assert _concept(repaired, "overfitting")["misconceptions"][0]["id"] == "high_train_high_test"


def test_autorepair_truncates_and_clamps(graph, segments):
    c = _concept(graph, "overfitting")
    c["label"] = "x" * 500
    c["misconceptions"] = c["misconceptions"] * 3  # 6 > max 4
    graph["source"]["title"] = "t" * 300
    repaired, _ = v.autorepair_graph(graph, segments)
    assert v.validate_graph(repaired, segments) == []
    assert len(_concept(repaired, "overfitting")["label"]) == 80
    assert len(_concept(repaired, "overfitting")["misconceptions"]) == 4
    assert len(repaired["source"]["title"]) == 200


def test_autorepair_with_too_few_concepts_still_fails_clearly(graph, segments):
    for c in graph["concepts"][2:]:
        for sp in c["source_spans"]:
            sp["quote"] = "Penguins are excellent."
    repaired, _ = v.autorepair_graph(graph, segments)
    assert len(repaired["concepts"]) == 2
    assert any("concepts" in e for e in v.validate_graph(repaired, segments))


# ---------------------------------------------------------------- autorepair game


def test_autorepair_leaves_a_valid_game_alone(graph, quest, gauntlet):
    for game in (quest, gauntlet):
        repaired, notes = v.autorepair_game(game, graph)
        assert repaired == game
        assert notes == []


def test_autorepair_fixes_ids(graph, quest):
    quest["graph_id"] = "nope"
    quest["game_id"] = "Quest #1"
    quest["chapters"][0]["id"] = "Chapter One"
    repaired, _ = v.autorepair_game(quest, graph)
    assert v.validate_game(repaired, graph) == []
    assert repaired["graph_id"] == graph["graph_id"]
    assert re.fullmatch(r"[a-z0-9]{8,32}", repaired["game_id"])
    assert repaired["chapters"][0]["id"] == "chapter_one"


def test_autorepair_drops_option_with_unknown_misconception(graph, gauntlet):
    _scene(gauntlet, "g_overfit")["options"][0]["misconception_id"] = "ghost"
    repaired, _ = v.autorepair_game(gauntlet, graph)
    assert v.validate_game(repaired, graph) == []
    assert len(_scene(repaired, "g_overfit")["options"]) == 3


def test_autorepair_drops_scene_when_too_few_options_remain(graph, quest):
    _scene(quest, "sc_pred_training")["options"][0]["misconception_id"] = "ghost"
    repaired, _ = v.autorepair_game(quest, graph)
    assert v.validate_game(repaired, graph) == []
    assert all(s["id"] != "sc_pred_training" for ch in repaired["chapters"] for s in ch["scenes"])


def test_autorepair_keeps_first_correct_option(graph, gauntlet):
    _scene(gauntlet, "g_overfit")["options"][2]["correct"] = True
    repaired, _ = v.autorepair_game(gauntlet, graph)
    assert v.validate_game(repaired, graph) == []
    opts = _scene(repaired, "g_overfit")["options"]
    assert [o["id"] for o in opts if o["correct"]] == ["op_worse"]
    assert all("misconception_id" not in o for o in opts if o["correct"])


def test_autorepair_drops_prediction_with_no_correct_option(graph, gauntlet):
    _scene(gauntlet, "g_regularisation")["options"][1]["correct"] = False
    repaired, _ = v.autorepair_game(gauntlet, graph)
    assert v.validate_game(repaired, graph) == []
    assert all(s["id"] != "g_regularisation" for s in repaired["chapters"][0]["scenes"])


def test_autorepair_drops_scene_with_unknown_concept(graph, quest):
    _scene(quest, "sc_sim_curve")["concept_id"] = "ghost"
    repaired, _ = v.autorepair_game(quest, graph)
    assert v.validate_game(repaired, graph) == []
    assert all(s["id"] != "sc_sim_curve" for ch in repaired["chapters"] for s in ch["scenes"])


def test_autorepair_drops_chapter_with_no_scenes(graph, quest):
    quest["chapters"][1]["scenes"] = []
    repaired, _ = v.autorepair_game(quest, graph)
    assert v.validate_game(repaired, graph) == []
    assert [ch["id"] for ch in repaired["chapters"]] == ["ch_foundations"]


def test_autorepair_drops_unknown_chapter_concepts(graph, quest):
    quest["chapters"][0]["concept_ids"].append("ghost")
    repaired, _ = v.autorepair_game(quest, graph)
    assert v.validate_game(repaired, graph) == []
    assert repaired["chapters"][0]["concept_ids"] == ["training_data", "generalisation"]


def test_autorepair_reorders_chapters_by_prerequisites(graph, quest):
    quest["chapters"].reverse()
    repaired, notes = v.autorepair_game(quest, graph)
    assert v.validate_game(repaired, graph) == []
    assert [ch["id"] for ch in repaired["chapters"]] == ["ch_foundations", "ch_overfitting"]
    assert any("order" in n for n in notes)


def test_autorepair_replaces_bad_enum_values(graph, quest):
    quest["chapters"][0]["background"] = "swamp"
    _scene(quest, "sc_open")["speaker"] = "narrator"
    _scene(quest, "sc_open")["props"] = ["lantern", "torch"]
    _scene(quest, "sc_sim_curve")["widget"] = "rocket"
    repaired, _ = v.autorepair_game(quest, graph)
    assert v.validate_game(repaired, graph) == []
    assert repaired["chapters"][0]["background"] == "cavern"
    assert _scene(repaired, "sc_open")["speaker"] == "mentor_owl"
    assert _scene(repaired, "sc_open")["props"] == ["lantern"]
    assert _scene(repaired, "sc_sim_curve")["widget"] == "curve_fit"


def test_autorepair_truncates_strings_and_clamps_lists(graph, quest):
    quest["title"] = "T" * 500
    _scene(quest, "sc_open")["lines"] = ["line"] * 9
    _scene(quest, "sc_pred_overfit")["reveal"] = "r" * 1000
    repaired, _ = v.autorepair_game(quest, graph)
    assert v.validate_game(repaired, graph) == []
    assert len(repaired["title"]) == 120
    assert len(_scene(repaired, "sc_open")["lines"]) == 4
    assert len(_scene(repaired, "sc_pred_overfit")["reveal"]) == 500


# ---------------------------------------------------------------- derive_gauntlet


def test_derive_gauntlet_validates_against_graph(graph, quest):
    g = v.derive_gauntlet(quest, graph)
    assert v.validate_game(g, graph) == []
    assert g["archetype"] == "gauntlet"
    assert g["graph_id"] == graph["graph_id"]
    assert g["game_id"] != quest["game_id"]
    assert g["title"] == "The Archivist's Cavern — Gauntlet"
    (ch,) = g["chapters"]
    assert ch["id"] == "ch_run"
    assert ch["background"] == quest["chapters"][0]["background"]
    assert ch["concept_ids"] == [
        "training_data", "generalisation", "overfitting", "validation_split", "regularisation",
    ]
    assert [s["id"] for s in ch["scenes"]] == ["g_sc_pred_training", "g_sc_pred_overfit"]
    assert all(s["type"] == "prediction" for s in ch["scenes"])


class TestDeriveGauntletSurvivesNulls:
    """derive_gauntlet is the fallback we reach *because* the model output was
    bad, so it is exactly the function that must not add a crash of its own.

    Found in production: a quest whose chapter carried "scenes": null made it
    raise TypeError('NoneType' object is not iterable), which surfaced to the
    user as an opaque failed world. `.get("scenes", [])` does not help — the
    default only applies when the key is missing, not when its value is null.
    """

    def _quest_with(self, quest, **overrides):
        q = copy.deepcopy(quest)
        q["chapters"][0].update(overrides)
        return q

    def test_null_scenes_in_a_chapter(self, graph, quest):
        out = v.derive_gauntlet(self._quest_with(quest, scenes=None), graph)
        assert out["archetype"] == "gauntlet"
        assert out["graph_id"] == graph["graph_id"]

    def test_null_chapters(self, graph, quest):
        q = copy.deepcopy(quest)
        q["chapters"] = None
        out = v.derive_gauntlet(q, graph)
        assert out["chapters"][0]["scenes"] == []

    def test_null_options_on_a_prediction_scene(self, graph, quest):
        q = copy.deepcopy(quest)
        for ch in q["chapters"]:
            for sc in ch["scenes"]:
                if sc["type"] == "prediction":
                    sc["options"] = None
        v.derive_gauntlet(q, graph)  # must not raise

    def test_null_concepts_in_the_graph(self, graph, quest):
        g = copy.deepcopy(graph)
        g["concepts"] = None
        out = v.derive_gauntlet(quest, g)
        assert out["chapters"][0]["concept_ids"] == []

    def test_a_healthy_quest_still_derives_a_valid_gauntlet(self, graph, quest):
        out = v.derive_gauntlet(quest, graph)
        assert v.validate_game(out, graph) == []
