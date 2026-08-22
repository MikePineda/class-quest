import { ApiError } from '../api/client'

export function readableError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      return 'The ClassQuest API is unavailable right now. Please try again shortly.'
    }
    if (typeof error.detail === 'string') return error.detail
    if (Array.isArray(error.detail)) {
      return error.detail
        .map((item) => {
          if (!item || typeof item !== 'object') return 'Invalid value'
          const message = 'msg' in item ? String(item.msg) : 'Invalid value'
          const location = 'loc' in item && Array.isArray(item.loc) ? item.loc.at(-1) : null
          return location ? `${String(location)}: ${message}` : message
        })
        .join(' · ')
    }
    return `The server rejected this request (${error.status}).`
  }
  if (error instanceof TypeError) return 'Could not reach the ClassQuest API. Check the API address and try again.'
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}
