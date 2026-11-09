import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { render, waitFor } from '@solidjs/testing-library'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetEditorStore } from '@/shared/api/mocks/editor-handlers'
import type { Branch } from '../lib/branch-store'
import type { GisData } from '../lib/gis-data'
import { createBranchSource } from './branch-source'
import { OFFICIAL_BRANCH_ID } from './live-branches'

const session = () => ({ user: { id: 'u1', tenantId: 't1', permissions: ['network-design:read', 'network-design:write'] }, session: {} })
vi.mock('@/entities/session/api/use-session', () => ({ useSession: () => ({ data: () => session() }) }))
vi.mock('@/shared/lib/client-auth', () => ({
  authClient: { getSession: async () => session(), getAccessToken: async () => null },
}))

const BASE = 'http://localhost:3000/api/gis/editor'
const call = async (path: string, method = 'GET', body?: unknown) =>
  (await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })).json()

const live = { canonical: true, TODAY: '09/11/2026', pipes: [{ lenM: 1500 }], nodes: [{}, {}], valves: [], hydrants: [] } as unknown as GisData

function mount(G: GisData) {
  let source!: ReturnType<typeof createBranchSource>
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(() => (
    <QueryClientProvider client={client}>
      {(() => {
        source = createBranchSource(G)
        return null
      })()}
    </QueryClientProvider>
  ))
  return source
}

beforeEach(() => {
  resetEditorStore()
  localStorage.clear()
})

describe('editor branches on the live network', () => {
  it('are the published network and the tenant’s saved revisions, not the browser store', async () => {
    localStorage.setItem('gis.branches.v1', JSON.stringify([{ id: 'B-LOCAL', name: 'demo', state: 'draft', lane: 'future' }]))
    const p = await call('/projects', 'POST', { name: 'Van biên khu A' })
    const r = await call(`/projects/${p.id}/revisions`, 'POST')
    await call(`/revisions/${r.id}`, 'PUT', { expectedVersion: 1, operations: [] })
    const { branches } = mount(live)
    await waitFor(() => expect(branches().map(b => b.id)).toEqual([OFFICIAL_BRANCH_ID, r.id]))
    expect(branches()[0]).toMatchObject({ state: 'official', pipeKm: 1.5, assets: 3 })
    expect(branches()[1]).toMatchObject({ name: 'Van biên khu A', revisionId: r.id, state: 'draft' })
  })

  it('keeps a branch started here until the server lists its revision', async () => {
    const { branches, setBranches } = mount(live)
    await waitFor(() => expect(branches()).toHaveLength(1))
    const started: Branch = { ...branches()[0]!, id: 'B-NEW', state: 'draft', lane: 'future', name: 'Bản sửa', base: OFFICIAL_BRANCH_ID }
    setBranches(bs => [...bs, started])
    expect(branches().map(b => b.id)).toEqual([OFFICIAL_BRANCH_ID, 'B-NEW'])
    // first save makes its revision; the branch now points at it and is not listed twice
    const p = await call('/projects', 'POST', { name: 'Bản sửa' })
    const r = await call(`/projects/${p.id}/revisions`, 'POST')
    await call(`/revisions/${r.id}`, 'PUT', { expectedVersion: 1, operations: [] })
    setBranches(bs => bs.map(b => (b.id === 'B-NEW' ? { ...b, revisionId: r.id } : b)))
    await waitFor(() => expect(branches().map(b => b.id)).toEqual([OFFICIAL_BRANCH_ID, 'B-NEW']))
  })
})
