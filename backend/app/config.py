"""Settings. Every value comes from the environment (or backend/.env locally).

Rule: an empty optional secret switches the feature off, it never raises.
LLM_API_KEY="" means fixture mode: the pipeline serves the hand-written
fixtures instead of calling MiniMax. CI runs that path on purpose.
"""
from functools import lru_cache
from pathlib import Path

from pydantic import Field
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
    # Kept as a plain string on purpose. A list-typed setting makes
    # pydantic-settings JSON-decode the env value before any validator runs,
    # so a comma-separated CORS_ORIGINS is a hard SettingsError at import
    # time and the container never starts. The split lives in the property.
    cors_origins_raw: str = Field("http://localhost:5173", validation_alias="CORS_ORIGINS")
    public_api_url: str = "http://localhost:8000"

    llm_api_key: str = ""
    llm_base_url: str = "https://api.minimax.io/anthropic"
    llm_model: str = "MiniMax-M3"
    llm_timeout_s: float = 120.0
    llm_explain_timeout_s: float = 55.0

    # Abuse controls. The link goes out on a QR code, so the defaults are the
    # production values, not the permissive ones: a deployment that forgets to
    # set these is still defended. Only the tests turn the limiter off.
    rate_limit_enabled: bool = True
    #: Read the caller's address out of `X-Forwarded-For`. True because Traefik
    #: terminates TLS in front of this app; False when nothing is in front of
    #: it, where the header would be pure attacker input. See `ratelimit.py`.
    trust_forwarded_for: bool = True
    #: Servers one account may own. Every server is a generation run.
    max_servers_per_user: int = 5
    #: Generation threads allowed at once, across everyone. SQLite has one
    #: writer and the box is a small ARM instance.
    max_concurrent_generations: int = 3

    max_worlds: int = 6
    segment_chars: int = 1500
    max_upload_mb: int = 10
    max_files: int = 10
    max_total_chars: int = 400_000
    min_total_chars: int = 400

    seed_demo: bool = True
    # Which server the seeded classmate cohort joins. Empty = the demo server
    # created by `seed.ensure_demo_server`. A plain `str` on purpose: see the
    # note on cors_origins_raw -- anything pydantic-settings would JSON-decode
    # turns a bad env value into a crash loop at import time.
    demo_cohort_server_id: str = ""

    @property
    def cors_origins(self) -> list[str]:
        """Allowed browser origins, comma-separated in the environment."""
        return [o.strip() for o in self.cors_origins_raw.split(",") if o.strip()]

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
