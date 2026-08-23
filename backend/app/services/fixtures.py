"""Hand-written demo content (fixtures/). Used by the seed and by the
pipeline in fixture mode (empty LLM_API_KEY).

Two bundles now: the machine-learning one the contract was written around, and
a programming-fundamentals one, which is what the pitch opens on and what the
signed-out visitor walks from the login screen.
"""
import copy
import json
from dataclasses import dataclass
from functools import lru_cache

from app.config import get_settings


@dataclass
class DemoContent:
    graph: dict
    quest: dict
    gauntlet: dict
    segments: list[str]
    title: str = "Intro to Machine Learning, Week 3"


@dataclass(frozen=True)
class Bundle:
    """Which files make up one hand-written world."""

    stem: str
    source: str
    title: str


#: Keyed by the name callers ask for. `frontend/src/fixtures/` holds byte-copies
#: of the same JSON -- `scripts/check-fixtures-sync.sh` fails CI otherwise.
BUNDLES: dict[str, Bundle] = {
    "overfitting": Bundle("overfitting", "demo_lecture.txt", "Intro to Machine Learning, Week 3"),
    "pybasics": Bundle("pybasics", "pybasics_lecture.txt", "Programming Fundamentals with Python, Week 1"),
}

DEMO_BUNDLE = "overfitting"


@lru_cache
def _load_raw(name: str) -> DemoContent:
    bundle = BUNDLES[name]
    d = get_settings().fixtures_dir
    read = lambda suffix: json.loads((d / f"{bundle.stem}.{suffix}.json").read_text())  # noqa: E731
    text = (d / bundle.source).read_text().strip()
    segments = [p.strip() for p in text.split("\n\n") if p.strip()]
    return DemoContent(
        graph=read("graph"),
        quest=read("quest"),
        gauntlet=read("gauntlet"),
        segments=segments,
        title=bundle.title,
    )


def load_bundle(name: str) -> DemoContent:
    """A fresh deep copy every call: callers mutate ids freely."""
    return copy.deepcopy(_load_raw(name))


def load_demo() -> DemoContent:
    """The machine-learning bundle, which the generation pipeline falls back to
    in fixture mode. Kept under its old name because that is what the pipeline
    and its tests mean by "the demo content"."""
    return load_bundle(DEMO_BUNDLE)
