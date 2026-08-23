"""Rate limits, for the day the link goes out on a QR code.

In-process on purpose. uvicorn runs with `--workers 1` (see CLAUDE.md), so the
dictionary in this module *is* the whole picture: there is no second worker to
disagree with it, and standing up Redis an hour before a pitch is not a plan.
That single assumption is the one thing to remember — the day a second worker
appears, these numbers become per-worker and the counting has to move to a
shared store.

## What this is actually defending

Not passwords. `services/passwords.py` already refuses the passwords people
pick, and `/auth/login` already spends a constant bcrypt whether or not the
account exists, so guessing is neither cheap nor informative.

The expensive thing is **the model key**. One `POST /servers` starts a daemon
thread that makes dozens of LLM calls, and `/worlds/{id}/explain*` makes one
per turn. Unbounded, those are an unbounded bill on somebody else's credit
card. Everything below is shaped around that.

## Why the limits are shaped the way they are

A classroom is one NAT. Forty people scanning the same QR share one address, so
a strict per-IP cap on *registering* would break the demo rather than defend
it. Hence the shape:

- **generous per IP** where a crowd is expected and the work is cheap
  (register, login, join),
- **strict per user** where the money is (creating a server, grading an
  explanation) — an account is not free to make in bulk once registration is
  limited, so this is the cap that actually holds,
- **a global ceiling** on the one endpoint with no user behind it at all
  (the public demo chat), because a distributed caller has as many IPs as it
  likes but there is only one key to burn.

A token bucket rather than a fixed window: a fixed window lets twice the limit
through across a boundary, and it punishes whoever happens to arrive one second
before the reset.
"""
import threading
import time
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status

from app import models
from app.config import get_settings
from app.deps import current_user_optional


@dataclass(frozen=True)
class Rule:
    """`limit` requests per `per_seconds`, and that many again as burst."""

    limit: int
    per_seconds: float

    def __post_init__(self) -> None:
        if self.limit <= 0 or self.per_seconds <= 0:
            raise ValueError("a rule needs a positive limit over a positive window")

    @property
    def refill_per_second(self) -> float:
        return self.limit / self.per_seconds


class Limiter:
    """One rule, many keys. Pure apart from the clock, which is injectable so
    the tests do not sleep.

    Keys are unbounded in principle — every IP that ever calls gets an entry —
    so a full bucket is dropped once the table grows past `max_keys`. Dropping
    a *full* bucket loses nothing: a fresh key starts full anyway.
    """

    def __init__(self, rule: Rule, *, max_keys: int = 20_000) -> None:
        self.rule = rule
        self.max_keys = max_keys
        self._lock = threading.Lock()
        # key -> (tokens, last_seen_monotonic)
        self._buckets: dict[str, tuple[float, float]] = {}

    def take(self, key: str, *, now: float | None = None, cost: float = 1.0) -> float | None:
        """Spend one token. Returns None when allowed, else seconds to wait."""
        now = time.monotonic() if now is None else now
        capacity = float(self.rule.limit)
        with self._lock:
            tokens, last = self._buckets.get(key, (capacity, now))
            tokens = min(capacity, tokens + max(0.0, now - last) * self.rule.refill_per_second)
            if tokens < cost:
                # Round up: a Retry-After of 0 invites an immediate retry that
                # is guaranteed to fail again.
                wait = (cost - tokens) / self.rule.refill_per_second
                self._buckets[key] = (tokens, now)
                return max(1.0, round(wait, 3))
            self._buckets[key] = (tokens - cost, now)
            if len(self._buckets) > self.max_keys:
                self._prune(now)
            return None

    def _prune(self, now: float) -> None:
        """Caller holds the lock. Drops every key whose bucket has refilled."""
        capacity = float(self.rule.limit)
        self._buckets = {
            key: entry
            for key, entry in self._buckets.items()
            if min(capacity, entry[0] + max(0.0, now - entry[1]) * self.rule.refill_per_second)
            < capacity
        }

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()


# --------------------------------------------------------------- the policy
#
# One table, so the whole posture is readable in one screen. Windows are in
# seconds. These are deliberately loose enough that nobody at the demo will
# ever see a 429, and tight enough that a script cannot spend real money.

LIMITERS: dict[str, Limiter] = {
    # Cheap, and a whole room shares one address. Loose.
    "register": Limiter(Rule(40, 600)),
    "login": Limiter(Rule(60, 600)),
    "join": Limiter(Rule(30, 600)),
    # Per user. Every one of these starts a thread full of model calls, and
    # `max_servers_per_user` is the harder ceiling behind it.
    "create_server": Limiter(Rule(4, 3600)),
    # Per user. One model call each; a human types far slower than this.
    "explain": Limiter(Rule(40, 600)),
    # Per IP, unauthenticated. A room on one NAT still fits comfortably.
    "demo_explain": Limiter(Rule(60, 600)),
    # ...and the ceiling that a room cannot exceed but a botnet would: the
    # public chat has no account behind it, so this is the only thing standing
    # between a distributed caller and the key.
    "demo_explain_global": Limiter(Rule(600, 3600)),
}


def reset_all() -> None:
    """Drop every bucket. For tests; each one gets a clean process worth of state."""
    for limiter in LIMITERS.values():
        limiter.reset()


# ------------------------------------------------------------------- client
#
# Behind Traefik the socket peer is the proxy, so the caller is in
# `X-Forwarded-For`. The *rightmost* entry is the one the closest proxy
# appended and is the only one that is not attacker-controlled: a client that
# sends its own `X-Forwarded-For: 1.2.3.4` just gets its real address appended
# after it. Reading the leftmost — which is what most snippets do — would let
# anyone mint a fresh identity per request and walk straight past every limit
# in the table above.


def client_ip(request: Request) -> str:
    if get_settings().trust_forwarded_for:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
            if hops:
                return hops[-1]
    client = request.client
    return client.host if client else "unknown"


# --------------------------------------------------------------- dependency


class RateLimit:
    """A FastAPI dependency that spends one token or answers 429.

    `by="user"` keys on the account when there is one and falls back to the
    address when there is not, which is what makes a per-user limit meaningful
    on an endpoint that also has to answer anonymous callers.
    """

    def __init__(self, name: str, *, by: str = "ip", also: str | None = None) -> None:
        self.name = name
        self.by = by
        #: A second, usually global, limiter charged for the same request.
        self.also = also

    def __call__(
        self,
        request: Request,
        user: models.User | None = Depends(current_user_optional),
    ) -> None:
        if not get_settings().rate_limit_enabled:
            return
        key = f"user:{user.id}" if (self.by == "user" and user is not None) else f"ip:{client_ip(request)}"
        for name, bucket_key in ((self.name, key), (self.also, "global")):
            if name is None:
                continue
            wait = LIMITERS[name].take(bucket_key)
            if wait is not None:
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    "Too many requests. Wait a moment and try again.",
                    headers={"Retry-After": str(int(wait) + 1)},
                )
