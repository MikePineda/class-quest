"""The abuse controls, at the routes that carry them.

`tests/test_ratelimit.py` covers the bucket itself. This file covers the
wiring: that the limits are attached to the endpoints that spend money, that
the ceilings around generation hold, and that the public demo chat is both
open and bounded.

Limits are off for the rest of the suite (see `conftest.py`); every test here
turns them back on for itself.
"""
import pytest

from app import models
from app.db import SessionLocal
from app.services import generate


@pytest.fixture
def limits_on(monkeypatch, settings):
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    return settings


def _register(client, email="owner@example.com", name="Owner"):
    r = client.post("/auth/register", json={
        "email": email, "password": "thistle marmalade rowboat", "display_name": name,
    })
    assert r.status_code == 201, r.text
    return r.json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _create(client, token, name="Course"):
    return client.post(
        "/servers",
        data={"name": name, "pet": "owl", "is_public": "true",
              "text": "The training set teaches the model. " * 20},
        headers=_auth(token),
    )


# ------------------------------------------------------------------- limits


def test_registration_is_limited_per_address(client, limits_on, monkeypatch):
    from app.ratelimit import LIMITERS, Limiter, Rule

    monkeypatch.setitem(LIMITERS, "register", Limiter(Rule(2, 600)))
    assert client.post("/auth/register", json={
        "email": "a@example.com", "password": "thistle marmalade rowboat",
        "display_name": "A"}).status_code == 201
    assert client.post("/auth/register", json={
        "email": "b@example.com", "password": "thistle marmalade rowboat",
        "display_name": "B"}).status_code == 201
    refused = client.post("/auth/register", json={
        "email": "c@example.com", "password": "thistle marmalade rowboat",
        "display_name": "C"})
    assert refused.status_code == 429
    assert "Retry-After" in refused.headers


def test_login_is_limited_per_address(client, limits_on, monkeypatch):
    from app.ratelimit import LIMITERS, Limiter, Rule

    _register(client)
    monkeypatch.setitem(LIMITERS, "login", Limiter(Rule(3, 600)))
    body = {"email": "owner@example.com", "password": "wrong wrong wrong"}
    codes = [client.post("/auth/login", json=body).status_code for _ in range(4)]
    assert codes == [401, 401, 401, 429]


def test_creating_a_course_is_limited_per_account_not_per_address(client, limits_on, monkeypatch):
    """Two accounts behind one NAT must not share a budget: that is a classroom."""
    from app.ratelimit import LIMITERS, Limiter, Rule

    monkeypatch.setattr(generate, "run_pipeline", lambda server_id: None)
    monkeypatch.setitem(LIMITERS, "create_server", Limiter(Rule(1, 3600)))

    first = _register(client, "one@example.com", "One")
    second = _register(client, "two@example.com", "Two")

    assert _create(client, first).status_code == 201
    assert _create(client, first, name="Again").status_code == 429
    # Same address, different account: unaffected.
    assert _create(client, second).status_code == 201


def test_an_account_may_not_own_more_courses_than_the_cap(client, limits_on, monkeypatch):
    monkeypatch.setattr(generate, "run_pipeline", lambda server_id: None)
    monkeypatch.setattr(limits_on, "max_servers_per_user", 2)
    token = _register(client)

    assert _create(client, token, name="One").status_code == 201
    assert _create(client, token, name="Two").status_code == 201
    refused = _create(client, token, name="Three")
    assert refused.status_code == 409
    assert "limit" in refused.json()["detail"]


def test_joining_a_course_does_not_count_against_the_owner_cap(client, limits_on, monkeypatch):
    """The cap is on generating worlds, not on being in a class."""
    monkeypatch.setattr(limits_on, "max_servers_per_user", 1)
    monkeypatch.setattr(generate, "run_pipeline", lambda server_id: None)

    owner = _register(client, "owner@example.com", "Owner")
    created = _create(client, owner)
    assert created.status_code == 201
    code = created.json()["join_code"]

    member = _register(client, "member@example.com", "Member")
    assert client.post("/servers/join", json={"join_code": code},
                       headers=_auth(member)).status_code == 200
    # ...and they can still make their own one course.
    assert _create(client, member, name="Mine").status_code == 201


# -------------------------------------------------------- generator capacity


def test_a_full_generator_refuses_before_it_reads_the_upload(client, limits_on, monkeypatch):
    monkeypatch.setattr(generate, "has_capacity", lambda: False)
    token = _register(client)
    refused = _create(client, token)
    assert refused.status_code == 503
    assert refused.headers["Retry-After"] == "60"


def test_start_pipeline_refuses_past_the_concurrency_cap(monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "max_concurrent_generations", 2)
    monkeypatch.setattr(generate, "run_pipeline", lambda server_id: None)
    generate._inflight.clear()
    generate._inflight.update({"a", "b"})
    try:
        assert generate.has_capacity() is False
        with pytest.raises(generate.GeneratorBusy):
            generate.start_pipeline("c")
    finally:
        generate._inflight.clear()


def test_a_course_that_loses_the_last_slot_is_marked_failed_not_left_processing(
    client, limits_on, monkeypatch
):
    """The row is already committed by then, so it has to be told the truth."""
    def busy(server_id):
        raise generate.GeneratorBusy("full")

    monkeypatch.setattr(generate, "has_capacity", lambda: True)
    monkeypatch.setattr(generate, "start_pipeline", busy)
    token = _register(client)
    created = _create(client, token)
    assert created.status_code == 201
    assert created.json()["status"] == "failed"
    assert "busy" in created.json()["error"].lower()


# ------------------------------------------------------- oversized metadata


def test_an_absurd_course_name_is_refused(client, limits_on, monkeypatch):
    monkeypatch.setattr(generate, "run_pipeline", lambda server_id: None)
    token = _register(client)
    r = client.post(
        "/servers",
        data={"name": "x" * 5000, "pet": "owl", "is_public": "true",
              "text": "The training set teaches the model. " * 20},
        headers=_auth(token),
    )
    assert r.status_code == 422


# ----------------------------------------------------------- the demo chat


def _demo_body(**overrides):
    return {
        "bundle": "pybasics",
        "concept_id": "variables",
        "turns": [{"role": "learner", "text": "A variable is a name bound to a value in memory."}],
        **overrides,
    }


def _first_concept_id(bundle="pybasics"):
    from app.services import fixtures

    return fixtures.load_bundle(bundle).graph["concepts"][0]["id"]


def test_the_demo_chat_answers_without_an_account(client, limits_on):
    r = client.post("/demo/explain/turn", json=_demo_body(concept_id=_first_concept_id()))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["question"] or body["done"]
    assert 0 <= body["understanding"] <= 100


def test_the_demo_chat_never_awards_anything(client, limits_on):
    """It writes no row, so any non-zero number would be a lie."""
    turns = [{"role": "learner", "text": "A variable is a name bound to a value in memory. "
                                         "Assigning rebinds the name, it does not copy."}]
    concept = _first_concept_id()
    for _ in range(8):
        r = client.post("/demo/explain/turn",
                        json=_demo_body(concept_id=concept, turns=turns))
        assert r.status_code == 200, r.text
        body = r.json()
        if body["done"]:
            assert body["result"]["xp_awarded"] == 0
            assert body["result"]["world_xp"] == 0
            assert body["result"]["server_xp"] == 0
            break
        turns = turns + [
            {"role": "student", "text": body["question"]},
            {"role": "learner", "text": "It names a value so later lines can refer to it, "
                                        "and rebinding the name changes what it refers to."},
        ]
    else:
        pytest.fail("the student never finished")


def test_the_demo_chat_writes_nothing(client, limits_on):
    client.post("/demo/explain/turn", json=_demo_body(concept_id=_first_concept_id()))
    with SessionLocal() as db:
        assert db.query(models.Explanation).count() == 0
        assert db.query(models.Attempt).count() == 0


def test_the_demo_chat_only_knows_bundles_that_exist(client, limits_on):
    r = client.post("/demo/explain/turn", json=_demo_body(bundle="anything-i-like"))
    assert r.status_code == 422


def test_the_demo_chat_refuses_a_concept_it_does_not_have(client, limits_on):
    r = client.post("/demo/explain/turn", json=_demo_body(concept_id="not-a-concept"))
    assert r.status_code == 404


def test_the_demo_chat_is_limited_per_address(client, limits_on, monkeypatch):
    from app.ratelimit import LIMITERS, Limiter, Rule

    monkeypatch.setitem(LIMITERS, "demo_explain", Limiter(Rule(2, 600)))
    body = _demo_body(concept_id=_first_concept_id())
    codes = [client.post("/demo/explain/turn", json=body).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_the_demo_chat_has_a_ceiling_no_number_of_addresses_can_pass(
    client, limits_on, monkeypatch
):
    """The one endpoint with no account behind it, so the address is not a limit."""
    from app.ratelimit import LIMITERS, Limiter, Rule

    monkeypatch.setitem(LIMITERS, "demo_explain", Limiter(Rule(100, 600)))
    monkeypatch.setitem(LIMITERS, "demo_explain_global", Limiter(Rule(2, 3600)))
    body = _demo_body(concept_id=_first_concept_id())
    codes = [
        client.post("/demo/explain/turn", json=body,
                    headers={"X-Forwarded-For": f"198.51.100.{i}"}).status_code
        for i in range(3)
    ]
    assert codes == [200, 200, 429]


# ------------------------------------------------------------------ headers


def test_every_response_carries_the_cheap_headers(client):
    r = client.get("/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "no-referrer"


# ------------------------------------------------------- ownership, re-checked


def test_a_member_still_cannot_delete_someone_elses_course(client, monkeypatch):
    """Not new, but it is what the QR link makes worth pinning down."""
    monkeypatch.setattr(generate, "run_pipeline", lambda server_id: None)
    owner = _register(client, "owner@example.com", "Owner")
    created = _create(client, owner)
    server_id = created.json()["id"]
    code = created.json()["join_code"]

    member = _register(client, "member@example.com", "Member")
    client.post("/servers/join", json={"join_code": code}, headers=_auth(member))
    assert client.delete(f"/servers/{server_id}", headers=_auth(member)).status_code == 403
