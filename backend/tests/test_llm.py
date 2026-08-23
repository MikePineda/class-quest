"""LLM client tests. No network: `_client` is replaced with a fake whose
`messages.create` returns canned text. `settings` is the lru_cached instance,
so the key is patched on that object directly.
"""
from types import SimpleNamespace

import anthropic
import httpx
import pytest

from app.services import llm


class _FakeMessages:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text=item)],
            usage=SimpleNamespace(input_tokens=1, output_tokens=1),
        )


class _FakeClient:
    def __init__(self, responses):
        self.messages = _FakeMessages(responses)


@pytest.fixture
def llm_on(monkeypatch):
    monkeypatch.setattr(llm.settings, "llm_api_key", "test-key")


def _install(monkeypatch, *responses) -> _FakeClient:
    fake = _FakeClient(responses)
    monkeypatch.setattr(llm, "_client", lambda timeout: fake)
    return fake


# --- call_text -------------------------------------------------------------


def test_fixture_mode_when_key_empty(monkeypatch):
    monkeypatch.setattr(llm.settings, "llm_api_key", "")

    def boom(timeout):
        raise AssertionError("client must not be built in fixture mode")

    monkeypatch.setattr(llm, "_client", boom)
    with pytest.raises(llm.FixtureMode):
        llm.call_text("sys", "user", max_tokens=10)


def test_call_text_returns_text_and_sends_messages(monkeypatch, llm_on):
    fake = _install(monkeypatch, "hello there")
    out = llm.call_text("sys prompt", "user prompt", max_tokens=42, temperature=0.2)
    assert out == "hello there"
    call = fake.messages.calls[0]
    assert call["model"] == llm.settings.llm_model
    assert call["system"] == "sys prompt"
    assert call["max_tokens"] == 42
    assert call["temperature"] == 0.2
    assert call["messages"] == [{"role": "user", "content": "user prompt"}]


def test_prefill_is_sent_and_prepended(monkeypatch, llm_on):
    fake = _install(monkeypatch, '"ok": true}')
    out = llm.call_text("s", "u", max_tokens=10, prefill="{")
    assert out == '{"ok": true}'
    msgs = fake.messages.calls[0]["messages"]
    assert msgs[-1] == {"role": "assistant", "content": "{"}


def test_api_connection_error_becomes_llm_error(monkeypatch, llm_on):
    err = anthropic.APIConnectionError(request=httpx.Request("POST", "https://example.invalid"))
    _install(monkeypatch, err)
    with pytest.raises(llm.LLMError):
        llm.call_text("s", "u", max_tokens=10)


def test_client_uses_api_key_not_bearer_token(monkeypatch, llm_on):
    captured = {}

    class FakeAnthropic:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(llm.anthropic, "Anthropic", FakeAnthropic)
    llm._client(7.5)
    assert captured["api_key"] == "test-key"
    assert "auth_token" not in captured
    assert captured["base_url"] == llm.settings.llm_base_url
    assert captured["timeout"] == 7.5
    assert captured["max_retries"] == 1


# --- extract_json ----------------------------------------------------------


def test_extract_clean_json():
    assert llm.extract_json('{"a": 1, "b": [1, 2]}') == {"a": 1, "b": [1, 2]}


def test_extract_fenced_json():
    text = 'Here you go:\n```json\n{"a": 1}\n```\nDone.'
    assert llm.extract_json(text) == {"a": 1}


def test_extract_plain_fence():
    assert llm.extract_json('```\n{"a": 2}\n```') == {"a": 2}


def test_extract_prose_then_json():
    assert llm.extract_json('Sure! Here is it:\n{"a": 1}') == {"a": 1}


def test_extract_json_then_trailing_prose_with_braces():
    text = '{"a": 1}\n\nNote: use {braces} carefully.'
    assert llm.extract_json(text) == {"a": 1}


def test_extract_nested_braces_inside_strings():
    assert llm.extract_json('{"a":"}{"}') == {"a": "}{"}
    assert llm.extract_json('Result: {"a":"}{", "b": "x\\"y"} end') == {"a": "}{", "b": 'x"y'}


def test_extract_trailing_commas():
    assert llm.extract_json('{"a": [1, 2,], "b": {"c": 1,},}') == {"a": [1, 2], "b": {"c": 1}}


def test_extract_raises_on_garbage():
    with pytest.raises(llm.LLMFormatError):
        llm.extract_json("no json here at all")


def test_extract_rejects_top_level_list():
    with pytest.raises(llm.LLMFormatError):
        llm.extract_json("[1, 2, 3]")


# --- call_json -------------------------------------------------------------


def test_call_json_first_try(monkeypatch, llm_on):
    fake = _install(monkeypatch, '"ok": true}')
    assert llm.call_json("s", "u", max_tokens=10) == {"ok": True}
    assert len(fake.messages.calls) == 1
    assert fake.messages.calls[0]["messages"][-1] == {"role": "assistant", "content": "{"}


def test_call_json_repairs_once(monkeypatch, llm_on):
    fake = _install(monkeypatch, "this is not json at all", '"fixed": 1}')
    assert llm.call_json("s", "the question", max_tokens=10) == {"fixed": 1}
    assert len(fake.messages.calls) == 2
    repair = fake.messages.calls[1]["messages"]
    assert repair[0] == {"role": "user", "content": "the question"}
    assert repair[1]["role"] == "assistant"
    assert repair[1]["content"].startswith("{this is not json")
    assert repair[2]["role"] == "user"
    assert repair[2]["content"].startswith("That was not valid JSON:")
    assert repair[2]["content"].endswith("Start with { and end with }.")
    assert repair[3] == {"role": "assistant", "content": "{"}


def test_call_json_raises_after_failed_repair(monkeypatch, llm_on):
    fake = _install(monkeypatch, "garbage one", "garbage two")
    with pytest.raises(llm.LLMFormatError):
        llm.call_json("s", "u", max_tokens=10)
    assert len(fake.messages.calls) == 2


def test_call_json_truncates_raw_in_repair(monkeypatch, llm_on):
    fake = _install(monkeypatch, "x" * 10_000, '"ok": 1}')
    llm.call_json("s", "u", max_tokens=10)
    assert len(fake.messages.calls[1]["messages"][1]["content"]) == 4000


# ------------------------------------------------- what a failure is allowed to say
#
# `World.error` is served straight to whoever opens the server, so the provider's
# own message -- a JSON blob carrying a request id -- must never be what lands
# there. These are the failures that actually happen on a demo day.


class _Status(Exception):
    """Stands in for an anthropic error: the mapping reads `status_code`."""

    def __init__(self, status_code):
        super().__init__("provider blob with a request_id in it")
        self.status_code = status_code


def test_a_spent_quota_says_so_in_words():
    assert llm.describe_api_error(_Status(429)) == "the model is out of quota right now"


@pytest.mark.parametrize("status", [401, 403])
def test_a_rejected_key_says_so_in_words(status):
    assert llm.describe_api_error(_Status(status)) == "the model rejected our key"


@pytest.mark.parametrize("status", [500, 503, 599])
def test_a_broken_provider_says_so_in_words(status):
    assert llm.describe_api_error(_Status(status)) == "the model is having trouble right now"


def test_an_unmapped_failure_still_leaks_neither_blob_nor_request_id():
    described = llm.describe_api_error(_Status(418))
    assert described == "_Status"
    assert "request_id" not in described
