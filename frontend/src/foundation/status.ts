/**
 * How a generation status reads on screen. Shared by the server hub, the
 * server screen and the picker, so "processing" is never amber in one place
 * and grey in another.
 */
import type { GenerationStatus } from '../api/types'

export const statusTone: Record<GenerationStatus, string> = {
  ready: 'text-secondary',
  failed: 'text-error',
  pending: 'text-primary-soft',
  processing: 'text-primary-soft',
}
