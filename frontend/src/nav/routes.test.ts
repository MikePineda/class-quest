/**
 * The route table is the one place a typo silently becomes a white screen, so
 * every shape the address bar can hold is pinned here — including the two the
 * old pathname matching in `App.tsx` got wrong: a stray `%`, which threw a
 * `URIError` during render, and `/world/a/b`, which matched nothing and fell
 * through to the server hub instead of saying so.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_FIXTURE, FIXTURE_HREF, hrefFor, parseRoute } from './routes'
import type { Route } from './routes'

describe('parseRoute', () => {
  it('maps the flat paths', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' })
    expect(parseRoute('/profile')).toEqual({ name: 'profile' })
    expect(parseRoute('/demo')).toEqual({ name: 'demo' })
    expect(parseRoute('/world')).toEqual({ name: 'worlds' })
  })

  it('treats a trailing slash as the same address', () => {
    expect(parseRoute('/profile/')).toEqual({ name: 'profile' })
    expect(parseRoute('/world/')).toEqual({ name: 'worlds' })
    expect(parseRoute('/servers/abc/')).toEqual({ name: 'server', serverId: 'abc' })
    // `/` is one character of trailing slash and must survive the strip.
    expect(parseRoute('/')).toEqual({ name: 'home' })
  })

  it('reads the id out of a world and a server path', () => {
    expect(parseRoute('/world/3f2a9c1e')).toEqual({ name: 'world', worldId: '3f2a9c1e' })
    expect(parseRoute('/servers/3f2a9c1e')).toEqual({ name: 'server', serverId: '3f2a9c1e' })
  })

  it('decodes a percent-encoded id', () => {
    expect(parseRoute('/world/a%20b')).toEqual({ name: 'world', worldId: 'a b' })
    expect(parseRoute('/servers/a%2Fb')).toEqual({ name: 'server', serverId: 'a/b' })
  })

  it('answers notFound for a malformed escape rather than throwing', () => {
    // `decodeURIComponent('%')` throws URIError. Unguarded, that was a white
    // screen: it happened during render, above any boundary.
    expect(() => parseRoute('/world/%')).not.toThrow()
    expect(parseRoute('/world/%')).toEqual({ name: 'notFound', path: '/world/%' })
    expect(parseRoute('/servers/%E0%A4%A')).toEqual({ name: 'notFound', path: '/servers/%E0%A4%A' })
  })

  it('does not match nested paths', () => {
    expect(parseRoute('/world/a/b')).toEqual({ name: 'notFound', path: '/world/a/b' })
    expect(parseRoute('/servers/a/b')).toEqual({ name: 'notFound', path: '/servers/a/b' })
    expect(parseRoute('/servers')).toEqual({ name: 'notFound', path: '/servers' })
    expect(parseRoute('/nope')).toEqual({ name: 'notFound', path: '/nope' })
  })

  it('routes ?demo to the bundled fixture, defaulting to the one the login screen offers', () => {
    expect(parseRoute('/world', '?demo')).toEqual({ name: 'fixture', bundle: DEFAULT_FIXTURE })
    expect(parseRoute('/world', '?demo=1')).toEqual({ name: 'fixture', bundle: DEFAULT_FIXTURE })
    expect(parseRoute('/world', '?demo=pybasics')).toEqual({ name: 'fixture', bundle: 'pybasics' })
    expect(parseRoute('/world', '?demo=overfitting')).toEqual({ name: 'fixture', bundle: 'overfitting' })
    // A typo in a link should still walk something, not 404 at a live demo.
    expect(parseRoute('/world', '?demo=nonsense')).toEqual({ name: 'fixture', bundle: DEFAULT_FIXTURE })
  })

  it('ignores the query everywhere it is not load-bearing', () => {
    expect(parseRoute('/world/abc', '?demo=1')).toEqual({ name: 'world', worldId: 'abc' })
    expect(parseRoute('/', '?demo=1')).toEqual({ name: 'home' })
    expect(parseRoute('/world', '?other=1')).toEqual({ name: 'worlds' })
  })
})

describe('hrefFor', () => {
  const cases: Route[] = [
    { name: 'home' },
    { name: 'profile' },
    { name: 'demo' },
    { name: 'worlds' },
    { name: 'server', serverId: '3f2a9c1e' },
    { name: 'world', worldId: '3f2a9c1e' },
    { name: 'fixture', bundle: 'pybasics' },
    { name: 'fixture', bundle: 'overfitting' },
  ]

  it('round-trips every route through the address bar', () => {
    for (const route of cases) {
      const href = hrefFor(route)
      const [pathname, search] = href.split('?')
      expect(parseRoute(pathname, search ? `?${search}` : '')).toEqual(route)
    }
  })

  it('encodes an id that would otherwise change the path', () => {
    expect(hrefFor({ name: 'world', worldId: 'a/b' })).toBe('/world/a%2Fb')
    expect(hrefFor({ name: 'server', serverId: 'a b' })).toBe('/servers/a%20b')
  })

  it('offers the python world as the bundled demo', () => {
    expect(FIXTURE_HREF).toBe('/world?demo=pybasics')
  })
})
