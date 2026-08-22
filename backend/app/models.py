"""All tables. Timestamps are ISO-8601 UTC strings; ids are uuid hex.

Game content is stored as raw JSON text on `worlds` (graph_json, quest_json,
gauntlet_json) in exactly the shape of schema/*.schema.json. The questions the
learner answers ARE the prediction scenes inside those blobs; `attempts`
references them by scene_id. No scene table on purpose.
"""
from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)
    role: Mapped[str | None] = mapped_column(String(16))  # student | teacher
    industry: Mapped[str | None] = mapped_column(String(80))
    about: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(20), nullable=False)


class Server(Base):
    """A class/course. Members join by code; content is split into worlds."""
    __tablename__ = "servers"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    join_code: Mapped[str] = mapped_column(String(6), unique=True, nullable=False)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # The mascot that asks the questions (the `mentor` speaker in game scenes).
    pet: Mapped[str] = mapped_column(String(32), nullable=False)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)  # pending|processing|ready|failed
    error: Mapped[str | None] = mapped_column(Text)
    segment_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[str] = mapped_column(String(20), nullable=False)


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("user_id", "server_id"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    server_id: Mapped[str] = mapped_column(ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # owner | member
    joined_at: Mapped[str] = mapped_column(String(20), nullable=False)


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    server_id: Mapped[str] = mapped_column(ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    char_count: Mapped[int] = mapped_column(Integer, nullable=False)
    stored_path: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[str] = mapped_column(String(20), nullable=False)


class Segment(Base):
    """A ~1500-char chunk. `seq` is global per server and IS source_span.segment_id."""
    __tablename__ = "segments"
    __table_args__ = (UniqueConstraint("server_id", "seq"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    server_id: Mapped[str] = mapped_column(ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)


class World(Base):
    __tablename__ = "worlds"
    __table_args__ = (UniqueConstraint("server_id", "idx"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    server_id: Mapped[str] = mapped_column(ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    idx: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    blurb: Mapped[str | None] = mapped_column(String(200))
    segment_start: Mapped[int] = mapped_column(Integer, nullable=False)
    segment_end: Mapped[int] = mapped_column(Integer, nullable=False)  # inclusive
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    stage: Mapped[str | None] = mapped_column(String(16))  # graph | quest | gauntlet
    error: Mapped[str | None] = mapped_column(Text)
    graph_id: Mapped[str | None] = mapped_column(String(32))
    quest_id: Mapped[str | None] = mapped_column(String(32))
    gauntlet_id: Mapped[str | None] = mapped_column(String(32))
    graph_json: Mapped[str | None] = mapped_column(Text)
    quest_json: Mapped[str | None] = mapped_column(Text)
    gauntlet_json: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(20), nullable=False)


class Attempt(Base):
    """The only source of XP. server_id is denormalised so the leaderboard is one query."""
    __tablename__ = "attempts"
    __table_args__ = (
        Index("ix_attempts_server_user", "server_id", "user_id"),
        Index("ix_attempts_world_user", "world_id", "user_id"),
    )
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    server_id: Mapped[str] = mapped_column(ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    world_id: Mapped[str] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"), nullable=False)
    game_id: Mapped[str] = mapped_column(String(32), nullable=False)
    archetype: Mapped[str] = mapped_column(String(16), nullable=False)  # quest|gauntlet|explain
    scene_id: Mapped[str] = mapped_column(String(64), nullable=False)
    option_id: Mapped[str | None] = mapped_column(String(64))
    correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    xp: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[str] = mapped_column(String(20), nullable=False)


class Explanation(Base):
    __tablename__ = "explanations"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    world_id: Mapped[str] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"), nullable=False)
    concept_id: Mapped[str] = mapped_column(String(64), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    verdict: Mapped[str] = mapped_column(String(16), nullable=False)  # pass|partial|fail
    feedback: Mapped[str] = mapped_column(Text, nullable=False)
    misconception_id: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[str] = mapped_column(String(20), nullable=False)


class GenerationEvent(Base):
    """Progress log shown on the 'forging your worlds' screen."""
    __tablename__ = "generation_events"
    __table_args__ = (Index("ix_genevents_server", "server_id", "id"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    server_id: Mapped[str] = mapped_column(ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    world_id: Mapped[str | None] = mapped_column(String(32))
    stage: Mapped[str] = mapped_column(String(16), nullable=False)
    level: Mapped[str] = mapped_column(String(8), nullable=False)  # info|warn|error
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(String(20), nullable=False)
