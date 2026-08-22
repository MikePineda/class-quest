"""ClassQuest API. Run: uvicorn app.main:app --reload"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401  (register tables on Base)
from app.config import get_settings
from app.db import Base, engine
from app.routers import auth, meta, servers, worlds

log = logging.getLogger("classquest")


@asynccontextmanager
async def _lifespan(app: FastAPI):
    s = get_settings()
    s.uploads_dir.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    if s.jwt_secret == "dev-secret-change-me":
        log.warning("JWT_SECRET is the dev default; set it in the environment for prod")
    if s.seed_demo:
        from app.services import seed

        seed.ensure_demo_server()
    yield


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title="ClassQuest API",
        version=s.app_version,
        description="Turn course content into playable worlds. Contract for the frontend.",
        lifespan=_lifespan,
        servers=[{"url": s.public_api_url}],
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(meta.router)
    app.include_router(auth.router)
    app.include_router(servers.router)
    app.include_router(worlds.router)
    return app


app = create_app()
