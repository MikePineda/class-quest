"""API DTOs. Every response model carries an example: that is what the FE dev
reads in /docs, so keep them realistic."""
from typing import Literal

from pydantic import BaseModel, ConfigDict


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    db: Literal["ok", "error"]
    llm: Literal["live", "fixtures"]
    version: str
    model_config = ConfigDict(json_schema_extra={"example": {
        "status": "ok", "db": "ok", "llm": "live", "version": "0.1.0"}})
