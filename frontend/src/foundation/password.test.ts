/**
 * These assertions are duplicated, deliberately, from
 * `backend/tests/test_passwords.py`. That is the point of them: this module is
 * a mirror, and the way a mirror fails is by quietly drifting from what it
 * reflects. If one of these ever disagrees with the Python, the Python wins.
 */
import { describe, expect, it } from 'vitest'
import { checkPassword, MAX_BYTES, MIN_LENGTH } from './password'

const ok = (password: string, who?: { email?: string; displayName?: string }) =>
  checkPassword(password, who).ok
const reasons = (password: string, who?: { email?: string; displayName?: string }) =>
  checkPassword(password, who).problems.join(' ')

describe('length', () => {
  it('accepts a long lowercase passphrase, with no composition rule', () => {
    expect(ok('correct horse battery staple')).toBe(true)
    expect(ok('thistle marmalade rowboat')).toBe(true)
  })

  it.each(['', 'short', 'nine char'])('refuses %o', (password) => {
    expect(reasons(password)).toContain('at least')
  })

  it('allows exactly the minimum', () => {
    expect('zephyrmoss'.length).toBe(MIN_LENGTH)
    expect(ok('zephyrmoss')).toBe(true)
  })

  it('counts bytes, not characters, at the bcrypt limit', () => {
    expect(reasons('☃★☂'.repeat(9))).toContain('bytes')
    expect(ok('☃★☂'.repeat(7))).toBe(true)
    expect(new TextEncoder().encode('☃★☂'.repeat(7)).length).toBeLessThanOrEqual(MAX_BYTES)
  })
})

describe('blocklist', () => {
  it.each(['password123', '1234567890', 'qwertyuiop', 'iloveyou11', 'welcome123', 'classquest'])(
    'refuses %o',
    (password) => {
      expect(password.length).toBeGreaterThanOrEqual(MIN_LENGTH)
      expect(reasons(password)).toContain('commonly used')
    },
  )

  it.each(['P@ssw0rd1!', 'p@ssw0rd12', 'Welcome123!', 'password2024', 'classquest99'])(
    'sees through the decoration on %o',
    (password) => {
      expect(reasons(password)).toContain('commonly used')
    },
  )

  it('refuses one character repeated and a keyboard run', () => {
    expect(reasons('aaaaaaaaaaaa')).toContain('same character')
    expect(reasons('!!!!!!!!!!!!')).toContain('same character')
    expect(reasons('abcdefghijkl')).toContain('straight run')
  })
})

describe('identity', () => {
  it('refuses your own email local part or display name', () => {
    expect(reasons('lovelace-1815', { email: 'lovelace@example.com', displayName: 'Ada' })).toContain(
      'name or email',
    )
    expect(reasons('wandering owl', { email: 'a@example.com', displayName: 'Wandering' })).toContain(
      'name or email',
    )
  })

  it('matches regardless of case', () => {
    expect(reasons('XYZLOVELACEXYZ', { email: 'lovelace@example.com', displayName: 'Ada' })).toContain(
      'name or email',
    )
  })

  it('ignores a fragment too short to mean anything', () => {
    // "Bo" is inside "about", "below", "bottle"...
    expect(ok('bottle of thunder', { email: 'bo@example.com', displayName: 'Bo' })).toBe(true)
  })
})

describe('reporting', () => {
  it('reports every reason at once, so nobody has to guess twice', () => {
    const { problems } = checkPassword('lovelace', {
      email: 'lovelace@example.com',
      displayName: 'Ada',
    })
    expect(problems.length).toBeGreaterThanOrEqual(2)
    expect(problems.join(' ')).toContain('at least')
    expect(problems.join(' ')).toContain('name or email')
  })
})
