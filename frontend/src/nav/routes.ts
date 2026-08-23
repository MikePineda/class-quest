/**
 * Every address the app answers to, as a closed union.
 *
 * Pure on purpose: no React, no `window`. That is what lets the whole route
 * table be table-tested under vitest's node environment, and it is what keeps
 * `router.ts` the only file in the app allowed to touch `window.location`.
 *
 * The query string is folded into the union rather than handed out raw. A
 * `URLSearchParams` passed down to a component is a second, untyped router;
 * a union member is exhaustively checkable at the one `switch` in `App`.
 */

/** Which bundled fixture `/world?demo=…` walks. */
export type FixtureBundle = 'pybasics' | 'overfitting'

export const DEFAULT_FIXTURE: FixtureBundle = 'pybasics'

export type Route =
  | { name: 'home' }
  | { name: 'profile' }
  | { name: 'demo' }
  | { name: 'server'; serverId: string }
  | { name: 'worlds' }
  | { name: 'fixture'; bundle: FixtureBundle }
  | { name: 'world'; worldId: string }
  | { name: 'notFound'; path: string }

/** `/world/<id>` walks one world; bare `/world` is the cross-server list. */
const WORLD_RE = /^\/world(?:\/([^/]+))?\/?$/
const SERVER_RE = /^\/servers\/([^/]+)\/?$/

/**
 * A hand-typed `%` in the address bar is a `URIError`, not a route. Decoding
 * unguarded is a white screen: it throws during render, above any error
 * boundary this app has.
 */
function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/**
 * `?demo` with no value, or any value we do not ship, walks the default
 * bundle. An unknown name is a typo in a link, and the useful answer to a typo
 * is the demo — not a 404 in front of somebody holding a phone.
 */
function bundleOf(search: string): FixtureBundle {
  const value = new URLSearchParams(search).get('demo')
  return value === 'overfitting' ? 'overfitting' : DEFAULT_FIXTURE
}

export function parseRoute(pathname: string, search = ''): Route {
  // A trailing slash is the same address; `/` itself must survive the strip.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname

  if (path === '' || path === '/') return { name: 'home' }
  if (path === '/profile') return { name: 'profile' }
  if (path === '/demo') return { name: 'demo' }

  const server = SERVER_RE.exec(pathname)
  if (server) {
    const serverId = decode(server[1])
    return serverId ? { name: 'server', serverId } : { name: 'notFound', path: pathname }
  }

  const world = WORLD_RE.exec(pathname)
  if (world) {
    if (world[1] === undefined) {
      return new URLSearchParams(search).has('demo')
        ? { name: 'fixture', bundle: bundleOf(search) }
        : { name: 'worlds' }
    }
    const worldId = decode(world[1])
    return worldId ? { name: 'world', worldId } : { name: 'notFound', path: pathname }
  }

  return { name: 'notFound', path: pathname }
}

/** The inverse. Every link in the app goes through this, so the two never drift. */
export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'home':
      return '/'
    case 'profile':
      return '/profile'
    case 'demo':
      return '/demo'
    case 'server':
      return `/servers/${encodeURIComponent(route.serverId)}`
    case 'worlds':
      return '/world'
    case 'fixture':
      return `/world?demo=${route.bundle}`
    case 'world':
      return `/world/${encodeURIComponent(route.worldId)}`
    case 'notFound':
      return route.path
  }
}

/** The bundled world the signed-out visitor is offered. Needs no API at all. */
export const FIXTURE_HREF = hrefFor({ name: 'fixture', bundle: DEFAULT_FIXTURE })
/** The original ML fixture, still linked from the picker and the error paths. */
export const OVERFITTING_HREF = hrefFor({ name: 'fixture', bundle: 'overfitting' })
