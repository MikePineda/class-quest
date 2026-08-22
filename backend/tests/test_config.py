"""Settings parsing. CORS_ORIGINS is the one that broke production: a
list-typed field makes pydantic-settings JSON-decode the env value before any
validator runs, so a plain comma-separated string raised SettingsError at
import time and the container never started."""
import pytest

from app.config import Settings


def _settings(monkeypatch, **env):
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    # _env_file="" so a developer's local backend/.env cannot leak into the test
    return Settings(_env_file="")


def test_cors_origins_accepts_a_comma_separated_string(monkeypatch):
    s = _settings(monkeypatch, CORS_ORIGINS="https://classquest.net,http://localhost:5173")
    assert s.cors_origins == ["https://classquest.net", "http://localhost:5173"]


def test_cors_origins_trims_whitespace_and_drops_empties(monkeypatch):
    s = _settings(monkeypatch, CORS_ORIGINS=" https://a.test , , https://b.test ")
    assert s.cors_origins == ["https://a.test", "https://b.test"]


def test_cors_origins_accepts_a_single_value(monkeypatch):
    assert _settings(monkeypatch, CORS_ORIGINS="https://only.test").cors_origins == [
        "https://only.test"
    ]


def test_cors_origins_falls_back_to_the_dev_default(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    assert _settings(monkeypatch).cors_origins == ["http://localhost:5173"]


@pytest.mark.parametrize("value,expected", [("", False), ("sk-abc", True)])
def test_llm_enabled_follows_the_key(monkeypatch, value, expected):
    assert _settings(monkeypatch, LLM_API_KEY=value).llm_enabled is expected
