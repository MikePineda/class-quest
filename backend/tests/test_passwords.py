"""The password policy. Pure rules, so they are tested here rather than
through the router -- `test_auth.py` covers that the router applies them.
"""
import pytest

from app.services.passwords import MAX_BYTES, MIN_LENGTH, password_problems


def ok(password: str, **who) -> bool:
    return password_problems(password, **who) == []


# ---------------------------------------------------------------- length

def test_a_long_passphrase_passes():
    assert ok("correct horse battery staple")
    assert ok("the owl walks at midnight")


@pytest.mark.parametrize("password", ["", "short", "nine char", "a" * (MIN_LENGTH - 1)])
def test_too_short_is_refused(password):
    assert any("at least" in p for p in password_problems(password))


def test_the_minimum_length_itself_is_allowed():
    assert ok("zephyrmoss")
    assert len("zephyrmoss") == MIN_LENGTH


def test_beyond_bcrypts_truncation_point_is_refused():
    # bcrypt silently ignores everything past 72 bytes, so accepting it would
    # mean two different passwords opening the same account.
    assert any("bytes" in p for p in password_problems("z" * (MAX_BYTES + 1)))


def test_the_byte_limit_counts_bytes_not_characters():
    # Three bytes each in UTF-8, so 25 of them clear 72 while 25 characters
    # would not. Varied, because one character repeated is refused separately.
    assert any("bytes" in p for p in password_problems("☃★☂" * 9))
    assert ok("☃★☂" * 7)


# ---------------------------------------------------------------- blocklist

@pytest.mark.parametrize(
    "password",
    ["password123", "1234567890", "qwertyuiop", "iloveyou11", "welcome123", "classquest", "0123456789"],
)
def test_the_passwords_everyone_picks_are_refused(password):
    assert len(password) >= MIN_LENGTH, "otherwise this test only proves the length rule"
    assert any("commonly used" in p for p in password_problems(password))


@pytest.mark.parametrize("password", ["P@ssw0rd1!", "p@ssw0rd12", "Welcome123!", "password2024", "classquest99"])
def test_decoration_does_not_smuggle_a_common_password_through(password):
    # The substitutions inside the word and the year bolted on the end are the
    # two ways a composition rule gets satisfied without gaining anything.
    assert any("commonly used" in p for p in password_problems(password))


def test_one_character_repeated_is_refused():
    assert any("same character" in p for p in password_problems("aaaaaaaaaaaa"))
    assert any("same character" in p for p in password_problems("!!!!!!!!!!!!"))


@pytest.mark.parametrize("password", ["abcdefghijkl", "lkjihgfedcba", "qwertyuiop"])
def test_a_keyboard_run_is_refused(password):
    problems = password_problems(password)
    assert any("straight run" in p or "commonly used" in p for p in problems), problems


# ---------------------------------------------------------------- identity

def test_your_own_email_is_not_a_password():
    problems = password_problems("lovelace-1815", email="lovelace@example.com", display_name="Ada")
    assert any("name or email" in p for p in problems)


def test_your_own_display_name_is_not_a_password():
    problems = password_problems("wandering owl", email="a@example.com", display_name="Wandering")
    assert any("name or email" in p for p in problems)


def test_identity_matching_ignores_case():
    problems = password_problems("XYZLOVELACEXYZ", email="lovelace@example.com", display_name="Ada")
    assert any("name or email" in p for p in problems)


def test_a_short_name_fragment_does_not_refuse_everything():
    # "Bo" appears inside "about", "below", "bottle"... matching on it would
    # reject good passwords for a reason nobody could act on.
    assert ok("bottle of thunder", email="bo@example.com", display_name="Bo")


def test_identity_is_optional():
    assert ok("wandering owl at dusk")


# ---------------------------------------------------------------- shape

def test_no_composition_rule_is_imposed():
    # The whole point of the NIST guidance: a long lowercase phrase is strong,
    # and demanding a symbol produces Password1! instead.
    assert ok("thistle marmalade rowboat")


def test_every_reason_is_reported_not_just_the_first():
    # Too short *and* their own name: the person should be told both at once
    # rather than made to guess again after fixing one.
    problems = password_problems("lovelace", email="lovelace@example.com", display_name="Ada")
    assert len(problems) >= 2
    assert any("at least" in p for p in problems)
    assert any("name or email" in p for p in problems)
