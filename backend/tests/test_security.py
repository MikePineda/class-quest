import pytest

from app import security


def test_password_roundtrip():
    h = security.hash_password("hunter2hunter2")
    assert h != "hunter2hunter2"
    assert security.verify_password("hunter2hunter2", h)
    assert not security.verify_password("wrong", h)


def test_verify_against_garbage_hash_is_false_not_exception():
    assert security.verify_password("x", "not-a-hash") is False


def test_token_roundtrip():
    tok = security.create_token("user123")
    assert security.decode_token(tok) == "user123"


def test_tampered_token_is_rejected():
    tok = security.create_token("user123")
    with pytest.raises(security.TokenError):
        security.decode_token(tok[:-2] + "xx")


def test_expired_token_is_rejected():
    tok = security.create_token("user123", expires_hours=-1)
    with pytest.raises(security.TokenError):
        security.decode_token(tok)
