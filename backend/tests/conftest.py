"""Test fixtures. Every test gets a fresh SQLite file and a TestClient.

LLM_API_KEY is forced empty so no test ever reaches the network: the pipeline
runs in fixture mode, which is also the path CI exercises end to end.
"""
import os
import tempfile
from pathlib import Path

import pytest

_TMP = tempfile.mkdtemp(prefix="cq-test-")
os.environ["DATA_DIR"] = _TMP
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP}/test.db"
os.environ["LLM_API_KEY"] = ""
os.environ["JWT_SECRET"] = "test-secret"
os.environ["SEED_DEMO"] = "false"
# The limits are real in production and off here: a suite that shares one
# process would otherwise have tests fail depending on what ran before them.
# `test_ratelimit.py` and `test_limits.py` turn them back on deliberately.
os.environ["RATE_LIMIT_ENABLED"] = "false"

from app.config import get_settings  # noqa: E402
from app.db import Base, engine  # noqa: E402
from app.main import create_app  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES = REPO_ROOT / "fixtures"


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture(autouse=True)
def fresh_buckets():
    """Rate-limit state lives in the process, not the database, so dropping the
    tables is not enough to isolate one test from the next."""
    from app.ratelimit import reset_all

    reset_all()
    yield
    reset_all()


@pytest.fixture
def settings():
    return get_settings()


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as c:
        yield c


@pytest.fixture
def fixtures_dir():
    return FIXTURES
