"""MiniMax through its Anthropic-compatible endpoint, via the `anthropic` SDK.

Two entry points: `call_text` (raw string) and `call_json` (dict, with one
repair round-trip if the first answer is not parseable). An empty LLM_API_KEY
raises FixtureMode so callers can fall back to the hand-written fixtures.
"""
import json
import logging
import re
import time

import anthropic

from app.config import get_settings

log = logging.getLogger("classquest.llm")
settings = get_settings()

_REPAIR_RAW_LIMIT = 4000


class FixtureMode(Exception):
    """No API key configured: serve fixtures instead of calling the model."""


class LLMFormatError(Exception):
    """The model answered, but not with the JSON object we asked for."""


def describe_api_error(error: Exception) -> str:
    """One sentence, safe to show, for the handful of failures that actually
    happen on a demo day.

    Everything else falls through to the exception class name — still no JSON,
    still no request id, and the full error is in the log line above the raise.
    """
    status = getattr(error, "status_code", None)
    if status == 429:
        return "the model is out of quota right now"
    if status in (401, 403):
        return "the model rejected our key"
    if status is not None and 500 <= status < 600:
        return "the model is having trouble right now"
    if isinstance(error, anthropic.APITimeoutError):
        return "the model took too long to answer"
    if isinstance(error, anthropic.APIConnectionError):
        return "the model could not be reached"
    return type(error).__name__


class LLMError(Exception):
    """Transport/API failure (timeout, connection, 4xx/5xx)."""


def _client(timeout: float) -> anthropic.Anthropic:
    # MiniMax authenticates with the `x-api-key` header, which is what
    # `api_key=` sets. `auth_token=` would send `Authorization: Bearer ...`
    # and MiniMax rejects that. Never switch these two.
    return anthropic.Anthropic(
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
        timeout=timeout,
        max_retries=1,
    )


def _create(
    messages: list[dict],
    *,
    system: str,
    max_tokens: int,
    timeout: float | None,
    temperature: float | None,
    prefill: str | None,
) -> str:
    """Low-level call with a full `messages` list. Returns prefill + text blocks."""
    if not settings.llm_enabled:
        raise FixtureMode("LLM_API_KEY is empty")
    msgs = list(messages)
    if prefill:
        msgs.append({"role": "assistant", "content": prefill})
    kwargs: dict = {
        "model": settings.llm_model,
        "system": system,
        "max_tokens": max_tokens,
        "messages": msgs,
    }
    if temperature is not None:
        kwargs["temperature"] = temperature

    client = _client(timeout if timeout is not None else settings.llm_timeout_s)
    t0 = time.perf_counter()
    try:
        resp = client.messages.create(**kwargs)
    except anthropic.APIError as e:  # includes APIConnectionError / APITimeoutError
        # The provider's own message is a JSON blob with a request id in it, and
        # `World.error` is served straight to whoever opens the server. Log the
        # whole thing, raise one sentence a learner can act on.
        log.warning("llm call failed: %s: %s", type(e).__name__, e)
        raise LLMError(describe_api_error(e)) from e
    latency_ms = int((time.perf_counter() - t0) * 1000)

    usage = getattr(resp, "usage", None)
    log.info(
        "llm model=%s latency_ms=%d input_tokens=%s output_tokens=%s",
        settings.llm_model,
        latency_ms,
        getattr(usage, "input_tokens", None),
        getattr(usage, "output_tokens", None),
    )
    text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
    return (prefill or "") + text


def call_text(
    system: str,
    user: str,
    *,
    max_tokens: int,
    timeout: float | None = None,
    temperature: float | None = None,
    prefill: str | None = None,
) -> str:
    return _create(
        [{"role": "user", "content": user}],
        system=system,
        max_tokens=max_tokens,
        timeout=timeout,
        temperature=temperature,
        prefill=prefill,
    )


# --- JSON extraction -------------------------------------------------------

_FENCE = re.compile(r"```(?:json|JSON)?\s*(.*?)```", re.DOTALL)
_TRAILING_COMMA = re.compile(r",\s*([}\]])")


def _balanced_object(text: str) -> str | None:
    """First balanced top-level {...}, honouring string literals and escapes."""
    start = text.find("{")
    while start != -1:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(text)):
            c = text[i]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
            elif c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return text[start : i + 1]
        start = text.find("{", start + 1)
    return None


def _candidates(text: str) -> list[str]:
    out: list[str] = [text.strip()]
    m = _FENCE.search(text)
    if m:
        out.append(m.group(1).strip())
    first, last = text.find("{"), text.rfind("}")
    if first != -1 and last > first:
        out.append(text[first : last + 1])
    balanced = _balanced_object(text)
    if balanced:
        out.append(balanced)
    # Same candidates again with trailing commas removed, as a last resort.
    out.extend(_TRAILING_COMMA.sub(r"\1", c) for c in list(out))
    seen: set[str] = set()
    uniq = []
    for c in out:
        if c and c not in seen:
            seen.add(c)
            uniq.append(c)
    return uniq


def extract_json(text: str) -> dict:
    """Tolerant parse of a model answer into a dict. Raises LLMFormatError."""
    last = "no JSON object found"
    for i, candidate in enumerate(_candidates(text)):
        try:
            obj = json.loads(candidate)
        except json.JSONDecodeError as e:
            last = str(e)
            continue
        if isinstance(obj, dict):
            return obj
        last = f"top-level JSON is a {type(obj).__name__}, expected an object"
        if i == 0:
            # The whole answer is valid JSON of the wrong shape; do not dig
            # for an object nested inside it.
            break
    raise LLMFormatError(last)


def call_json(
    system: str,
    user: str,
    *,
    max_tokens: int,
    timeout: float | None = None,
    temperature: float | None = None,
) -> dict:
    """Ask for a JSON object. One repair round-trip if the first answer is bad."""
    messages = [{"role": "user", "content": user}]
    opts = dict(system=system, max_tokens=max_tokens, timeout=timeout, temperature=temperature)
    raw = _create(messages, prefill="{", **opts)
    try:
        return extract_json(raw)
    except LLMFormatError as first:
        log.warning("llm json parse failed (%s); asking the model to repair", first)
        repair = messages + [
            {"role": "assistant", "content": raw[:_REPAIR_RAW_LIMIT]},
            {
                "role": "user",
                "content": (
                    f"That was not valid JSON: {first}. "
                    "Reply with the corrected JSON object only. Start with { and end with }."
                ),
            },
        ]
        raw2 = _create(repair, prefill="{", **opts)
        return extract_json(raw2)
