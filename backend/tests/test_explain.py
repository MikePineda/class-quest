"""Explain-to-Win grader. The model is replaced with a fake patched onto
`app.services.explain.llm.call_json`; fixture mode is the real path under tests
because LLM_API_KEY is empty."""
import pytest

from app.services import explain, fixtures, llm, scoring


@pytest.fixture
def concept():
    demo = fixtures.load_demo()
    return next(c for c in demo.graph["concepts"] if c["id"] == "overfitting")


@pytest.fixture
def llm_on(monkeypatch):
    # grade_explanation must not short-circuit into fixture mode in these tests
    monkeypatch.setattr(llm.settings, "llm_api_key", "test-key")


def _install(monkeypatch, *responses):
    calls = []
    queue = list(responses)

    def fake(system, user, **kw):
        calls.append({"system": system, "user": user, **kw})
        item = queue.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(explain.llm, "call_json", fake)
    return calls


VALID_KEYS = {"score", "verdict", "feedback", "misconception_id"}


# --- grade_explanation with a fake model -----------------------------------


def test_grade_passes_through_a_clean_answer(monkeypatch, llm_on, concept):
    calls = _install(monkeypatch, {
        "score": 85, "verdict": "pass", "feedback": "You nailed the noise point.",
        "misconception_id": None,
    })
    out = explain.grade_explanation(concept, "A model overfits when it learns the noise.")
    assert set(out) == VALID_KEYS
    assert out == {"score": 85, "verdict": "pass", "feedback": "You nailed the noise point.",
                   "misconception_id": None}
    assert calls[0]["max_tokens"] == 1000
    assert calls[0]["temperature"] == 0.1
    assert calls[0]["timeout"] == explain.get_settings().llm_explain_timeout_s


def test_grade_clamps_score_and_recomputes_verdict(monkeypatch, llm_on, concept):
    _install(monkeypatch, {"score": 140, "verdict": "fail", "feedback": "ok"})
    out = explain.grade_explanation(concept, "some text here that is long enough")
    assert out["score"] == 100 and out["verdict"] == "pass"

    _install(monkeypatch, {"score": "55.4", "verdict": "pass", "feedback": "ok"})
    out = explain.grade_explanation(concept, "some text here that is long enough")
    assert out["score"] == 55 and out["verdict"] == "partial"

    _install(monkeypatch, {"score": -9, "verdict": "pass", "feedback": "ok"})
    out = explain.grade_explanation(concept, "some text here that is long enough")
    assert out["score"] == 0 and out["verdict"] == "fail"

    _install(monkeypatch, {"score": "lots", "verdict": "pass", "feedback": "ok"})
    out = explain.grade_explanation(concept, "some text here that is long enough")
    assert out["score"] == 0 and out["verdict"] == scoring.verdict_for(0)


def test_grade_nulls_unknown_misconception_and_keeps_known(monkeypatch, llm_on, concept):
    _install(monkeypatch, {"score": 30, "feedback": "x", "misconception_id": "made_up"})
    assert explain.grade_explanation(concept, "t" * 30)["misconception_id"] is None

    _install(monkeypatch, {"score": 30, "feedback": "x", "misconception_id": "high_train_high_test"})
    out = explain.grade_explanation(concept, "t" * 30)
    assert out["misconception_id"] == "high_train_high_test"

    _install(monkeypatch, {"score": 30, "feedback": "x", "misconception_id": 17})
    assert explain.grade_explanation(concept, "t" * 30)["misconception_id"] is None


def test_grade_defaults_and_truncates_feedback(monkeypatch, llm_on, concept):
    _install(monkeypatch, {"score": 50})
    out = explain.grade_explanation(concept, "t" * 30)
    assert isinstance(out["feedback"], str) and out["feedback"].strip()

    _install(monkeypatch, {"score": 50, "feedback": "y" * 2000})
    assert len(explain.grade_explanation(concept, "t" * 30)["feedback"]) == 600

    _install(monkeypatch, {"score": 50, "feedback": ["not", "a", "string"]})
    assert isinstance(explain.grade_explanation(concept, "t" * 30)["feedback"], str)


def test_grade_retries_once_then_raises(monkeypatch, llm_on, concept):
    calls = _install(monkeypatch, llm.LLMError("timeout"), llm.LLMFormatError("garbage"))
    with pytest.raises(explain.GraderUnavailable):
        explain.grade_explanation(concept, "t" * 30)
    assert len(calls) == 2


def test_grade_retry_succeeds(monkeypatch, llm_on, concept):
    calls = _install(monkeypatch, llm.LLMFormatError("garbage"), {"score": 72, "feedback": "f"})
    out = explain.grade_explanation(concept, "t" * 30)
    assert out["score"] == 72 and out["verdict"] == "pass"
    assert len(calls) == 2


def test_grade_fixture_mode_does_not_raise(concept):
    # LLM_API_KEY is empty under tests: call_json raises FixtureMode.
    out = explain.grade_explanation(concept, "A model overfits when it learns the noise.")
    assert set(out) == VALID_KEYS
    assert out["verdict"] == scoring.verdict_for(out["score"])


# --- fixture_grade ---------------------------------------------------------


def test_fixture_grade_paraphrase_passes(concept):
    text = ("Overfitting is when the model learns the noise in the training data instead of "
            "the real pattern, so training error keeps falling but the error on new data rises.")
    out = explain.fixture_grade(concept, text)
    assert out["score"] >= 70
    assert out["verdict"] == "pass"
    assert out["misconception_id"] is None
    assert out["feedback"]


def test_fixture_grade_misconception_restatement_is_flagged(concept):
    bad = next(m for m in concept["misconceptions"] if m["id"] == "overfitting_is_bad_data")
    out = explain.fixture_grade(concept, bad["statement"])
    assert out["misconception_id"] == "overfitting_is_bad_data"
    assert out["score"] <= 35
    assert out["verdict"] == "fail"


def test_fixture_grade_gibberish_fails(concept):
    out = explain.fixture_grade(concept, "blorp zzyx quux flibber wobble snorf gribble")
    assert out["score"] < 40
    assert out["verdict"] == "fail"
    assert out["misconception_id"] is None


def test_fixture_grade_short_text_scores_zero(concept):
    out = explain.fixture_grade(concept, "noise")
    assert out == {"score": 0, "verdict": "fail", "feedback": out["feedback"],
                   "misconception_id": None}
    assert out["feedback"]


def test_fixture_grade_is_deterministic_and_names_terms(concept):
    text = "The model memorises noise from the training examples rather than the signal."
    a = explain.fixture_grade(concept, text)
    b = explain.fixture_grade(concept, text)
    assert a == b
    assert "noise" in a["feedback"] or "training" in a["feedback"] or "model" in a["feedback"]
    assert a["verdict"] == scoring.verdict_for(a["score"])


def test_fixture_grade_concept_without_misconceptions():
    concept = {"id": "x", "label": "Gradient descent",
               "summary": "Gradient descent nudges parameters downhill on the loss.",
               "misconceptions": []}
    out = explain.fixture_grade(concept, "Gradient descent moves the parameters downhill "
                                         "along the loss surface.")
    assert out["misconception_id"] is None
    assert out["score"] >= 70
