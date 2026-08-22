"""Socratic Explain-to-Win: the learner explains a concept and an AI *student*
asks follow-up questions until it understands, while a comprehension meter
fills.

`explain.py` stays the one-shot grader; this is its conversational sibling.

Three rules here are load-bearing and must survive any future edit:

1. **No server state.** The client posts the whole transcript every time and
   `next_turn` is a pure function of (concept, turns). There is no Alembic in
   this repo and `main.py` only calls `create_all()`, which does not
   `ALTER TABLE`: a new column would silently no-op against the deployed
   SQLite file and then 500 on the first insert.
2. **Only the learner's turns are scored.** The transcript is client-supplied
   and therefore untrusted. `student` turns are narrative context that shape
   the next question and nothing else, so a forged transcript can change what
   the student asks next but cannot manufacture a single point of XP.
3. **`misconceptions[].correction` never reaches a prompt.** A student who
   already knows the answer cannot be Socratic. Only `statement` is ever
   quoted back to the learner; `correction` is used solely as a private bag of
   words for deciding whether the learner has *addressed* the misconception.

The verdict is always recomputed from the clamped meter via
`scoring.verdict_for` in `_normalize_turn`, exactly as `explain._normalize_grade`
does — nothing outside this module, model or client, gets to assert it.
"""
import logging

from app.config import get_settings
from app.services import explain, llm, prompts, scoring

log = logging.getLogger("classquest.socratic")
settings = get_settings()

_QUESTION_LIMIT = 400
_FEEDBACK_LIMIT = 600

# How many content words of a misconception must show up before we believe the
# learner is either holding it or has answered it.
_MIN_MATCH = 2
# `fixture_grade` caps a restated misconception at 35; the meter agrees.
_HELD_CAP = 35
# Coverage of the concept summary the student needs before it is willing to
# stop asking. Below this it always has another question.
_SATISFIED_COVERAGE = 0.55
# Two words are treated as the same term if they share this prefix, so the
# student does not ask about "overfits" right after the learner said
# "overfitting".
_STEM = 5

# Exactly two question templates, one per gap source, plus a "say more" nudge
# for a too-short turn or a concept with nothing left to ask about.
# The belief is quoted rather than spliced into the sentence. Statements are
# authored as standalone sentences and many begin with "If" or a proper noun,
# which reads as broken grammar after "I thought": quoting sidesteps it
# entirely and makes clear the student is repeating something back.
_Q_MISCONCEPTION = 'Hold on. I had it as: "{statement}" Why is that not right?'
_Q_TERM = "My notes keep mentioning {term}. Where does {term} fit into {label}?"
_Q_MORE = "Okay — can you walk me through how {label} actually works, step by step?"
# Asked when the student has already raised this belief and the learner has not
# dislodged it. Repeating the first question verbatim reads as a broken loop
# rather than as a student who is still stuck.
_Q_REASK = "I still do not follow. What would go wrong if I kept believing that?"


# ------------------------------------------------------------------ reading


def _field(turn, key: str) -> str:
    """A transcript element is whatever the client sent. Never trust it."""
    if isinstance(turn, dict):
        value = turn.get(key)
    else:
        value = getattr(turn, key, None)
    return value if isinstance(value, str) else ""


def _learner_texts(turns) -> list[str]:
    """Learner turns only — see rule 2 in the module docstring."""
    if not isinstance(turns, (list, tuple)):
        return []
    return [_field(t, "text") for t in turns if _field(t, "role") == "learner"]


def _label_of(concept) -> str:
    label = concept.get("label") if isinstance(concept, dict) else None
    return label.strip() if isinstance(label, str) and label.strip() else "this"


def _sentence(text: str) -> str:
    text = " ".join(str(text).split())
    if text and text[-1] not in ".!?":
        text += "."
    return text


# ---------------------------------------------------------------- analysis


def _analyse(concept: dict, turns) -> dict:
    """Everything the fixture student knows, derived from the learner's turns.

    Coverage is computed exactly the way `explain.fixture_grade` computes it,
    so the meter and the one-shot grader never disagree about the same text.
    """
    if not isinstance(concept, dict):
        concept = {}
    learner = _learner_texts(turns)
    said = explain.tokenize(" ".join(learner))
    tokens = set(said)

    label = _label_of(concept)
    summary = concept.get("summary")
    summary_words = explain.content_words(
        f"{label} {summary if isinstance(summary, str) else ''}"
    )
    summary_set = set(summary_words)
    matched = [w for w in summary_words if w in tokens]
    missing = [w for w in summary_words if w not in tokens]
    coverage = len(matched) / len(summary_words) if summary_words else 0.0
    # Words the learner has never touched, not even as another form of the
    # same word: "overfits" is not a gap once they have said "overfitting".
    stems = {w[:_STEM] for w in said + explain.tokenize(label)}
    gaps = [w for w in missing if w[:_STEM] not in stems]

    held: list[str] = []
    addressed: list[str] = []
    unaddressed: list[dict] = []
    for m in concept.get("misconceptions") or []:
        if not isinstance(m, dict) or not isinstance(m.get("id"), str):
            continue
        statement = m.get("statement") if isinstance(m.get("statement"), str) else ""
        correction = m.get("correction") if isinstance(m.get("correction"), str) else ""

        # Held: the learner is restating the wrong belief. Same rule
        # `fixture_grade` uses to cap the score at 35.
        statement_hits = sum(1 for w in explain.content_words(statement) if w in tokens)
        if statement_hits >= _MIN_MATCH and statement_hits > len(matched):
            held.append(m["id"])

        # Addressed: the learner has said the things that only the correction
        # says. Words the correction shares with the summary are dropped first
        # — corrections re-use the concept's own vocabulary ("model", "data"),
        # so without this any competent first sentence would "address" every
        # misconception at once and the student would never ask anything.
        distinctive = [w for w in explain.content_words(correction) if w not in summary_set]
        if sum(1 for w in distinctive if w in tokens) >= _MIN_MATCH:
            addressed.append(m["id"])
        else:
            unaddressed.append(m)

    return {
        "learner_count": len(learner),
        "newest": learner[-1].strip() if learner else "",
        "coverage": coverage,
        "matched": matched,
        "gaps": gaps,
        "held": held,
        "addressed": addressed,
        "unaddressed": unaddressed,
    }


def _next_question(concept: dict, a: dict, turns=()) -> tuple[str, str | None]:
    """The deterministic gap queue: unaddressed misconceptions in graph order,
    then uncovered summary words in first-occurrence order."""
    label = _label_of(concept)

    # A one-word answer is not a gap, it is a stall: ask for more instead of
    # moving the conversation on.
    if a["learner_count"] and len(a["newest"]) < explain._SHORT_TEXT_LIMIT:
        return _Q_MORE.format(label=label), None

    # What the student has already said, so a belief is never raised twice in
    # the same words.
    # Defensive on purpose: this module never raises on a malformed transcript,
    # because it is fed straight from an HTTP body.
    asked = " ".join(
        str(t.get("text", ""))
        for t in turns or ()
        if isinstance(t, dict) and t.get("role") == "student"
    )

    for m in a["unaddressed"]:
        statement = m.get("statement")
        if isinstance(statement, str) and statement.strip():
            if statement.strip()[:60] in asked:
                return _Q_REASK, m["id"]
            return _Q_MISCONCEPTION.format(statement=_sentence(statement)), m["id"]

    if a["gaps"]:
        return _Q_TERM.format(term=a["gaps"][0], label=label), None

    return _Q_MORE.format(label=label), None


def _feedback(concept: dict, a: dict, understanding: int) -> str:
    label = _label_of(concept)
    if a["held"]:
        return ("You are still leaning on a wrong idea about "
                f"{label.lower()}; the student never got past it.")
    if understanding >= scoring.PASS_AT and not a["gaps"]:
        return "The student gets it now — you answered every follow-up and left no gaps."
    if understanding >= scoring.PASS_AT:
        return ("The student gets it now. To be airtight, work "
                f"{a['gaps'][0]} into the explanation next time.")
    if a["gaps"]:
        return f"The student is still unsure — say more about {a['gaps'][0]}."
    return "The student is still unsure; explain the mechanism in your own words."


# --------------------------------------------------------------- normalise


def _normalize_turn(
    concept: dict,
    raw: dict,
    *,
    learner_turns: int,
    understanding,
    satisfied: bool,
) -> dict:
    """Defensive normalisation, mirroring `explain._normalize_grade`.

    Whatever produced `raw` — the fixture student today, a model tomorrow —
    only ever proposes the *wording*. The meter, the verdict and the decision
    to stop are computed here and nowhere else.
    """
    if not isinstance(raw, dict):
        raw = {}
    understanding = scoring.clamp_score(understanding)
    verdict = scoring.verdict_for(understanding)

    try:
        learner_turns = max(0, int(learner_turns))
    except (TypeError, ValueError):
        learner_turns = 0

    done = bool(
        (learner_turns >= scoring.MIN_LEARNER_TURNS
         and scoring.satisfied_enough(understanding)
         and bool(satisfied))
        or learner_turns >= scoring.MAX_LEARNER_TURNS
    )

    known_ids = {
        m.get("id") for m in (concept.get("misconceptions") or [])
        if isinstance(m, dict)
    } if isinstance(concept, dict) else set()

    def _known(key: str) -> str | None:
        value = raw.get(key)
        return value if isinstance(value, str) and value in known_ids else None

    question: str | None = None
    targeted = None
    if not done:
        question = raw.get("question")
        if not isinstance(question, str) or not question.strip():
            question = _Q_MORE.format(label=_label_of(concept))
        question = question.strip()[:_QUESTION_LIMIT]
        targeted = _known("targeted_misconception_id")

    feedback = raw.get("feedback")
    if not isinstance(feedback, str) or not feedback.strip():
        feedback = "Keep going — say more about how it actually works."
    feedback = feedback[:_FEEDBACK_LIMIT]

    return {
        "done": done,
        "understanding": understanding,
        "verdict": verdict,
        "question": question,
        "targeted_misconception_id": targeted,
        "turns_remaining": 0 if done else max(0, scoring.MAX_LEARNER_TURNS - learner_turns),
        "feedback": feedback,
        "misconception_id": _known("misconception_id"),
    }


# ----------------------------------------------------------------- fixture


def fixture_turn(concept: dict, turns) -> dict:
    """Deterministic Socratic student used when no LLM is configured.

    This is the demo path and the path CI runs: instant, offline and stable.
    """
    a = _analyse(concept, turns)

    understanding = scoring.clamp_score(a["coverage"] * 140 + 10 * len(a["addressed"]))
    if a["held"]:
        understanding = min(understanding, _HELD_CAP)
    satisfied = not a["unaddressed"] and a["coverage"] >= _SATISFIED_COVERAGE

    question, targeted = _next_question(concept, a, turns)
    return _normalize_turn(
        concept,
        {
            "question": question,
            "targeted_misconception_id": targeted,
            "misconception_id": a["held"][0] if a["held"] else None,
            "feedback": _feedback(concept, a, understanding),
        },
        learner_turns=a["learner_count"],
        understanding=understanding,
        satisfied=satisfied,
    )


# ------------------------------------------------------------------- model


def next_turn(concept: dict, turns) -> dict:
    """One step of the conversation: what the student says next, how much it
    now understands, and whether it is done.

    The model writes the wording and proposes an advisory `understanding` and
    `satisfied`; the meter, the verdict and the decision to stop are still
    computed by `_normalize_turn`. Unlike `explain.grade_explanation`, which
    raises `GraderUnavailable` and answers 503, every failure here falls back
    to `fixture_turn`: a chat that dies mid-sentence on stage is worse than a
    deterministic student, and the fixture path is always available.
    """
    system, user = prompts.socratic_prompt(concept, turns)
    try:
        raw = llm.call_json(
            system, user, max_tokens=600, temperature=0.4,
            timeout=settings.llm_explain_timeout_s,
        )
    except llm.FixtureMode:
        return fixture_turn(concept, turns)
    except (llm.LLMError, llm.LLMFormatError) as e:
        log.warning("socratic: model turn failed (%s); falling back to the fixture student", e)
        return fixture_turn(concept, turns)

    a = _analyse(concept, turns)
    understanding = scoring.clamp_score(raw.get("understanding") if isinstance(raw, dict) else 0)
    # Server-side floors the model does not get to argue with: nothing said
    # means nothing understood, and a learner who is still restating the wrong
    # belief is capped exactly where `fixture_grade` caps them.
    if not a["learner_count"]:
        understanding = 0
    if a["held"]:
        understanding = min(understanding, _HELD_CAP)

    return _normalize_turn(
        concept,
        raw,
        learner_turns=a["learner_count"],
        understanding=understanding,
        satisfied=bool(raw.get("satisfied")) if isinstance(raw, dict) else False,
    )
