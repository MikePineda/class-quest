"""API DTOs. Every response model carries an example: that is what the FE dev
reads in /docs, so keep them realistic."""
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    db: Literal["ok", "error"]
    llm: Literal["live", "fixtures"]
    version: str
    model_config = ConfigDict(json_schema_extra={"example": {
        "status": "ok", "db": "ok", "llm": "live", "version": "0.1.0"}})


# ---------------------------------------------------------------- auth

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
Role = Literal["student", "teacher"]


def _normalize_email(v: str) -> str:
    v = v.strip().lower()
    if not _EMAIL_RE.match(v):
        raise ValueError("invalid email address")
    return v


class RegisterIn(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=80)
    model_config = ConfigDict(json_schema_extra={"example": {
        "email": "ada@example.com", "password": "correct-horse-battery",
        "display_name": "Ada Lovelace"}})

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return _normalize_email(v)

    @field_validator("display_name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("display_name must not be blank")
        return v


class LoginIn(BaseModel):
    email: str
    password: str
    model_config = ConfigDict(json_schema_extra={"example": {
        "email": "ada@example.com", "password": "correct-horse-battery"}})

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        # Only normalize here: a malformed email is simply "invalid credentials".
        return v.strip().lower()


class UserOut(BaseModel):
    id: str
    email: str
    display_name: str
    role: Role | None = None
    industry: str | None = None
    about: str | None = None
    created_at: str
    model_config = ConfigDict(from_attributes=True, json_schema_extra={"example": {
        "id": "3f2a9c1e8b7d4e6f9a0b1c2d3e4f5a6b", "email": "ada@example.com",
        "display_name": "Ada Lovelace", "role": "teacher", "industry": "Mathematics",
        "about": "Teaching analytical engines since 1843.",
        "created_at": "2026-08-22T09:15:00Z"}})


class TokenOut(BaseModel):
    token: str
    token_type: Literal["bearer"] = "bearer"
    user: UserOut
    model_config = ConfigDict(from_attributes=True, json_schema_extra={"example": {
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzZjJhIn0.sig",
        "token_type": "bearer",
        "user": UserOut.model_config["json_schema_extra"]["example"]}})


class ProfileUpdateIn(BaseModel):
    """All fields optional; only keys present in the body are changed."""
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    role: Role | None = None
    industry: str | None = Field(default=None, max_length=80)
    about: str | None = Field(default=None, max_length=2000)
    model_config = ConfigDict(json_schema_extra={"example": {
        "display_name": "Ada L.", "role": "student", "industry": "Software",
        "about": "Second-year CS student."}})

    @field_validator("display_name")
    @classmethod
    def _strip_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("display_name must not be blank")
        return v
