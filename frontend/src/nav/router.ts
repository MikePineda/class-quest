/**
 * The router. Fifty lines, no dependency, and the only file in the app that
 * touches `window.location`.
 *
 * Navigation used to be a full page load per link, which is why leaving a
 * world felt like restarting the app and why several screens could only be
 * escaped with the browser's back button. Links stay ordinary `<a href>`
 * anchors — a document-level click interceptor upgrades them. That ordering
 * matters: an `<AppLink>` component would mean every future anchor silently
 * regresses to a page load unless somebody remembers, and forgetting is the
 * bug class this replaces.
 *
 * Everything the browser does with a link that is not a plain left click —
 * cmd-click, middle click, "open in new tab", `download`, `target`, another
 * origin — falls straight through, because the interceptor bails before
 * `preventDefault`.
 */
import { useMemo, useSyncExternalStore } from 'react'
import { parseRoute } from './routes'
import type { Route } from './routes'

interface Location {
  pathname: string
  search: string
}

/**
 * Cached, and only ever replaced inside `emit`. `useSyncExternalStore` calls
 * `getSnapshot` during render and compares by identity: returning a fresh
 * object literal each call is an infinite re-render loop.
 */
let current: Location = { pathname: '/', search: '' }
const listeners = new Set<() => void>()

function emit(): void {
  current = { pathname: window.location.pathname, search: window.location.search }
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const snapshot = (): Location => current

/**
 * Go somewhere. A plain module function rather than a hook, so the keyboard
 * paths inside the world (Escape leaves) can call it from an effect without
 * threading a callback through.
 */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const url = new URL(to, window.location.origin)
  const next = url.pathname + url.search
  // Pushing the address you are already on turns Back into a no-op the second
  // time you press it, which reads as the button being broken.
  if (next === window.location.pathname + window.location.search) return
  window.history[options.replace ? 'replaceState' : 'pushState'](null, '', next)
  if (!options.replace) window.scrollTo(0, 0)
  emit()
}

function onClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

  const target = event.target
  // Not always an Element: it can be a text node, the document, or the window
  // for a synthesised event.
  const anchor = target instanceof Element ? target.closest('a') : null
  // `closest('a')`, never `closest('[href]')`: React 19 hoists <style href=…>
  // out of the components that declare them, and the novel shell uses that.
  if (!(anchor instanceof HTMLAnchorElement)) return
  if (anchor.target && anchor.target !== '_self') return
  if (anchor.hasAttribute('download')) return
  if ((anchor.getAttribute('rel') ?? '').split(/\s+/).includes('external')) return

  const raw = anchor.getAttribute('href')
  // An in-page anchor belongs to the browser.
  if (!raw || raw.startsWith('#')) return

  // `anchor.href` is resolved and absolute, which is what makes a relative
  // href and a cross-origin one distinguishable.
  const url = new URL(anchor.href)
  if (url.origin !== window.location.origin) return

  event.preventDefault()
  navigate(url.pathname + url.search)
}

let started = false

/**
 * Called once from `main.tsx`, before `createRoot`. Not from an effect:
 * `<StrictMode>` would mount, unmount and remount the listeners on every dev
 * boot, and they have to outlive any single component anyway.
 */
export function startRouter(): void {
  if (started) return
  started = true
  current = { pathname: window.location.pathname, search: window.location.search }
  // No scroll reset here: on Back the browser restores the old offset itself,
  // and overriding that makes Back feel worse than the page loads it replaced.
  window.addEventListener('popstate', emit)
  document.addEventListener('click', onClick)
}

export function useRoute(): Route {
  const location = useSyncExternalStore(subscribe, snapshot, snapshot)
  return useMemo(() => parseRoute(location.pathname, location.search), [location])
}
