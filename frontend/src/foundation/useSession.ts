/**
 * Who is signed in, and the three things that change it.
 *
 * Lifted out of `App` when the router arrived. It used to sit beside a second
 * screen-switcher (`'profile' | 'servers'`) that had no URL, so the app had
 * two navigation authorities and one of them could not be linked to. This hook
 * keeps the session; the router keeps the address.
 */
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, getToken, setToken } from '../api/client'
import type { TokenOut, User } from '../api/types'

export interface Session {
  user: User | null
  /** True only while a stored token is being exchanged for a user. */
  checking: boolean
  /** Called with the payload of a successful login or registration. */
  authenticated: (session: TokenOut) => void
  signOut: () => void
  setUser: (user: User) => void
}

export function useSession(): Session {
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(() => getToken() !== null)

  useEffect(() => {
    if (!getToken()) return
    api
      .me()
      .then(setUser)
      .catch((error: unknown) => {
        // An expired token is not an error worth showing: drop it and let the
        // sign-in screen do its job.
        if (error instanceof ApiError && error.status === 401) setToken(null)
      })
      .finally(() => setChecking(false))
  }, [])

  const authenticated = useCallback((session: TokenOut) => {
    setToken(session.token)
    setUser(session.user)
  }, [])

  const signOut = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  return { user, checking, authenticated, signOut, setUser }
}
