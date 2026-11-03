/* Editor ↔ design-revision service. The CAD editor keeps drafts locally (fast, with undo); this
   controller persists them as the branch's server revision and drives the review workflow:
   save (PUT, optimistic concurrency) → validate (server rules) → submit for approval. */
import { pxToLonLat, lonLatToPx } from '@wn/map-runtime-3d'
import { createSignal, onCleanup, type Accessor } from 'solid-js'
import { useSession } from '@/entities/session/api/use-session'
import { draftsToOperations, operationsToDrafts, serverIssues, type Projector } from './revision-ops'
import { importSessionScope } from '../import-workspace/api'
import { gisLonLatToPixel, gisPixelToLonLat, type GisData } from '../lib/gis-data'
import { createNetworkEditorApi, type EditorApi } from '../network-editor/api'
import type { Draft, DraftKind, RuleIssue } from './model'
import type { Issue, Revision } from '../network-editor/model'

export const WRITE_PERMISSION = 'network-design:write'
const EDITABLE = ['Draft', 'Validated', 'Rejected']

export const REVISION_STATUS: Record<string, string> = {
  Draft: 'Nháp',
  Validated: 'Đã kiểm tra',
  Submitted: 'Chờ duyệt',
  Approved: 'Đã duyệt',
  Published: 'Đã phát hành',
  PartiallyPublished: 'Phát hành một phần',
  Rejected: 'Bị trả lại',
}

export function gisProjector(G: GisData): Projector {
  return {
    toLonLat: (x, y) => gisPixelToLonLat(G, x, y) ?? pxToLonLat(x, y),
    toPixel: (lon, lat) => gisLonLatToPixel(G, lon, lat) ?? lonLatToPx(lon, lat),
  }
}

export function baseKind(G: GisData, id: string): DraftKind | undefined {
  if (G.pipeBy[id]) return 'pipe'
  if (G.valves.some(v => v.id === id)) return 'valve'
  if (G.hydrants.some(h => h.id === id)) return 'hydrant'
  if (G.nodes.some(n => n.id === id)) return 'node'
  return undefined
}

function baseCode(G: GisData, kind: DraftKind, id: string): string | undefined {
  if (kind === 'pipe') return G.pipeBy[id]?.code
  if (kind === 'valve') return G.valves.find(v => v.id === id)?.code
  if (kind === 'hydrant') return G.hydrants.find(h => h.id === id)?.code
  return G.nodes.find(n => n.id === id)?.code
}

export interface RevisionSync {
  revision: Accessor<Revision | null>
  busy: Accessor<boolean>
  issues: Accessor<RuleIssue[]>
  canWrite: Accessor<boolean>
  /** Drafts as last persisted (JSON), to show "unsaved changes". */
  savedSnapshot: Accessor<string | null>
  clearIssues: () => void
  /** Reopen the branch's saved revision; resolves to its drafts (null = nothing to restore). */
  load: (revisionId: string | undefined) => Promise<Draft[] | null>
  save: (drafts: Draft[], name: string, revisionId: string | undefined) => Promise<Revision | null>
  submit: (drafts: Draft[], name: string, revisionId: string | undefined) => Promise<Revision | null>
}

export function createRevisionSync(opts: {
  G: GisData
  onError: (message: string) => void
  /** The branch now points at this revision (persist the link). */
  onLinked: (revisionId: string) => void
  api?: (scope: string, signal: AbortSignal) => EditorApi
}): RevisionSync {
  const { G } = opts
  const session = useSession()
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  const [revision, setRevision] = createSignal<Revision | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [issues, setIssues] = createSignal<RuleIssue[]>([])
  const [savedSnapshot, setSavedSnapshot] = createSignal<string | null>(null)
  const canWrite = () => session.data()?.user.permissions?.includes(WRITE_PERMISSION) ?? false
  const proj = gisProjector(G)
  let versions: Record<string, number> | null = null

  const client = () => (opts.api ?? createNetworkEditorApi)(importSessionScope(session.data()), controller.signal)

  async function run<T>(fn: (api: EditorApi) => Promise<T>): Promise<T | null> {
    if (busy()) return null
    setBusy(true)
    try {
      return await fn(client())
    } catch (e) {
      if (!controller.signal.aborted) opts.onError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  /** The branch's open revision, or a new one when it has none / it is already under review. */
  async function ensureRevision(api: EditorApi, name: string, id: string | undefined): Promise<Revision> {
    const current = revision()
    if (current && current.id === id && EDITABLE.includes(current.status)) return api.get(current.id)
    if (id) {
      const r = await api.get(id).catch(() => null)
      if (r && EDITABLE.includes(r.status)) return r
    }
    const created = await api.create(name)
    opts.onLinked(created.id)
    return created
  }

  async function persist(api: EditorApi, drafts: Draft[], name: string, id: string | undefined): Promise<Revision | null> {
    const rev = await ensureRevision(api, name, id)
    if (!versions && drafts.some(d => d.op !== 'add'))
      versions = Object.fromEntries(Object.entries(await api.assets()).map(([k, v]) => [k, v.version]))
    const ops = draftsToOperations(drafts, proj, versions ?? {}, (k, i) => baseCode(G, k, i))
    const saved = await api.save(rev, ops)
    setRevision(saved)
    setSavedSnapshot(JSON.stringify(drafts))
    if (saved.errors?.length) {
      setIssues(serverIssues(saved.errors))
      return null
    }
    return saved
  }

  const conflict = (errors: Issue[] | undefined) => {
    // someone else changed a base asset: refresh versions so the next save re-reads them
    if (errors?.some(e => e.code === 'target.conflict')) versions = null
  }

  return {
    revision,
    busy,
    issues,
    canWrite,
    savedSnapshot,
    clearIssues: () => setIssues([]),
    load: id =>
      id
        ? run(async api => {
            const r = await api.get(id).catch(() => null)
            if (!r) return null
            setRevision(r)
            if (!EDITABLE.includes(r.status) || !r.operations?.length) return null
            const drafts = operationsToDrafts(r.operations, proj, i => baseKind(G, i))
            setSavedSnapshot(JSON.stringify(drafts))
            return drafts
          })
        : Promise.resolve(null),
    save: (drafts, name, id) => run(api => persist(api, drafts, name, id)),
    submit: (drafts, name, id) =>
      run(async api => {
        const saved = await persist(api, drafts, name, id)
        if (!saved) return null
        const v = await api.action(saved.id, 'validate')
        if (!v.isValid) {
          conflict(v.errors)
          setIssues(serverIssues(v.errors))
          setRevision(await api.get(saved.id))
          return null
        }
        await api.action(saved.id, 'submit')
        const submitted = await api.get(saved.id)
        setRevision(submitted)
        setIssues([])
        return submitted
      }),
  }
}
