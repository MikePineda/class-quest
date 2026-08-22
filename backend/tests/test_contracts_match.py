"""app/contracts.py mirrors schema/*.schema.json. The fixtures are the
ground truth: every one of them must round-trip byte-faithfully."""
import json

import pytest
from pydantic import ValidationError

from app.contracts import CourseGraph, Game, Option


def _load(fixtures_dir, name):
    return json.loads((fixtures_dir / name).read_text())


def test_graph_fixture_round_trips(fixtures_dir):
    raw = _load(fixtures_dir, "overfitting.graph.json")
    assert CourseGraph.model_validate(raw).model_dump(exclude_none=True) == raw


@pytest.mark.parametrize("name", ["overfitting.quest.json", "overfitting.gauntlet.json"])
def test_game_fixtures_round_trip(fixtures_dir, name):
    raw = _load(fixtures_dir, name)
    assert Game.model_validate(raw).model_dump(exclude_none=True) == raw


def test_incorrect_option_requires_misconception_id():
    with pytest.raises(ValidationError):
        Option.model_validate({"id": "op_x", "text": "nope", "correct": False})


def test_correct_option_must_not_carry_misconception_id():
    with pytest.raises(ValidationError):
        Option.model_validate(
            {"id": "op_x", "text": "yes", "correct": True, "misconception_id": "m1"}
        )


def test_extra_properties_are_forbidden(fixtures_dir):
    raw = _load(fixtures_dir, "overfitting.graph.json")
    raw["concepts"][0]["colour"] = "red"
    with pytest.raises(ValidationError):
        CourseGraph.model_validate(raw)


def test_scene_union_discriminates_on_type(fixtures_dir):
    raw = _load(fixtures_dir, "overfitting.quest.json")
    raw["chapters"][0]["scenes"][0]["type"] = "cutscene"
    with pytest.raises(ValidationError):
        Game.model_validate(raw)


def test_json_schema_exposes_archetype_enum():
    schema = Game.model_json_schema()
    assert schema["properties"]["archetype"]["enum"] == ["quest", "gauntlet"]
