"""API DTOs. Every response model carries an example: that is what the FE dev
reads in /docs, so keep them realistic."""
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app import contracts
from app.services.passwords import MAX_BYTES, MIN_LENGTH, password_problems


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
    # The real rules live in `services/passwords.py` and run in the model
    # validator below, which needs the email and the name alongside the
    # password. These bounds are here so the constraint shows up in
    # /openapi.json and so an absurd payload is rejected before bcrypt sees it.
    password: str = Field(min_length=MIN_LENGTH, max_length=MAX_BYTES)
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

    @model_validator(mode="after")
    def _password_policy(self):
        # After, not a field validator: "do not put your own name in your
        # password" needs the other two fields. Every reason is reported at
        # once, so nobody has to guess twice.
        problems = password_problems(
            self.password, email=self.email, display_name=self.display_name
        )
        if problems:
            raise ValueError(" ".join(problems))
        return self


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


# ---------------------------------------------------------------- servers

Role_ = Literal["owner", "member"]


class ServerSummary(BaseModel):
    id: str
    name: str
    description: str | None = None
    join_code: str | None = None
    is_public: bool
    pet: str
    status: Literal["pending", "processing", "ready", "failed"]
    error: str | None = None
    owner_id: str
    member_count: int
    world_count: int
    my_role: Role_ | None = None
    my_xp: int
    created_at: str
    model_config = ConfigDict(from_attributes=True, json_schema_extra={"example": {
        "id": "9c1e8b7d4e6f9a0b1c2d3e4f5a6b3f2a", "name": "Intro to ML — Week 3",
        "description": None, "join_code": "K7Q2MX", "is_public": True, "pet": "owl",
        "status": "processing", "error": None,
        "owner_id": "3f2a9c1e8b7d4e6f9a0b1c2d3e4f5a6b", "member_count": 1, "world_count": 0,
        "my_role": "owner", "my_xp": 0, "created_at": "2026-08-22T09:20:00Z"}})


class ServersOut(BaseModel):
    servers: list[ServerSummary]
    model_config = ConfigDict(json_schema_extra={"example": {
        "servers": [ServerSummary.model_config["json_schema_extra"]["example"]]}})


class GenerationEventOut(BaseModel):
    stage: str
    level: Literal["info", "warn", "error"]
    message: str
    world_id: str | None = None
    at: str
    model_config = ConfigDict(from_attributes=True, json_schema_extra={"example": {
        "stage": "graph", "level": "info", "message": "Extracted 5 concepts",
        "world_id": "5b3f2a9c1e8b7d4e6f9a0b1c2d3e4f6a", "at": "2026-08-22T09:20:41Z"}})


class ServerProgressOut(BaseModel):
    worlds_total: int
    worlds_ready: int
    worlds_failed: int
    stage: str | None = None
    percent: int
    log: list[GenerationEventOut]
    model_config = ConfigDict(json_schema_extra={"example": {
        "worlds_total": 2, "worlds_ready": 1, "worlds_failed": 0, "stage": "quest",
        "percent": 62, "log": [GenerationEventOut.model_config["json_schema_extra"]["example"]]}})


class WorldSummary(BaseModel):
    id: str
    idx: int
    title: str
    blurb: str | None = None
    status: Literal["pending", "processing", "ready", "failed"]
    stage: str | None = None
    error: str | None = None
    graph_id: str | None = None
    quest_id: str | None = None
    gauntlet_id: str | None = None
    concept_count: int
    scene_count: int
    my_xp: int
    my_completion: float
    model_config = ConfigDict(from_attributes=True, json_schema_extra={"example": {
        "id": "5b3f2a9c1e8b7d4e6f9a0b1c2d3e4f6a", "idx": 0, "title": "The Archivist's Cavern",
        "blurb": "Training data, generalisation and overfitting.", "status": "ready",
        "stage": "done", "error": None, "graph_id": "wk3ml0a1", "quest_id": "q7kp2wm4",
        "gauntlet_id": "g3xn8vr1", "concept_count": 5, "scene_count": 8, "my_xp": 0,
        "my_completion": 0.0}})


class ServerDetail(ServerSummary):
    progress: ServerProgressOut
    worlds: list[WorldSummary]
    model_config = ConfigDict(from_attributes=True, json_schema_extra={"example": {
        **ServerSummary.model_config["json_schema_extra"]["example"],
        "world_count": 2,
        "progress": ServerProgressOut.model_config["json_schema_extra"]["example"],
        "worlds": [WorldSummary.model_config["json_schema_extra"]["example"]]}})


class JoinIn(BaseModel):
    join_code: str = Field(min_length=1, max_length=32)
    model_config = ConfigDict(json_schema_extra={"example": {"join_code": "demo01"}})

    @field_validator("join_code")
    @classmethod
    def _normalize(cls, v: str) -> str:
        return v.strip().upper()


class JoinOut(BaseModel):
    server: ServerSummary
    already_member: bool
    model_config = ConfigDict(json_schema_extra={"example": {
        "server": ServerSummary.model_config["json_schema_extra"]["example"],
        "already_member": False}})


class LeaderboardEntry(BaseModel):
    rank: int
    user_id: str
    display_name: str
    xp: int
    attempts: int
    model_config = ConfigDict(json_schema_extra={"example": {
        "rank": 3, "user_id": "3f2a9c1e8b7d4e6f9a0b1c2d3e4f5a6b", "display_name": "Ada L.",
        "xp": 42, "attempts": 6}})


class LeaderboardOut(BaseModel):
    server_id: str
    me: LeaderboardEntry | None = None
    entries: list[LeaderboardEntry]
    model_config = ConfigDict(json_schema_extra={"example": {
        "server_id": "9c1e8b7d4e6f9a0b1c2d3e4f5a6b3f2a",
        "me": LeaderboardEntry.model_config["json_schema_extra"]["example"],
        "entries": [
            {"rank": 1, "user_id": "0b1c2d3e4f5a6b3f2a9c1e8b7d4e6f9a", "display_name": "Grace",
             "xp": 95, "attempts": 11},
            {"rank": 2, "user_id": "1c2d3e4f5a6b3f2a9c1e8b7d4e6f9a0b", "display_name": "Linus",
             "xp": 60, "attempts": 8},
            LeaderboardEntry.model_config["json_schema_extra"]["example"],
        ]}})


class DistributionOption(BaseModel):
    option_id: str
    text: str
    correct: bool
    misconception_id: str | None = None
    count: int
    pct: int
    model_config = ConfigDict(json_schema_extra={"example": {
        "option_id": "op_same", "text": "It scores about 99 percent again", "correct": False,
        "misconception_id": "high_train_high_test", "count": 14, "pct": 52}})


class DistributionEntry(BaseModel):
    world_id: str
    scene_id: str
    concept_id: str
    options: list[DistributionOption]
    model_config = ConfigDict(json_schema_extra={"example": {
        "world_id": "5b3f2a9c1e8b7d4e6f9a0b1c2d3e4f6a", "scene_id": "sc_pred_overfit",
        "concept_id": "overfitting",
        "options": [
            DistributionOption.model_config["json_schema_extra"]["example"],
            {"option_id": "op_worse", "text": "It scores far worse", "correct": True,
             "count": 11, "pct": 41},
            {"option_id": "op_refuse", "text": "It refuses to answer", "correct": False,
             "misconception_id": "overfitting_is_bad_data", "count": 2, "pct": 7},
        ]}})


class HardestConcept(BaseModel):
    concept_id: str
    label: str
    wrong_pct: int
    model_config = ConfigDict(json_schema_extra={"example": {
        "concept_id": "overfitting", "label": "Overfitting", "wrong_pct": 59}})


class CohortOut(LeaderboardOut):
    members_count: int
    predictions_made: int
    distribution: list[DistributionEntry]
    hardest_concept: HardestConcept | None = None
    model_config = ConfigDict(json_schema_extra={"example": {
        **LeaderboardOut.model_config["json_schema_extra"]["example"],
        "members_count": 27, "predictions_made": 143,
        "distribution": [DistributionEntry.model_config["json_schema_extra"]["example"]],
        "hardest_concept": HardestConcept.model_config["json_schema_extra"]["example"]}})


# ---------------------------------------------------------------- worlds

class GamesOut(BaseModel):
    quest: contracts.Game | None = None
    gauntlet: contracts.Game | None = None
    model_config = ConfigDict(from_attributes=True)


class MyProgress(BaseModel):
    xp: int
    scenes_total: int
    scenes_attempted: int
    scenes_correct: int
    explained_concept_ids: list[str]
    model_config = ConfigDict(json_schema_extra={"example": {
        "xp": 12, "scenes_total": 8, "scenes_attempted": 2, "scenes_correct": 1,
        "explained_concept_ids": ["training_data"]}})


class WorldDetail(WorldSummary):
    server_id: str
    segment_start: int
    segment_end: int
    graph: contracts.CourseGraph | None = None
    games: GamesOut
    my_progress: MyProgress
    model_config = ConfigDict(from_attributes=True, json_schema_extra={"example": {
        **WorldSummary.model_config["json_schema_extra"]["example"],
        "my_xp": 12, "my_completion": 0.25,
        "server_id": "9c1e8b7d4e6f9a0b1c2d3e4f5a6b3f2a", "segment_start": 0, "segment_end": 14,
        "graph": None, "games": {"quest": None, "gauntlet": None},
        "my_progress": MyProgress.model_config["json_schema_extra"]["example"]}})


class AttemptIn(BaseModel):
    archetype: Literal["quest", "gauntlet"]
    scene_id: str
    option_id: str
    model_config = ConfigDict(json_schema_extra={"example": {
        "archetype": "quest", "scene_id": "sc_pred_overfit", "option_id": "op_same"}})


class MisconceptionOut(BaseModel):
    id: str
    statement: str
    correction: str
    model_config = ConfigDict(json_schema_extra={"example": {
        "id": "high_train_high_test",
        "statement": "99 percent on training means roughly 99 percent on new data.",
        "correction": "The two scores decouple once the model starts fitting noise. A "
                      "near-perfect training score with no validation check is the classic "
                      "warning sign, not a result."}})


class AttemptOut(BaseModel):
    attempt_id: str
    correct: bool
    xp_awarded: int
    first_time: bool
    misconception: MisconceptionOut | None = None
    reveal: str
    world_xp: int
    server_xp: int
    model_config = ConfigDict(json_schema_extra={"example": {
        "attempt_id": "7d4e6f9a0b1c2d3e4f5a6b3f2a9c1e8b", "correct": False, "xp_awarded": 2,
        "first_time": True,
        "misconception": MisconceptionOut.model_config["json_schema_extra"]["example"],
        "reveal": "Far worse, and the training score gave no warning. It kept climbing while "
                  "performance on unseen data fell, because the model was fitting the noise "
                  "in its own study book. That widening gap is the signature of overfitting.",
        "world_xp": 14, "server_xp": 14}})


class SceneProgress(BaseModel):
    scene_id: str
    archetype: Literal["quest", "gauntlet"]
    attempts: int
    best_correct: bool
    chosen_option_id: str | None = None
    model_config = ConfigDict(json_schema_extra={"example": {
        "scene_id": "sc_pred_overfit", "archetype": "quest", "attempts": 2,
        "best_correct": True, "chosen_option_id": "op_same"}})


class ExplanationProgress(BaseModel):
    concept_id: str
    score: int
    verdict: Literal["pass", "partial", "fail"]
    created_at: str
    model_config = ConfigDict(json_schema_extra={"example": {
        "concept_id": "training_data", "score": 78, "verdict": "pass",
        "created_at": "2026-08-22T10:02:11Z"}})


class ProgressOut(BaseModel):
    world_id: str
    xp: int
    scenes: list[SceneProgress]
    explanations: list[ExplanationProgress]
    model_config = ConfigDict(json_schema_extra={"example": {
        "world_id": "5b3f2a9c1e8b7d4e6f9a0b1c2d3e4f6a", "xp": 37,
        "scenes": [SceneProgress.model_config["json_schema_extra"]["example"]],
        "explanations": [ExplanationProgress.model_config["json_schema_extra"]["example"]]}})


class ExplainIn(BaseModel):
    concept_id: str
    text: str = Field(min_length=20, max_length=4000)
    model_config = ConfigDict(json_schema_extra={"example": {
        "concept_id": "overfitting",
        "text": "Overfitting is when the model learns the noise in the training set, so "
                "training error keeps dropping but error on new data goes up."}})


class ConceptOut(BaseModel):
    id: str
    label: str
    summary: str
    model_config = ConfigDict(json_schema_extra={"example": {
        "id": "overfitting", "label": "Overfitting",
        "summary": "A model overfits when it captures noise specific to the training set. "
                   "Training error keeps falling while error on new data rises."}})


class ExplainOut(BaseModel):
    score: int
    verdict: Literal["pass", "partial", "fail"]
    xp_awarded: int
    feedback: str
    misconception_id: str | None = None
    concept: ConceptOut
    world_xp: int
    server_xp: int
    model_config = ConfigDict(json_schema_extra={"example": {
        "score": 82, "verdict": "pass", "xp_awarded": 25,
        "feedback": "You named the mechanism (fitting noise) and the signature (train/"
                    "validation gap). Mention that capacity, not data quality, is the cause.",
        "misconception_id": None,
        "concept": ConceptOut.model_config["json_schema_extra"]["example"],
        "world_xp": 62, "server_xp": 62}})


class ExplainTurn(BaseModel):
    """One line of the Socratic transcript. `learner` is the student playing;
    `student` is the AI that keeps asking why."""
    role: Literal["learner", "student"]
    text: str = Field(min_length=1, max_length=1200)
    model_config = ConfigDict(json_schema_extra={"example": {
        "role": "learner",
        "text": "Overfitting is when a model learns the training data too well."}})


class ExplainChatIn(BaseModel):
    """The whole conversation, every time: the server keeps no chat state, so
    the client owns the transcript and the endpoint is a pure function of it.
    Only `learner` turns are ever scored."""
    concept_id: str
    turns: list[ExplainTurn] = Field(min_length=1, max_length=12)
    model_config = ConfigDict(json_schema_extra={"example": {
        "concept_id": "overfitting",
        "turns": [
            {"role": "learner",
             "text": "Overfitting is when a model learns the training data too well."},
            {"role": "student",
             "text": "Wait — I thought 99 percent on training means roughly 99 percent on "
                     "new data. Why is that not right?"},
            {"role": "learner",
             "text": "The two scores decouple once the model starts fitting noise: training "
                     "error keeps falling while the error on new data rises."},
        ]}})

    @field_validator("turns")
    @classmethod
    def _check_transcript(cls, v: list[ExplainTurn]) -> list[ExplainTurn]:
        if v[-1].role != "learner":
            raise ValueError("the last turn must be the learner's")
        if sum(len(t.text) for t in v) > 8000:
            raise ValueError("transcript must be at most 8000 characters")
        learner_text = " ".join(t.text for t in v if t.role == "learner").strip()
        if len(learner_text) < 20:
            raise ValueError("say at least 20 characters in your own words")
        return v


class ExplainChatOut(BaseModel):
    """`question` is what the AI student says next (null once it is done);
    `result` is the graded ExplainOut, present only on the final turn — that is
    the only turn that writes anything or awards XP."""
    done: bool
    understanding: int
    question: str | None = None
    targeted_misconception_id: str | None = None
    turns_remaining: int
    result: ExplainOut | None = None
    model_config = ConfigDict(json_schema_extra={"example": {
        "done": False, "understanding": 47,
        "question": "Wait — I thought 99 percent on training means roughly 99 percent on new "
                    "data. Why is that not right?",
        "targeted_misconception_id": "high_train_high_test",
        "turns_remaining": 3, "result": None}})
