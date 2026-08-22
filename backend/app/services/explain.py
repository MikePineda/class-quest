"""Explain-to-Win grader: score a learner's free-text explanation of one
concept against that concept's summary and misconceptions.

`grade_explanation` calls the model (one retry on transport/format failure,
then `GraderUnavailable`) and always recomputes the verdict from the
clamped score via `scoring.verdict_for` — the model's own verdict is
advisory only. In fixture mode (empty LLM_API_KEY) `fixture_grade` gives a
deterministic keyword-overlap grade instead, which is also what CI exercises
end to end.
"""
import re

from app.config import get_settings
from app.services import llm, prompts, scoring

settings = get_settings()

_FEEDBACK_LIMIT = 600


class GraderUnavailable(Exception):
    """The model could not grade this explanation (transport/format failure
    on both the first attempt and the retry)."""


# ------------------------------------------------------------------ model


def _default_feedback(verdict: str) -> str:
    if verdict == "pass":
        return "Solid explanation — it captures the mechanism, not just the vocabulary."
    if verdict == "partial":
        return "You are partway there; say more about how it actually happens."
    return "This does not yet explain the concept; try again with more detail on the mechanism."


def _normalize_grade(concept: dict, raw: dict) -> dict:
    score = scoring.clamp_score(raw.get("score") if isinstance(raw, dict) else None)
    verdict = scoring.verdict_for(score)

    known_ids = {
        m.get("id") for m in (concept.get("misconceptions") or [])
        if isinstance(m, dict)
    }
    mid = raw.get("misconception_id") if isinstance(raw, dict) else None
    if not isinstance(mid, str) or mid not in known_ids:
        mid = None

    feedback = raw.get("feedback") if isinstance(raw, dict) else None
    if not isinstance(feedback, str) or not feedback.strip():
        feedback = _default_feedback(verdict)
    feedback = feedback[:_FEEDBACK_LIMIT]

    return {"score": score, "verdict": verdict, "feedback": feedback, "misconception_id": mid}


def grade_explanation(concept: dict, text: str) -> dict:
    system, user = prompts.explain_prompt(concept, text)
    last_error: Exception | None = None
    for _attempt in range(2):
        try:
            raw = llm.call_json(
                system, user, max_tokens=1000, temperature=0.1,
                timeout=settings.llm_explain_timeout_s,
            )
        except llm.FixtureMode:
            return fixture_grade(concept, text)
        except (llm.LLMError, llm.LLMFormatError) as e:
            last_error = e
            continue
        return _normalize_grade(concept, raw)
    raise GraderUnavailable(str(last_error))


# ---------------------------------------------------------------- fixture


_STOPWORDS = {
    "that", "this", "with", "from", "have", "which", "when", "while", "then", "than",
    "them", "their", "there", "these", "those", "been", "were", "being", "into", "onto",
    "also", "such", "only", "just", "some", "more", "most", "much", "many", "very",
    "about", "after", "before", "because", "without", "within", "over", "under",
    "here", "where", "what", "your", "each", "between", "during", "through", "again",
    "same", "other", "does", "doing", "having", "itself", "should", "would",
    "could", "might", "must", "shall", "will", "upon", "among",
}
_SHORT_TEXT_LIMIT = 20
_WORD_RE = re.compile(r"[a-zA-Z]+")


def _tokenize(text: str) -> list[str]:
    return _WORD_RE.findall(text.lower())


def _content_words(text: str) -> list[str]:
    """Unique words (first-occurrence order), length >= 4, minus stopwords."""
    seen: list[str] = []
    for w in _tokenize(text):
        if len(w) >= 4 and w not in _STOPWORDS and w not in seen:
            seen.append(w)
    return seen


def _fixture_feedback(matched: list[str], missing: list[str]) -> str:
    if matched and missing:
        return f"You correctly touched on {matched[0]}, but say more about {missing[0]}."
    if matched:
        return f"Good — you covered {matched[0]} and the rest of the key ideas."
    if missing:
        return f"Try to mention {missing[0]} and connect it to the mechanism."
    return "Say more about the concept in your own words."


def fixture_grade(concept: dict, text: str) -> dict:
    """Deterministic keyword-overlap grader used when no LLM is configured."""
    if len(text) < _SHORT_TEXT_LIMIT:
        return {"score": 0, "verdict": "fail", "feedback": "That is too short to grade; try again with a full sentence.",
                "misconception_id": None}

    learner_tokens = set(_tokenize(text))
    label = concept.get("label", "")
    summary = concept.get("summary", "")
    summary_words = _content_words(f"{label} {summary}")
    matched = [w for w in summary_words if w in learner_tokens]
    missing = [w for w in summary_words if w not in learner_tokens]
    coverage = len(matched) / len(summary_words) if summary_words else 0.0
    raw_score = scoring.clamp_score(coverage * 140)

    best_mis_id: str | None = None
    best_mis_matches = 0
    for m in concept.get("misconceptions") or []:
        if not isinstance(m, dict):
            continue
        mis_words = _content_words(m.get("statement", ""))
        mis_matched = sum(1 for w in mis_words if w in learner_tokens)
        if mis_matched >= 2 and mis_matched > len(matched) and mis_matched > best_mis_matches:
            best_mis_matches = mis_matched
            best_mis_id = m.get("id")

    if best_mis_id is not None:
        score = min(raw_score, 35)
        misconception_id: str | None = best_mis_id
    else:
        score = raw_score
        misconception_id = None

    verdict = scoring.verdict_for(score)
    feedback = _fixture_feedback(matched, missing)
    return {"score": score, "verdict": verdict, "feedback": feedback, "misconception_id": misconception_id}
