"""The token bucket, the address it keys on, and the 429 the routes answer.

The clock is injected everywhere in the pure tests: a rate-limit suite that
sleeps is a rate-limit suite nobody runs.
"""
import pytest
from fastapi import FastAPI, Request

from app.ratelimit import LIMITERS, Limiter, RateLimit, Rule, client_ip

# ------------------------------------------------------------------ the rule


def test_rule_refill_is_the_limit_spread_over_the_window():
    assert Rule(60, 600).refill_per_second == pytest.approx(0.1)


@pytest.mark.parametrize("limit,window", [(0, 60), (-1, 60), (10, 0), (10, -5)])
def test_rule_refuses_nonsense(limit, window):
    with pytest.raises(ValueError):
        Rule(limit, window)


# ---------------------------------------------------------------- the bucket


def test_bucket_allows_exactly_the_limit_then_refuses():
    limiter = Limiter(Rule(3, 60))
    assert [limiter.take("a", now=0.0) for _ in range(3)] == [None, None, None]
    assert limiter.take("a", now=0.0) is not None


def test_refusal_reports_a_wait_that_is_actually_long_enough():
    limiter = Limiter(Rule(3, 60))
    for _ in range(3):
        limiter.take("a", now=0.0)
    wait = limiter.take("a", now=0.0)
    assert wait is not None
    # Waiting exactly that long buys a token, and no less does.
    assert limiter.take("a", now=wait - 0.001) is not None
    assert limiter.take("a", now=wait) is None


def test_wait_is_never_below_a_second():
    """A Retry-After of 0 is an invitation to hammer the endpoint."""
    limiter = Limiter(Rule(600, 60))  # refills ten times a second
    for _ in range(600):
        limiter.take("a", now=0.0)
    assert limiter.take("a", now=0.0) >= 1.0


def test_keys_do_not_share_a_bucket():
    limiter = Limiter(Rule(1, 60))
    assert limiter.take("a", now=0.0) is None
    assert limiter.take("b", now=0.0) is None
    assert limiter.take("a", now=0.0) is not None


def test_tokens_come_back_gradually_rather_than_all_at_once():
    limiter = Limiter(Rule(10, 100))  # one token every ten seconds
    for _ in range(10):
        limiter.take("a", now=0.0)
    assert limiter.take("a", now=5.0) is not None
    assert limiter.take("a", now=10.0) is None
    assert limiter.take("a", now=10.0) is not None


def test_a_bucket_never_refills_past_its_capacity():
    """An idle hour does not buy a burst of an hour's worth of requests."""
    limiter = Limiter(Rule(5, 60))
    limiter.take("a", now=0.0)
    assert [limiter.take("a", now=100_000.0) for _ in range(5)] == [None] * 5
    assert limiter.take("a", now=100_000.0) is not None


def test_full_buckets_are_pruned_so_the_table_cannot_grow_without_bound():
    limiter = Limiter(Rule(2, 10), max_keys=8)
    for i in range(50):
        limiter.take(f"ip-{i}", now=float(i) * 60)  # each long since refilled
    assert len(limiter._buckets) <= 8


def test_pruning_keeps_the_keys_that_are_still_spending():
    limiter = Limiter(Rule(2, 10), max_keys=4)
    for _ in range(2):
        limiter.take("heavy", now=0.0)
    for i in range(20):
        limiter.take(f"ip-{i}", now=0.0)
    # `heavy` is out of tokens at t=0, so dropping it would hand it a free reset.
    assert limiter.take("heavy", now=0.0) is not None


def test_reset_clears_every_bucket():
    limiter = Limiter(Rule(1, 60))
    limiter.take("a", now=0.0)
    limiter.reset()
    assert limiter.take("a", now=0.0) is None


# ------------------------------------------------------------- the caller's ip


def _request(headers: dict[str, str], peer: str | None = "10.0.0.9") -> Request:
    scope = {
        "type": "http",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": (peer, 1234) if peer else None,
    }
    return Request(scope)


def test_ip_comes_from_the_socket_when_there_is_no_proxy_header():
    assert client_ip(_request({})) == "10.0.0.9"


def test_ip_is_the_rightmost_forwarded_hop():
    """The one entry the caller could not have written themselves."""
    req = _request({"x-forwarded-for": "1.2.3.4, 203.0.113.7"})
    assert client_ip(req) == "203.0.113.7"


def test_a_spoofed_forwarded_header_cannot_mint_a_new_identity():
    a = client_ip(_request({"x-forwarded-for": "spoof-1, 203.0.113.7"}))
    b = client_ip(_request({"x-forwarded-for": "spoof-2, 203.0.113.7"}))
    assert a == b == "203.0.113.7"


def test_forwarded_header_is_ignored_when_the_setting_is_off(monkeypatch, settings):
    monkeypatch.setattr(settings, "trust_forwarded_for", False)
    assert client_ip(_request({"x-forwarded-for": "1.2.3.4"})) == "10.0.0.9"


def test_a_client_with_no_peer_still_gets_a_key():
    assert client_ip(_request({}, peer=None)) == "unknown"


# --------------------------------------------------------------- the 429


def _app_with_limit(**kwargs) -> FastAPI:
    from fastapi import Depends

    app = FastAPI()

    @app.get("/thing", dependencies=[Depends(RateLimit(**kwargs))])
    def thing():
        return {"ok": True}

    return app


def test_route_answers_429_with_a_retry_after_header(monkeypatch, settings):
    from fastapi.testclient import TestClient

    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setitem(LIMITERS, "probe", Limiter(Rule(2, 600)))
    client = TestClient(_app_with_limit(name="probe"))

    assert client.get("/thing").status_code == 200
    assert client.get("/thing").status_code == 200
    refused = client.get("/thing")
    assert refused.status_code == 429
    assert int(refused.headers["retry-after"]) >= 1


def test_the_global_companion_limiter_is_charged_too(monkeypatch, settings):
    from fastapi.testclient import TestClient

    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setitem(LIMITERS, "probe", Limiter(Rule(50, 600)))
    monkeypatch.setitem(LIMITERS, "probe_all", Limiter(Rule(1, 600)))
    client = TestClient(_app_with_limit(name="probe", also="probe_all"))

    assert client.get("/thing").status_code == 200
    assert client.get("/thing").status_code == 429


def test_the_switch_turns_the_whole_thing_off(monkeypatch, settings):
    from fastapi.testclient import TestClient

    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    monkeypatch.setitem(LIMITERS, "probe", Limiter(Rule(1, 600)))
    client = TestClient(_app_with_limit(name="probe"))

    assert [client.get("/thing").status_code for _ in range(5)] == [200] * 5
