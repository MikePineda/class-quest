/**
 * A mirror of the backend's password policy, so the person choosing one can
 * see what is missing before they submit.
 *
 * `backend/app/services/passwords.py` is the authority — it is what actually
 * refuses a registration, and it is the only one that matters. This exists to
 * make the form honest, not to guard anything. **The two must not drift**: if
 * you change a rule, change it there first.
 *
 * The same NIST reasoning applies here: length carries the weight, there is no
 * composition rule, and the blocklist is what stops `Password1!`.
 */

export const MIN_LENGTH = 10
/** bcrypt truncates at 72 bytes, so anything past that is not really typed. */
export const MAX_BYTES = 72

const COMMON = new Set(
  `password passwd password1 password123 passw0rd p@ssword p@ssw0rd
   123456 1234567 12345678 123456789 1234567890 12345 0123456789
   qwerty qwertyuiop qwerty123 asdfghjkl zxcvbnm 1q2w3e4r 1qaz2wsx qazwsx
   iloveyou letmein welcome welcome1 admin administrator root toor guest
   login abc123 abcd1234 monkey dragon sunshine princess football baseball
   superman batman trustno1 master hello freedom whatever shadow michael
   jennifer jordan harley ranger hunter buster soccer starwars computer
   michelle charlie andrew matthew daniel jessica pepper access flower
   changeme secret default temp temporary test testing testtest sample
   classquest classquest1 quest student teacher school college university
   lecture homework assignment`.split(/\s+/),
)

const LEET: Record<string, string> = {
  '@': 'a', $: 's', '!': 'i', '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't',
}

const ALPHABETS = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']

/** Lowercased, de-accented, and with the usual substitutions undone. */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/./gu, (ch) => LEET[ch] ?? ch)
}

/** The forms the blocklist should recognise, including `password` + a year. */
function variants(password: string): string[] {
  const lowered = password.toLowerCase()
  const folded = fold(password)
  const trimmed = [lowered, folded].map((v) => v.replace(/[^a-z]+$/, '')).filter(Boolean)
  return [lowered, folded, ...trimmed]
}

const isRun = (value: string): boolean => {
  const lowered = value.toLowerCase()
  if (lowered.length < 4) return false
  return ALPHABETS.some(
    (alphabet) => alphabet.includes(lowered) || [...alphabet].reverse().join('').includes(lowered),
  )
}

/** The pieces of somebody's identity that must not be their password. */
function identityParts(email: string, displayName: string): string[] {
  const local = email.split('@')[0] ?? ''
  return `${local} ${displayName}`
    .split(/[^A-Za-z0-9]+/)
    // Two- and three-letter fragments match everything and would refuse good
    // passwords for a reason nobody could act on.
    .filter((chunk) => chunk.length >= 4)
    .map((chunk) => chunk.toLowerCase())
}

export interface PasswordCheck {
  /** Every reason it would be refused, phrased for the person choosing it. */
  problems: string[]
  ok: boolean
}

export function checkPassword(
  password: string,
  { email = '', displayName = '' }: { email?: string; displayName?: string } = {},
): PasswordCheck {
  const problems: string[] = []

  if (password.length < MIN_LENGTH) {
    problems.push(`Use at least ${MIN_LENGTH} characters — length is what makes a password hard to guess.`)
  }
  if (new TextEncoder().encode(password).length > MAX_BYTES) {
    problems.push(`Use at most ${MAX_BYTES} bytes; anything beyond that is silently ignored.`)
  }

  if (variants(password).some((variant) => COMMON.has(variant))) {
    problems.push('This is one of the most commonly used passwords. Pick something nobody would guess first.')
  } else if (password.trim().length > 0 && /^(.)\1*$/u.test(password.trim())) {
    problems.push('This is the same character repeated. Use a phrase instead.')
  } else if (isRun(password)) {
    problems.push('This is a straight run across the keyboard. Use a phrase instead.')
  }

  if (identityParts(email, displayName).some((part) => password.toLowerCase().includes(part))) {
    problems.push('Do not put your name or email address in your password.')
  }

  return { problems, ok: problems.length === 0 }
}
