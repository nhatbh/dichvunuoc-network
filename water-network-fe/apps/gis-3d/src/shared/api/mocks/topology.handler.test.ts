import { findComponent } from '@wn/contracts/catalog'
import { IsolationResult, TraceResult } from '@wn/contracts/topology'
import { describe, expect, it, vi } from 'vitest'
import { officialAssets, resetEditorStore } from './editor-handlers'

vi.mock('@/shared/lib/client-auth', () => ({ authClient: { getAccessToken: async () => null } }))

const BASE = 'http://localhost:3000/api/gis/topology'

describe('topology mock (same rules as topology-rs)', () => {
  it('isolates a demo pipe with valves that isolate only', async () => {
    resetEditorStore()
    const assets = officialAssets()
    const byId = new Map(assets.map(a => [a.draftAssetId, a]))
    const pipe = assets.find(a => a.kind === 'Pipe' && a.fromRef && a.toRef)!
    const r = IsolationResult.parse(
      await (await fetch(BASE + '/isolation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pipeId: pipe.draftAssetId }) })).json()
    )
    expect(r.graphReady).toBe(true)
    expect(r.isolatedPipes).toContain(pipe.draftAssetId)
    for (const v of r.valvesToClose) expect(findComponent(byId.get(v)?.attributes.componentCode)?.functions).toContain('isolates')
    for (const p of r.boundaryPipes) expect(r.isolatedPipes.includes(p) && p !== pipe.draftAssetId).toBe(false)
  })

  it('rejects a body with no start and traces from a node', async () => {
    const bad = await fetch(BASE + '/isolation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(bad.status).toBe(400)
    const node = officialAssets().find(a => a.kind === 'Node')!
    const r = TraceResult.parse(await (await fetch(`${BASE}/trace?from=${node.draftAssetId}&direction=downstream`)).json())
    expect(r.nodeIds).toContain(node.draftAssetId)
  })

  it('the app client calls the same routes', async () => {
    const { topologyApi } = await import('@/pages/gis/lib/topology-api')
    const pipe = officialAssets().find(a => a.kind === 'Pipe')!
    expect((await topologyApi.isolate({ pipeId: pipe.draftAssetId })).isolatedPipes).toContain(pipe.draftAssetId)
  })
})
