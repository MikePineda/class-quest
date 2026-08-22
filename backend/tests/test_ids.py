import re

from app import ids


def test_new_id_is_32_hex():
    assert re.fullmatch(r"[0-9a-f]{32}", ids.new_id())


def test_artifact_id_matches_contract_pattern():
    # schema: ^[a-z0-9]{8,32}$
    for _ in range(50):
        assert re.fullmatch(r"[a-z0-9]{8,32}", ids.artifact_id())


def test_join_code_is_six_unambiguous_chars():
    for _ in range(200):
        code = ids.join_code()
        assert len(code) == 6
        assert set(code) <= set(ids.JOIN_ALPHABET)
        assert not set(code) & set("0O1I")


def test_utc_now_iso_has_z_suffix_and_no_micros():
    s = ids.utc_now_iso()
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", s)
