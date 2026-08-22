"""Hand-written demo content (fixtures/). Used by the seed and by the
pipeline in fixture mode (empty LLM_API_KEY)."""
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


@lru_cache
def _load_raw() -> DemoContent:
    d = get_settings().fixtures_dir
    read = lambda name: json.loads((d / name).read_text())  # noqa: E731
    text = (d / "demo_lecture.txt").read_text().strip()
    segments = [p.strip() for p in text.split("\n\n") if p.strip()]
    return DemoContent(
        graph=read("overfitting.graph.json"),
        quest=read("overfitting.quest.json"),
        gauntlet=read("overfitting.gauntlet.json"),
        segments=segments,
    )


def load_demo() -> DemoContent:
    """A fresh deep copy every call: callers mutate ids freely."""
    return copy.deepcopy(_load_raw())
