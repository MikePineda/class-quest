"""The schema is the contract with the FE: assert the tables and the
constraints that the API relies on actually exist."""
import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from app import models
from app.db import SessionLocal, engine
from app.ids import new_id, utc_now_iso

EXPECTED_TABLES = {
    "users", "servers", "memberships", "documents", "segments",
    "worlds", "attempts", "explanations", "generation_events",
}


def test_all_tables_exist():
    assert EXPECTED_TABLES <= set(inspect(engine).get_table_names())


def test_users_have_no_pet_column():
    # The pet is the server mascot that asks the questions, not a user avatar.
    cols = {c["name"] for c in inspect(engine).get_columns("users")}
    assert "pet" not in cols
    assert {"email", "password_hash", "display_name", "role", "industry", "about"} <= cols


def test_membership_is_unique_per_user_and_server():
    with SessionLocal() as db:
        u = models.User(id=new_id(), email="a@b.c", password_hash="x",
                        display_name="A", created_at=utc_now_iso())
        s = models.Server(id=new_id(), name="S", join_code="ABCDEF", is_public=False,
                          pet="owl", owner_id=u.id, status="pending",
                          segment_count=0, created_at=utc_now_iso())
        db.add(u)
        db.flush()  # no relationship() on the models: flush parents explicitly
        db.add(s)
        db.flush()
        db.add(models.Membership(id=new_id(), user_id=u.id, server_id=s.id,
                                 role="owner", joined_at=utc_now_iso()))
        db.flush()
        db.add(models.Membership(id=new_id(), user_id=u.id, server_id=s.id,
                                 role="member", joined_at=utc_now_iso()))
        with pytest.raises(IntegrityError):
            db.flush()


def test_segment_seq_is_unique_per_server():
    with SessionLocal() as db:
        u = models.User(id=new_id(), email="a@b.c", password_hash="x",
                        display_name="A", created_at=utc_now_iso())
        s = models.Server(id=new_id(), name="S", join_code="ABCDEF", is_public=False,
                          pet="owl", owner_id=u.id, status="pending",
                          segment_count=0, created_at=utc_now_iso())
        d = models.Document(id=new_id(), server_id=s.id, filename="a.txt",
                            content_type="text/plain", char_count=10, created_at=utc_now_iso())
        db.add(u)
        db.flush()
        db.add(s)
        db.flush()
        db.add(d)
        db.flush()
        db.add(models.Segment(id=new_id(), server_id=s.id, document_id=d.id, seq=0, text="a"))
        db.flush()
        db.add(models.Segment(id=new_id(), server_id=s.id, document_id=d.id, seq=0, text="b"))
        with pytest.raises(IntegrityError):
            db.flush()


def test_sqlite_pragmas_applied():
    with engine.connect() as conn:
        assert conn.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
        assert conn.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
