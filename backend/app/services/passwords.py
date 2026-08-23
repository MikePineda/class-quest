"""Password policy, NIST-style: length carries the weight, and the passwords
people actually pick are refused by name.

Deliberately no composition rule. Demanding an uppercase, a digit and a symbol
produces `Password1!` -- one of the most common passwords in every breach
corpus -- while a four-word passphrase fails the rule and would survive
centuries of guessing. Length plus a blocklist is what SP 800-63B has
recommended since 2017.

Pure, so it is tested directly (`tests/test_passwords.py`) rather than through
the router. `frontend/src/foundation/password.ts` mirrors these rules to show
the learner what is missing before they submit; this module is the authority
and the two must not drift.
"""
import re
import unicodedata

MIN_LENGTH = 10
#: bcrypt truncates silently at 72 *bytes*, so anything longer is not actually
#: part of the password. Refuse it rather than pretend it counts.
MAX_BYTES = 72

#: The passwords that actually appear, plus the ones this product invites.
#: Short on purpose: a full corpus belongs behind a service, and the long tail
#: is already covered by the length rule.
_COMMON = frozenset(
    """
    password passwd password1 password123 passw0rd p@ssword p@ssw0rd
    123456 1234567 12345678 123456789 1234567890 12345 0123456789
    qwerty qwertyuiop qwerty123 asdfghjkl zxcvbnm 1q2w3e4r 1qaz2wsx qazwsx
    iloveyou letmein welcome welcome1 admin administrator root toor guest
    login abc123 abcd1234 monkey dragon sunshine princess football baseball
    superman batman trustno1 master hello freedom whatever shadow michael
    jennifer jordan harley ranger hunter buster soccer starwars computer
    michelle charlie andrew matthew daniel jessica pepper access flower
    changeme secret default temp temporary test testing testtest sample
    classquest classquest1 quest student teacher school college university
    lecture homework assignment
    """.split()
)

#: `aaaaaaaaaa`, `!!!!!!!!!!` -- long enough for the length rule, worth nothing.
_ONE_CHARACTER = re.compile(r"^(.)\1*$")

_ALPHABETS = ("abcdefghijklmnopqrstuvwxyz", "01234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm")

#: The substitutions that make `P@ssw0rd` look like a new idea. Folding them
#: away is what lets one short blocklist cover a large family of passwords.
_LEET = str.maketrans({"@": "a", "$": "s", "!": "i", "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t"})


def _folded(value: str) -> str:
    """Lowercased and stripped of accents, so `P@ssw0rd` and `pässword` are
    recognised as what they are."""
    decomposed = unicodedata.normalize("NFKD", value.lower())
    plain = "".join(c for c in decomposed if not unicodedata.combining(c))
    return plain.translate(_LEET)


def _variants(password: str) -> set[str]:
    """The forms of a password the blocklist should recognise.

    `Password1!` is `password` with decoration, and treating it as a fresh idea
    is how a blocklist ends up covering nothing: the leet fold handles the
    substitutions inside the word, and stripping trailing digits and symbols
    handles the year or bang people add on the end to satisfy a rule.
    """
    lowered = password.lower()
    folded = _folded(password)
    trimmed = {re.sub(r"[^a-z]+$", "", v) for v in (lowered, folded)}
    return {lowered, folded} | {v for v in trimmed if v}


def _is_a_run(value: str) -> bool:
    """A straight walk along a keyboard row or the alphabet, forwards or back."""
    folded = value.lower()
    if len(folded) < 4:
        return False
    for alphabet in _ALPHABETS:
        if folded in alphabet or folded in alphabet[::-1]:
            return True
    return False


def _identifier_parts(email: str, display_name: str) -> list[str]:
    """The pieces of somebody's own identity that must not be their password."""
    parts = []
    local = email.split("@", 1)[0] if email else ""
    for chunk in re.split(r"[^A-Za-z0-9]+", f"{local} {display_name}"):
        # Two-letter fragments match everything and would refuse good passwords.
        if len(chunk) >= 4:
            parts.append(chunk.lower())
    return parts


def password_problems(password: str, *, email: str = "", display_name: str = "") -> list[str]:
    """Every reason this password is refused, phrased for the person choosing it.

    Empty means it is fine. The messages are user-facing: FastAPI puts them in
    the 422 body and the frontend renders them verbatim.
    """
    problems: list[str] = []

    if len(password) < MIN_LENGTH:
        problems.append(f"Use at least {MIN_LENGTH} characters — length is what makes a password hard to guess.")
    if len(password.encode("utf-8")) > MAX_BYTES:
        problems.append(f"Use at most {MAX_BYTES} bytes; anything beyond that is silently ignored.")

    if _variants(password) & _COMMON:
        problems.append("This is one of the most commonly used passwords. Pick something nobody would guess first.")
    elif _ONE_CHARACTER.match(password.strip()):
        problems.append("This is the same character repeated. Use a phrase instead.")
    elif _is_a_run(password):
        problems.append("This is a straight run across the keyboard. Use a phrase instead.")

    for part in _identifier_parts(email, display_name):
        if part in password.lower():
            problems.append("Do not put your name or email address in your password.")
            break

    return problems
