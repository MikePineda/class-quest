/**
 * Typed fetch wrapper for the ClassQuest API. No dependencies.
 * Base URL: VITE_API_URL (prod, build-arg) or the Vite `/api` dev proxy.
 */
import type * as T from './types'

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api'
const TOKEN_KEY = 'cq_token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable (private mode, SSR) */
  }
}

export class ApiError extends Error {
  status: number
  /** FastAPI `detail`: string for app errors, list of field errors on 422. */
  detail: unknown
  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : `API error ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

async function req<R>(method: Method, path: string, body?: unknown, opts: { form?: FormData } = {}): Promise<R> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let payload: BodyInit | undefined
  if (opts.form) payload = opts.form // browser sets the multipart boundary
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload })
  if (res.status === 204) return undefined as R
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data ? (data as T.ApiErrorBody).detail : data
    throw new ApiError(res.status, detail)
  }
  return data as R
}

export const api = {
  // meta
  health: () => req<T.HealthOut>('GET', '/health'),

  // auth
  register: (body: T.RegisterIn) => req<T.TokenOut>('POST', '/auth/register', body),
  login: (body: T.LoginIn) => req<T.TokenOut>('POST', '/auth/login', body),
  me: () => req<T.User>('GET', '/auth/me'),
  updateMe: (body: T.ProfileUpdateIn) => req<T.User>('PATCH', '/auth/me', body),

  // servers
  listServers: () => req<T.ServerListOut>('GET', '/servers'),
  publicServers: () => req<T.ServerListOut>('GET', '/servers/public'),
  /** Multipart: name, description?, is_public ("true"/"false"), pet, text?, files[]? */
  createServer: (form: FormData) => req<T.ServerSummary>('POST', '/servers', undefined, { form }),
  getServer: (id: string) => req<T.ServerDetail>('GET', `/servers/${id}`),
  joinServer: (join_code: string) => req<T.JoinOut>('POST', '/servers/join', { join_code }),
  leaderboard: (id: string) => req<T.LeaderboardOut>('GET', `/servers/${id}/leaderboard`),
  cohort: (id: string) => req<T.CohortOut>('GET', `/servers/${id}/cohort`),
  deleteServer: (id: string) => req<void>('DELETE', `/servers/${id}`),

  // worlds
  getWorld: (id: string) => req<T.WorldDetail>('GET', `/worlds/${id}`),
  postAttempt: (id: string, body: T.AttemptIn) => req<T.AttemptOut>('POST', `/worlds/${id}/attempts`, body),
  getProgress: (id: string) => req<T.ProgressOut>('GET', `/worlds/${id}/progress`),
  explain: (id: string, body: T.ExplainIn) => req<T.ExplainOut>('POST', `/worlds/${id}/explain`, body),
  /** Stateless: post the whole conversation every time. A retry re-posts an identical body. */
  explainTurn: (id: string, body: T.ExplainChatIn) =>
    req<T.ExplainChatOut>('POST', `/worlds/${id}/explain/turn`, body),
}

export type Api = typeof api
