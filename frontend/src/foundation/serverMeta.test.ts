import { describe, expect, it } from 'vitest'

import type { ServerSummary } from '../api/types'
import { serverMeta } from './serverMeta'

const server = (overrides: Partial<ServerSummary> = {}): ServerSummary => ({
  id: 'server',
  name: 'Intro to ML — Week 3',
  description: null,
  join_code: 'K7Q2MX',
  is_public: false,
  pet: 'owl',
  status: 'ready',
  error: null,
  owner_id: 'someone-else',
  member_count: 4,
  world_count: 2,
  my_role: 'member',
  my_xp: 0,
  created_at: '2026-08-22T09:20:00Z',
  ...overrides,
})

describe('serverMeta', () => {
  it('reads visibility, membership and worlds off the summary', () => {
    expect(serverMeta(server())).toEqual(['Private', '4 members', '2 worlds'])
    expect(serverMeta(server({ is_public: true }))).toEqual(['Shared', '4 members', '2 worlds'])
  })

  it('names the owner, and only the owner', () => {
    expect(serverMeta(server({ my_role: 'owner' }))).toEqual(['Private', 'Owner', '4 members', '2 worlds'])
    expect(serverMeta(server({ my_role: null }))).toEqual(['Private', '4 members', '2 worlds'])
  })

  it('counts one member and one world in the singular', () => {
    expect(serverMeta(server({ member_count: 1, world_count: 1 }))).toEqual(['Private', '1 member', '1 world'])
  })

  it('says worlds are unplanned rather than claiming a server has none', () => {
    expect(serverMeta(server({ world_count: 0, status: 'processing' }))).toContain('worlds not planned yet')
    expect(serverMeta(server({ world_count: 0, status: 'pending' }))).toContain('worlds not planned yet')
    // A finished run really did produce nothing, and a failed one really has nothing.
    expect(serverMeta(server({ world_count: 0, status: 'ready' }))).toContain('0 worlds')
    expect(serverMeta(server({ world_count: 0, status: 'failed' }))).toContain('0 worlds')
  })

  it('never renders a negative or fractional count', () => {
    expect(serverMeta(server({ member_count: -3, world_count: 2.7 }))).toEqual([
      'Private',
      '0 members',
      '2 worlds',
    ])
  })
})
