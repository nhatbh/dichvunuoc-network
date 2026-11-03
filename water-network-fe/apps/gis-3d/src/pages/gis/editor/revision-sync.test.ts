import { createRoot } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import type { GisData } from '../lib/gis-data'
import type { EditorApi } from '../network-editor/api'
import type { Edit, Revision } from '../network-editor/model'
import type { Draft } from './model'
import { createRevisionSync } from './revision-sync'

const perms = vi.hoisted(() => ({ list: ['network-design:write'] as string[] }))
vi.mock('@/entities/session/api/use-session', () => ({
  useSession: () => ({ data: () => ({ user: { id: 'u1', tenantId: 't1', permissions: perms.list } }) }),
}))
vi.mock('@/shared/lib/client-auth', () => ({ authClient: {} }))

const G = {
  geo: { bbox: [105.8, 21.0, 105.9, 21.05], inset: 0, unitsToMeters: 1, metersPerDegreeLon: 103_900, metersPerDegreeLat: 110_700 },
  pipeBy: { 'P-1': { code: 'ONG-1' } },
  valves: [],
  hydrants: [],
  nodes: [],
} as unknown as GisData

const add: Draft = { id: 'DRF-1', op: 'add', kind: 'pipe', geom: 'line', pts: [[10, 10], [60, 10]], dn: 200, material: 'HDPE', dma: 'DMA-01', eam: null }
const mod: Draft = { id: 'DRF-2', op: 'mod', baseId: 'P-1', kind: 'pipe', geom: 'line', pts: [[0, 0], [5, 0]], dn: 300, material: 'HDPE', dma: 'DMA-01', eam: null }

function fakeApi(opts: { validate?: { isValid: boolean; errors?: { code: string; field: string; message: string; operationId?: string }[] } } = {}) {
  const store = new Map<string, Revision>()
  let n = 0
  const calls: string[] = []
  const api = {
    assets: vi.fn(async () => ({ 'P-1': { version: 7, asset: {} } })),
    get: vi.fn(async (id: string) => {
      const r = store.get(id)
      if (!r) throw new Error('404')
      return { ...r }
    }),
    create: vi.fn(async () => {
      const r: Revision = { id: `REV-${++n}`, version: 1, status: 'Draft', operations: [] }
      store.set(r.id, r)
      calls.push('create')
      return { ...r }
    }),
    save: vi.fn(async (rev: Revision, operations: Edit[]) => {
      const r = { ...store.get(rev.id)!, operations, version: rev.version + 1, status: 'Draft' }
      store.set(r.id, r)
      calls.push('save')
      return { ...r, errors: [] }
    }),
    action: vi.fn(async (id: string, action: string) => {
      calls.push(action)
      const r = store.get(id)!
      if (action === 'validate') {
        const v = opts.validate ?? { isValid: true, errors: [] }
        if (v.isValid) r.status = 'Validated'
        return v
      }
      if (action === 'submit') r.status = 'Submitted'
      return { isValid: true }
    }),
    results: vi.fn(),
    list: vi.fn(),
  }
  return { api: api as unknown as EditorApi, calls, store }
}

function setup(api: EditorApi) {
  const linked: string[] = []
  const errors: string[] = []
  const sync = createRoot(() => createRevisionSync({ G, api: () => api, onError: m => errors.push(m), onLinked: id => linked.push(id) }))
  return { sync, linked, errors }
}

describe('createRevisionSync', () => {
  it('creates and links a revision on first save, with base versions and codes', async () => {
    const f = fakeApi()
    const { sync, linked } = setup(f.api)
    const r = await sync.save([add, mod], 'Thiết kế A', undefined)
    expect(r?.id).toBe('REV-1')
    expect(linked).toEqual(['REV-1'])
    const ops = f.store.get('REV-1')!.operations!
    expect(ops.map(o => [o.action, o.expectedVersion])).toEqual([['Add', null], ['Update', 7]])
    expect(ops[1]!.after!.assetCode).toBe('ONG-1')
    expect(sync.savedSnapshot()).toBe(JSON.stringify([add, mod]))
  })

  it('reuses the linked revision and submits through validate', async () => {
    const f = fakeApi()
    const { sync } = setup(f.api)
    await sync.save([add], 'A', undefined)
    const submitted = await sync.submit([add], 'A', 'REV-1')
    expect(submitted?.status).toBe('Submitted')
    expect(f.calls).toEqual(['create', 'save', 'save', 'validate', 'submit'])
  })

  it('stops on server validation errors and shows them as rule issues', async () => {
    const f = fakeApi({ validate: { isValid: false, errors: [{ code: 'pipe.dn', field: 'dn', operationId: 'DRF-1', message: 'DN sai' }] } })
    const { sync } = setup(f.api)
    expect(await sync.submit([add], 'A', undefined)).toBeNull()
    expect(sync.issues()).toEqual([{ sev: 'error', rule: 'server', msg: '[DRF-1] DN sai' }])
    expect(f.calls).not.toContain('submit')
  })

  it('starts a new revision when the linked one is already under review', async () => {
    const f = fakeApi()
    const { sync, linked } = setup(f.api)
    await sync.submit([add], 'A', undefined)
    await sync.save([add], 'B', 'REV-1')
    expect(linked).toEqual(['REV-1', 'REV-2'])
  })

  it('restores drafts from a saved revision', async () => {
    const f = fakeApi()
    const first = setup(f.api)
    await first.sync.save([add], 'A', undefined)
    const { sync } = setup(f.api)
    const drafts = await sync.load('REV-1')
    expect(drafts?.[0]).toMatchObject({ id: 'DRF-1', op: 'add', kind: 'pipe', dn: 200, material: 'HDPE' })
    expect(drafts?.[0]?.pts?.[1]?.[0]).toBeCloseTo(60, 1)
  })

  it('reports API failures and requires the write permission', async () => {
    const f = fakeApi()
    ;(f.api.create as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Bạn chưa có quyền thực hiện thao tác này.'))
    const { sync, errors } = setup(f.api)
    expect(await sync.save([add], 'A', undefined)).toBeNull()
    expect(errors).toEqual(['Bạn chưa có quyền thực hiện thao tác này.'])
    expect(sync.busy()).toBe(false)
    expect(sync.canWrite()).toBe(true)
    perms.list = []
    expect(setup(f.api).sync.canWrite()).toBe(false)
  })
})
