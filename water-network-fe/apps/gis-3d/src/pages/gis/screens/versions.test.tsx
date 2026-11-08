import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetEditorStore } from '@/shared/api/mocks/editor-handlers'
import { VersionsScreen } from './versions'

const auth = vi.hoisted(() => ({ permissions: ['network-design:read', 'network-design:write', 'network-design:approve'] }))
const session = () => ({ user: { id: 'u1', tenantId: 't1', permissions: auth.permissions }, session: {} })
vi.mock('@/entities/session/api/use-session', () => ({ useSession: () => ({ data: () => session() }) }))
vi.mock('@/shared/lib/client-auth', () => ({
  authClient: { getSession: async () => session(), getAccessToken: async () => null },
}))

const BASE = 'http://localhost:3000/api/gis/editor'
const call = async (path: string, method = 'GET', body?: unknown) =>
  (await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })).json()
const LINE: [number, number][] = [[105.85, 21.03], [105.851, 21.03]]
const add = (id: string, kind: string, coordinates: [number, number][], attributes: Record<string, string>, refs = {}) => ({
  id, action: 'Add', kind, targetId: null, expectedVersion: null, before: null,
  after: { draftAssetId: id, clientRef: id, kind, assetCode: 'X-' + id, geometry: { type: kind === 'Pipe' ? 'LineString' : 'Point', coordinates }, attributes, fromRef: null, toRef: null, hostRef: null, ...refs },
})

/** A submitted revision with one new pipe between two new junctions. */
async function submitted(name: string) {
  const p = await call('/projects', 'POST', { name })
  const r = await call(`/projects/${p.id}/revisions`, 'POST')
  const rev = await call(`/revisions/${r.id}`)
  await call(`/revisions/${rev.id}`, 'PUT', {
    expectedVersion: rev.version,
    operations: [
      add('A', 'Node', [LINE[0]!], { componentCode: 'Junction', derived: 'endpoint' }),
      add('B', 'Node', [LINE[1]!], { componentCode: 'Junction', derived: 'endpoint' }),
      add('P', 'Pipe', LINE, { diameterMm: '200', material: 'HDPE' }, { fromRef: 'A', toRef: 'B' }),
    ],
  })
  await call(`/revisions/${rev.id}/validate`, 'POST', {})
  await call(`/revisions/${rev.id}/submit`, 'POST', {})
  return rev.id as string
}

function mount() {
  const toast = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(() => (
    <QueryClientProvider client={qc}>
      <VersionsScreen toast={toast} />
    </QueryClientProvider>
  ))
  return toast
}

describe('VersionsScreen (design revisions)', () => {
  beforeEach(() => {
    resetEditorStore()
    auth.permissions = ['network-design:read', 'network-design:write', 'network-design:approve']
  })

  it('lists revisions, shows what the selected one changes, and approves it', async () => {
    const id = await submitted('Nối ống Trần Hưng Đạo')
    const toast = mount()
    await screen.findByText('Nối ống Trần Hưng Đạo')
    // the derived junctions are not counted as drawn changes
    await waitFor(() => expect(screen.getByTestId('revision-tally').textContent).toContain('1Thêm'))
    fireEvent.click(await screen.findByText('Phê duyệt & phát hành'))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('Đã duyệt'), 'success'))
    expect((await call(`/revisions/${id}`)).status).toBe('Published')
  })

  it('returns a revision only with a reason', async () => {
    const id = await submitted('Thiết kế B')
    mount()
    fireEvent.click(await screen.findByText('Trả lại'))
    const send = await screen.findByText('Trả lại bản thiết kế')
    expect(send.closest('button')!.disabled).toBe(true)
    fireEvent.input(screen.getByLabelText('Lý do trả lại'), { target: { value: 'Sai DN' } })
    fireEvent.click(send)
    await waitFor(async () => expect((await call(`/revisions/${id}`)).status).toBe('Draft'))
  })

  it('needs the approve permission to review', async () => {
    auth.permissions = ['network-design:read', 'network-design:write']
    await submitted('Thiết kế C')
    mount()
    await screen.findByText('Chờ người có quyền phê duyệt.')
    expect(screen.queryByText('Phê duyệt & phát hành')).toBeNull()
  })
})
