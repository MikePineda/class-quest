"""XP rules and Explain-to-Win thresholds. One place, so tuning is one line."""

XP_PREDICTION_CORRECT = 10
XP_PREDICTION_WRONG = 2
XP_EXPLAIN = {"pass": 25, "partial": 10, "fail": 0}

PASS_AT = 70
PARTIAL_AT = 40

# Socratic Explain-to-Win (services/socratic.py). The AI student stops asking
# once its comprehension meter reaches SATISFIED_AT, but never before
# MIN_LEARNER_TURNS and never after MAX_LEARNER_TURNS: the cap is what stops a
# stubborn transcript from running forever on stage.
SATISFIED_AT = 75
MIN_LEARNER_TURNS = 2
MAX_LEARNER_TURNS = 4


def xp_for_prediction(*, correct: bool, first_time: bool) -> int:
    if not first_time:
        return 0
    return XP_PREDICTION_CORRECT if correct else XP_PREDICTION_WRONG


def verdict_for(score: int) -> str:
    if score >= PASS_AT:
        return "pass"
    if score >= PARTIAL_AT:
        return "partial"
    return "fail"


def satisfied_enough(score: int) -> bool:
    """Has the AI student's comprehension meter reached the end-the-chat mark?"""
    return score >= SATISFIED_AT


def xp_for_explain(verdict: str, *, first_time: bool) -> int:
    if not first_time:
        return 0
    return XP_EXPLAIN.get(verdict, 0)


def clamp_score(value) -> int:
    try:
        return max(0, min(100, round(float(value))))
    except (TypeError, ValueError):
        return 0
