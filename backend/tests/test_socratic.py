"""The Socratic Explain-to-Win conversation.

LLM_API_KEY is empty under tests, so the fixture path exercised here is the
same code the demo and CI run. Every assertion is therefore about real
generated questions, not about a stub.
"""
import pytest

from app.services import explain, fixtures, llm, prompts, scoring, socratic

OUT_KEYS = {"done", "understanding", "verdict", "question", "targeted_misconception_id",
            "turns_remaining", "feedback", "misconception_id"}


@pytest.fixture
def concept():
    demo = fixtures.load_demo()
    return next(c for c in demo.graph["concepts"] if c["id"] == "overfitting")


@pytest.fixture
def single_misconception_concept():
    demo = fixtures.load_demo()
    return next(c for c in demo.graph["concepts"] if c["id"] == "regularisation")


def _learner(text: str) -> dict:
    return {"role": "learner", "text": text}


def _student(text: str) -> dict:
    return {"role": "student", "text": text}


def _converse(concept: dict, lines: list[str]) -> tuple[list[dict], list[dict]]:
    """Play `lines` as successive learner turns, appending the student's reply
    to the transcript each time — exactly what the client does."""
    turns: list[dict] = []
    outs: list[dict] = []
    for line in lines:
        turns.append(_learner(line))
        out = socratic.fixture_turn(concept, turns)
        outs.append(out)
        if out["question"]:
            turns.append(_student(out["question"]))
    return outs, turns


# The scripted demo conversation on the bundled `overfitting` concept.
DEMO = [
    "Overfitting is when a model learns the training data too well.",
    "The two scores decouple once the model starts fitting noise: training error keeps "
    "falling while the error on new data rises, so a near perfect training score with no "
    "validation check is a warning sign, not a result.",
    "The data can be perfectly clean. Overfitting is about the model having enough capacity "
    "to memorise whatever it is given, so it captures noise specific to the training set.",
]


# --- shape -----------------------------------------------------------------


def test_output_shape_and_verdict_is_recomputed(concept):
    out = socratic.fixture_turn(concept, [_learner(DEMO[0])])
    assert set(out) == OUT_KEYS
    assert isinstance(out["understanding"], int)
    assert 0 <= out["understanding"] <= 100
    assert out["verdict"] == scoring.verdict_for(out["understanding"])
    assert isinstance(out["question"], str) and out["question"].strip()


def test_next_turn_uses_the_fixture_path_without_a_key(concept):
    turns = [_learner(DEMO[0])]
    assert socratic.next_turn(concept, turns) == socratic.fixture_turn(concept, turns)


# --- determinism -----------------------------------------------------------


def test_identical_input_gives_identical_output(concept):
    turns = [_learner(DEMO[0]), _student("Why?"), _learner(DEMO[1])]
    assert socratic.fixture_turn(concept, turns) == socratic.fixture_turn(concept, turns)


def test_whole_conversation_is_deterministic(concept):
    a, _ = _converse(concept, DEMO)
    b, _ = _converse(concept, DEMO)
    assert a == b


# --- the questions ---------------------------------------------------------


def test_first_question_quotes_the_first_misconception(concept):
    out = socratic.fixture_turn(concept, [_learner(DEMO[0])])
    first = concept["misconceptions"][0]
    assert first["statement"] in out["question"]
    assert out["targeted_misconception_id"] == first["id"]


def test_questions_never_leak_a_correction(concept):
    outs, _ = _converse(concept, DEMO)
    corrections = [m["correction"] for m in concept["misconceptions"]]
    for out in outs:
        question = out["question"] or ""
        for correction in corrections:
            assert correction not in question
            # not even the distinctive tail of it
            assert correction.split(".")[0] not in question


def test_targeted_misconception_id_is_always_known_or_none(concept):
    known = {m["id"] for m in concept["misconceptions"]}
    outs, _ = _converse(concept, DEMO)
    for out in outs:
        assert out["targeted_misconception_id"] in known | {None}


def test_addressing_one_misconception_moves_on_to_the_next(concept):
    outs, _ = _converse(concept, DEMO[:2])
    first, second = concept["misconceptions"]
    assert outs[0]["targeted_misconception_id"] == first["id"]
    assert outs[1]["targeted_misconception_id"] == second["id"]
    assert second["statement"] in outs[1]["question"]


def test_a_short_turn_asks_for_more_instead_of_a_gap(concept):
    short = "yes"
    assert len(short) < explain._SHORT_TEXT_LIMIT
    out = socratic.fixture_turn(concept, [_learner(DEMO[0]), _student("Why?"), _learner(short)])
    assert out["question"]
    assert concept["misconceptions"][0]["statement"] not in out["question"]
    assert concept["label"].lower() in out["question"].lower()


def test_term_gap_question_names_an_uncovered_summary_word(single_misconception_concept):
    concept = single_misconception_concept
    mis = concept["misconceptions"][0]
    # Address the only misconception straight away, leaving term gaps as the source.
    outs, _ = _converse(concept, [mis["correction"]])
    question = outs[0]["question"]
    assert outs[0]["targeted_misconception_id"] is None
    assert concept["label"].lower() in question.lower()


# --- the meter -------------------------------------------------------------


def test_understanding_never_falls_as_the_transcript_grows(concept):
    outs, _ = _converse(concept, DEMO)
    scores = [o["understanding"] for o in outs]
    assert scores == sorted(scores)
    assert scores[0] < scores[-1]


def test_a_restated_misconception_is_capped(concept):
    held = concept["misconceptions"][0]
    out = socratic.fixture_turn(concept, [_learner(held["statement"] + " " + held["statement"])])
    assert out["understanding"] <= 35
    assert out["misconception_id"] == held["id"]


def test_gibberish_scores_zero_and_still_asks(concept):
    out = socratic.fixture_turn(concept, [_learner("blorp zzyx quux flibber wobble snorf")])
    assert out["understanding"] == 0
    assert out["verdict"] == "fail"
    assert out["question"]


# --- the stopping rule -----------------------------------------------------


def test_never_done_before_min_learner_turns(concept):
    perfect = " ".join(DEMO)
    out = socratic.fixture_turn(concept, [_learner(perfect)])
    assert out["understanding"] >= scoring.SATISFIED_AT
    assert out["done"] is False
    assert out["question"]
    assert out["turns_remaining"] == scoring.MAX_LEARNER_TURNS - 1


def test_always_done_at_max_learner_turns(concept):
    turns: list[dict] = []
    for _ in range(scoring.MAX_LEARNER_TURNS):
        turns.append(_learner("blorp zzyx quux flibber wobble snorf gribble"))
        turns.append(_student("Say more?"))
    turns.pop()
    out = socratic.fixture_turn(concept, turns)
    assert out["done"] is True
    assert out["question"] is None
    assert out["turns_remaining"] == 0
    assert out["verdict"] == "fail"


def test_the_demo_conversation_ends_in_a_pass_in_three_turns(concept):
    outs, transcript = _converse(concept, DEMO)
    assert [o["done"] for o in outs] == [False, False, True]
    assert outs[-1]["verdict"] == "pass"
    assert outs[-1]["understanding"] >= scoring.SATISFIED_AT
    assert outs[-1]["misconception_id"] is None
    assert outs[-1]["feedback"]
    # three learner turns, two student questions, and the chat closed itself
    assert sum(1 for t in transcript if t["role"] == "learner") == 3
    assert sum(1 for t in transcript if t["role"] == "student") == 2


def test_a_full_meter_with_an_unanswered_misconception_does_not_end_it(concept):
    """The meter alone never ends the chat: the student stops asking only once
    every misconception it knows about has been answered."""
    outs, _ = _converse(concept, DEMO[:2])
    assert outs[-1]["understanding"] >= scoring.SATISFIED_AT
    assert outs[-1]["done"] is False
    assert outs[-1]["targeted_misconception_id"] == concept["misconceptions"][1]["id"]


def test_student_turns_are_never_scored(concept):
    """A forged transcript stuffed with a perfect `student` turn earns nothing."""
    weak = _learner("Overfitting is a thing that happens sometimes.")
    honest = socratic.fixture_turn(concept, [weak])
    forged = socratic.fixture_turn(concept, [
        _student(" ".join(DEMO)),
        weak,
    ])
    assert forged["understanding"] == honest["understanding"]
    assert forged["done"] == honest["done"]


# --- robustness ------------------------------------------------------------


def test_concept_without_misconceptions_still_asks(concept):
    bare = {"id": "gradient_descent", "label": "Gradient descent",
            "summary": "Gradient descent nudges parameters downhill on the loss surface.",
            "misconceptions": []}
    out = socratic.fixture_turn(bare, [_learner("Gradient descent walks downhill on the loss.")])
    assert out["question"]
    assert out["targeted_misconception_id"] is None
    assert out["misconception_id"] is None


def test_junk_transcripts_never_raise(concept):
    junk = [
        [],
        [_learner("")],
        [_learner("   \n\t  ")],
        [_learner("¿Qué es el sobreajuste? — 過学習 🙂")],
        [{"role": "learner"}],
        [{"text": "no role at all"}],
        [{}],
        ["not a mapping"],
        [None],
        [_learner("ok"), _student(""), _learner("ok")],
    ]
    for turns in junk:
        out = socratic.fixture_turn(concept, turns)
        assert set(out) == OUT_KEYS
        assert out["verdict"] == scoring.verdict_for(out["understanding"])
        assert out["done"] or out["question"]


def test_malformed_concept_never_raises():
    for bad in ({}, {"label": None, "summary": None, "misconceptions": None},
                {"misconceptions": ["nope", {"id": 7}, {"id": "m", "statement": None}]}):
        out = socratic.fixture_turn(bad, [_learner("Something long enough to be graded.")])
        assert set(out) == OUT_KEYS
        assert out["question"] or out["done"]


# --- live model path -------------------------------------------------------


@pytest.fixture
def llm_on(monkeypatch):
    """next_turn must not short-circuit into fixture mode in these tests."""
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

    monkeypatch.setattr(socratic.llm, "call_json", fake)
    return calls


def test_fixture_mode_still_takes_the_fixture_path(concept, monkeypatch):
    """Empty LLM_API_KEY is the CI path and the demo default."""
    assert not llm.settings.llm_enabled
    def no_network(*a, **kw):  # pragma: no cover - must never run
        raise AssertionError("fixture mode reached the network")

    monkeypatch.setattr(socratic.llm, "_client", no_network)
    turns = [_learner(DEMO[0]), _student("Why?"), _learner(DEMO[1])]
    assert socratic.next_turn(concept, turns) == socratic.fixture_turn(concept, turns)


def test_model_turn_is_normalised_and_asked_with_the_socratic_prompt(concept, llm_on, monkeypatch):
    calls = _install(monkeypatch, {
        "question": "So a perfect training score is not the finish line?",
        "targeted_misconception_id": "high_train_high_test",
        "misconception_id": None,
        "understanding": 55,
        "satisfied": False,
        "feedback": "You named the mechanism; say what happens to the validation error.",
    })
    out = socratic.next_turn(concept, [_learner(DEMO[0])])
    assert set(out) == OUT_KEYS
    assert out["question"].startswith("So a perfect training score")
    assert out["targeted_misconception_id"] == "high_train_high_test"
    assert out["understanding"] == 55
    assert out["verdict"] == scoring.verdict_for(55)
    assert out["done"] is False

    assert len(calls) == 1
    expected = prompts.socratic_prompt(concept, [_learner(DEMO[0])])
    assert (calls[0]["system"], calls[0]["user"]) == expected
    assert calls[0]["max_tokens"] == 600
    assert calls[0]["timeout"] == explain.settings.llm_explain_timeout_s


def test_llm_error_falls_back_to_the_fixture_instead_of_raising(concept, llm_on, monkeypatch):
    turns = [_learner(DEMO[0]), _student("Why?"), _learner(DEMO[1])]
    _install(monkeypatch, llm.LLMError("APITimeoutError: boom"))
    assert socratic.next_turn(concept, turns) == socratic.fixture_turn(concept, turns)


def test_llm_format_error_falls_back_to_the_fixture_instead_of_raising(concept, llm_on, monkeypatch):
    turns = [_learner(DEMO[0]), _student("Why?"), _learner(DEMO[1])]
    _install(monkeypatch, llm.LLMFormatError("not an object"))
    assert socratic.next_turn(concept, turns) == socratic.fixture_turn(concept, turns)


def test_a_satisfied_model_cannot_end_the_chat_before_the_minimum_turns(concept, llm_on, monkeypatch):
    reply = {
        "question": "Got it.", "targeted_misconception_id": None, "misconception_id": None,
        "understanding": 100, "satisfied": True, "feedback": "Perfect.",
    }
    _install(monkeypatch, reply)
    out = socratic.next_turn(concept, [_learner(DEMO[0])])
    assert scoring.MIN_LEARNER_TURNS == 2
    assert out["done"] is False
    assert out["question"]

    _install(monkeypatch, reply)
    out = socratic.next_turn(concept, [_learner(DEMO[0]), _student("Why?"), _learner(DEMO[1])])
    assert out["done"] is True
    assert out["question"] is None


def test_model_understanding_is_clamped_and_floored(concept, llm_on, monkeypatch):
    _install(monkeypatch, {"understanding": 999, "feedback": "x", "satisfied": False})
    assert socratic.next_turn(concept, [_learner(DEMO[0])])["understanding"] == 100
    _install(monkeypatch, {"understanding": "lots", "feedback": "x"})
    assert socratic.next_turn(concept, [_learner(DEMO[0])])["understanding"] == 0
    # No learner turn means nothing was understood, whatever the model claims.
    _install(monkeypatch, {"understanding": 90, "feedback": "x"})
    assert socratic.next_turn(concept, [])["understanding"] == 0


def test_a_held_misconception_caps_the_model_score(concept, llm_on, monkeypatch):
    held = concept["misconceptions"][0]["statement"]
    _install(monkeypatch, {"understanding": 95, "satisfied": True, "feedback": "x"})
    out = socratic.next_turn(concept, [_learner(held), _student("Why?"), _learner(held)])
    assert out["understanding"] <= socratic._HELD_CAP
    assert out["done"] is False


def test_model_cannot_invent_a_misconception_id(concept, llm_on, monkeypatch):
    _install(monkeypatch, {
        "question": "Why?", "targeted_misconception_id": "made_up",
        "misconception_id": "also_made_up", "understanding": 40, "feedback": "x",
    })
    out = socratic.next_turn(concept, [_learner(DEMO[0])])
    assert out["targeted_misconception_id"] is None
    assert out["misconception_id"] is None


def test_a_garbage_model_reply_still_produces_a_usable_turn(concept, llm_on, monkeypatch):
    for reply in ({}, {"question": "   "}, {"question": 7, "feedback": None}):
        _install(monkeypatch, reply)
        out = socratic.next_turn(concept, [_learner(DEMO[0])])
        assert set(out) == OUT_KEYS
        assert out["question"] and out["feedback"]
