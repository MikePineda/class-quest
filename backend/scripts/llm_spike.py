"""Hour-0 smoke test: one real JSON call to MiniMax.

    cd backend && .venv/bin/python -m scripts.llm_spike

Reads LLM_API_KEY / LLM_BASE_URL / LLM_MODEL from the environment or .env.
Exits 1 with a readable message when the key is missing or the call fails.
"""
import logging
import sys
import time

from app.config import get_settings
from app.services import llm

SYSTEM = "You are a terse assistant. Answer with a single JSON object and nothing else."
USER = (
    'Reply with exactly this shape: {"ok": true, "model_says": "<one short sentence>"}. '
    "The sentence should say hello to ClassQuest."
)


def main() -> int:
    # INFO so the llm module's latency/token log line shows up on stderr.
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    s = get_settings()
    print(f"model     = {s.llm_model}")
    print(f"base_url  = {s.llm_base_url}")
    if not s.llm_enabled:
        print("LLM_API_KEY is empty. Put it in backend/.env or the environment.", file=sys.stderr)
        return 1

    t0 = time.perf_counter()
    try:
        result = llm.call_json(SYSTEM, USER, max_tokens=200, timeout=60.0)
    except llm.LLMError as e:
        print(f"LLM call failed (transport/API): {e}", file=sys.stderr)
        return 1
    except llm.LLMFormatError as e:
        print(f"LLM answered but not with valid JSON, even after repair: {e}", file=sys.stderr)
        return 1
    latency_ms = int((time.perf_counter() - t0) * 1000)

    print(f"latency   = {latency_ms} ms (token usage is in the INFO log line above)")
    print(f"raw result= {result!r}")
    if result.get("ok") is not True or not isinstance(result.get("model_says"), str):
        print("Shape mismatch: expected {'ok': true, 'model_says': '...'}", file=sys.stderr)
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
