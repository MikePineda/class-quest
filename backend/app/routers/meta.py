from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.schemas import HealthOut

router = APIRouter(tags=["meta"])


@router.get("/health", response_model=HealthOut)
def health(db: Session = Depends(get_db)):
    s = get_settings()
    try:
        db.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception:
        db_status = "error"
    return HealthOut(
        status="ok" if db_status == "ok" else "degraded",
        db=db_status,
        llm="live" if s.llm_enabled else "fixtures",
        version=s.app_version,
    )
