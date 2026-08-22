"""Pydantic mirrors of schema/course-graph.schema.json and schema/game.schema.json.

These exist so the content types show up in /openapi.json and the FE can
generate TS types from them. They are *mirrors*, not the runtime validator:
cross-file invariants (prerequisites resolve, quotes verify, chapter order)
live in app/services/validators.py. Keep enums and limits identical to the
JSON Schema files; the fixtures round-trip test enforces that.
"""
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

BloomLevel = Literal["remember", "understand", "apply", "analyse", "evaluate", "create"]
Archetype = Literal["quest", "gauntlet"]
Background = Literal["cavern", "forest_path", "ruins", "observatory", "shore", "village"]
Actor = Literal["explorer", "mentor_owl", "rival", "villager"]
Prop = Literal["doorway_pair", "chart_frame", "lantern", "crystal_cluster", "chest", "signpost"]
Widget = Literal["curve_fit", "threshold_slider", "sorting_bins", "graph_walk"]

SLUG_PATTERN = r"^[a-z0-9_]{2,48}$"
ARTIFACT_ID_PATTERN = r"^[a-z0-9]{8,32}$"

Slug = Annotated[str, Field(pattern=SLUG_PATTERN)]
ArtifactId = Annotated[str, Field(pattern=ARTIFACT_ID_PATTERN)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ----------------------------------------------------------------- CourseGraph


class SourceSpan(_Strict):
    segment_id: int = Field(ge=0)
    quote: str = Field(max_length=300)


class Misconception(_Strict):
    id: Slug
    statement: str = Field(max_length=200)
    why_plausible: str = Field(max_length=300)
    correction: str = Field(max_length=300)


class Concept(_Strict):
    id: Slug
    label: str = Field(max_length=80)
    summary: str = Field(max_length=400)
    bloom_level: BloomLevel
    prerequisites: list[Slug] = Field(max_length=8)
    source_spans: list[SourceSpan] = Field(min_length=1, max_length=6)
    misconceptions: list[Misconception] = Field(min_length=1, max_length=4)


class GraphSource(_Strict):
    title: str = Field(max_length=200)
    segment_count: int = Field(ge=1)


class CourseGraph(_Strict):
    schema_version: Literal["1.0"]
    graph_id: ArtifactId
    source: GraphSource
    concepts: list[Concept] = Field(min_length=3, max_length=40)


# ------------------------------------------------------------------------ Game


class Option(_Strict):
    id: Slug
    text: str = Field(max_length=160)
    correct: bool
    misconception_id: str | None = None

    @model_validator(mode="after")
    def _misconception_matches_correctness(self):
        if self.correct and self.misconception_id is not None:
            raise ValueError("a correct option must not carry misconception_id")
        if not self.correct and self.misconception_id is None:
            raise ValueError("an incorrect option requires misconception_id")
        return self


class DialogueScene(_Strict):
    type: Literal["dialogue"]
    id: Slug
    speaker: Actor
    props: list[Prop] | None = Field(default=None, max_length=3)
    lines: list[Annotated[str, Field(max_length=240)]] = Field(min_length=1, max_length=4)


class PredictionScene(_Strict):
    type: Literal["prediction"]
    id: Slug
    concept_id: str
    props: list[Prop] | None = Field(default=None, max_length=3)
    prompt: str = Field(max_length=300)
    options: list[Option] = Field(min_length=3, max_length=4)
    reveal: str = Field(max_length=500)


class SimulationScene(_Strict):
    type: Literal["simulation"]
    id: Slug
    concept_id: str
    widget: Widget
    instruction: str = Field(max_length=240)
    success_condition: str | None = Field(default=None, max_length=200)


Scene = Annotated[
    Union[DialogueScene, PredictionScene, SimulationScene],
    Field(discriminator="type"),
]


class Chapter(_Strict):
    id: Slug
    title: str = Field(max_length=80)
    concept_ids: list[str] = Field(min_length=1)
    background: Background
    scenes: list[Scene] = Field(min_length=1, max_length=8)


class Game(_Strict):
    schema_version: Literal["1.0"]
    game_id: ArtifactId
    graph_id: str
    archetype: Archetype
    title: str = Field(max_length=120)
    chapters: list[Chapter] = Field(min_length=1, max_length=12)
