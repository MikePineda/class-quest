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
