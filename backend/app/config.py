"""Settings. Every value comes from the environment (or backend/.env locally).

Rule: an empty optional secret switches the feature off, it never raises.
LLM_API_KEY="" means fixture mode: the pipeline serves the hand-written
fixtures instead of calling MiniMax. CI runs that path on purpose.
"""
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py -> repo root is two levels up from backend/
_REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_version: str = "0.1.0"
    data_dir: Path = Path("./.data")
    database_url: str = ""  # derived from data_dir when empty
    schema_dir: Path = _REPO_ROOT / "schema"
    fixtures_dir: Path = _REPO_ROOT / "fixtures"

    jwt_secret: str = "dev-secret-change-me"
    jwt_expire_hours: int = 168
    cors_origins: list[str] = ["http://localhost:5173"]
    public_api_url: str = "http://localhost:8000"

    llm_api_key: str = ""
    llm_base_url: str = "https://api.minimax.io/anthropic"
    llm_model: str = "MiniMax-M3"
    llm_timeout_s: float = 120.0
    llm_explain_timeout_s: float = 55.0

    max_worlds: int = 6
    segment_chars: int = 1500
    max_upload_mb: int = 10
    max_files: int = 10
    max_total_chars: int = 400_000
    min_total_chars: int = 400

    seed_demo: bool = True

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v):
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @property
    def llm_enabled(self) -> bool:
        return bool(self.llm_api_key)

    @property
    def sqlite_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{self.data_dir / 'classquest.db'}"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"


@lru_cache
def get_settings() -> Settings:
    return Settings()
