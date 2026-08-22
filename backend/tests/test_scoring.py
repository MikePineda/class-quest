from app.services import scoring


def test_xp_table_values():
    assert scoring.xp_for_prediction(correct=True, first_time=True) == 10
    assert scoring.xp_for_prediction(correct=False, first_time=True) == 2
    assert scoring.xp_for_prediction(correct=True, first_time=False) == 0
    assert scoring.xp_for_prediction(correct=False, first_time=False) == 0


def test_explain_verdict_thresholds():
    assert scoring.verdict_for(100) == "pass"
    assert scoring.verdict_for(70) == "pass"
    assert scoring.verdict_for(69) == "partial"
    assert scoring.verdict_for(40) == "partial"
    assert scoring.verdict_for(39) == "fail"
    assert scoring.verdict_for(0) == "fail"


def test_explain_xp_only_first_time():
    assert scoring.xp_for_explain("pass", first_time=True) == 25
    assert scoring.xp_for_explain("partial", first_time=True) == 10
    assert scoring.xp_for_explain("fail", first_time=True) == 0
    assert scoring.xp_for_explain("pass", first_time=False) == 0


def test_score_is_clamped():
    assert scoring.clamp_score(140) == 100
    assert scoring.clamp_score(-3) == 0
    assert scoring.clamp_score(55.6) == 56
    assert scoring.clamp_score("not a number") == 0


def test_deliberately_failing_probe():
    assert scoring.xp_for_prediction(correct=True, first_time=True) == 999
