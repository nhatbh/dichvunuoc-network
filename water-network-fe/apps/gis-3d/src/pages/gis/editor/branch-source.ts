/* Where the editor's branches live: the browser store for the demo network, the tenant's design
   revisions for the live network (plan EDT-2). */
import { createQuery } from '@tanstack/solid-query'
import { createEffect, createMemo, createSignal, onCleanup, type Accessor, type Setter } from 'solid-js'
import { useSession } from '@/entities/session/api/use-session'
import { importSessionScope } from '../import-workspace/api'
import { scLoadBranches, scSaveBranches, type Branch } from '../lib/branch-store'
import type { GisData } from '../lib/gis-data'
import { OFFICIAL_BRANCH_ID, liveBranches, type RevisionRow } from './live-branches'
import { createNetworkEditorApi } from './revision-api'

export const REVISIONS_QUERY_KEY = ['editor', 'revisions'] as const

export function createBranchSource(G: GisData): { branches: Accessor<Branch[]>; setBranches: Setter<Branch[]> } {
  if (!G.canonical) {
    // the demo network keeps its scenario branches in the browser
    const [branches, setBranches] = createSignal<Branch[]>(scLoadBranches())
    createEffect(() => scSaveBranches(branches()))
    return { branches, setBranches }
  }
  const session = useSession()
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  const revisions = createQuery(() => ({
    queryKey: REVISIONS_QUERY_KEY,
    queryFn: async () =>
      (await createNetworkEditorApi(importSessionScope(session.data()), controller.signal).list()) as RevisionRow[],
    refetchInterval: 15_000,
  }))
  // branches started here and not yet listed by the server (their revision is made on first save)
  const [started, setStarted] = createSignal<Branch[]>([])
  const network = createMemo(() => ({
    pipeKm: Math.round(G.pipes.reduce((sum, p) => sum + (p.lenM || 0), 0) / 100) / 10,
    assets: G.nodes.length + G.pipes.length + G.valves.length + G.hydrants.length,
    today: G.TODAY,
  }))
  const branches = createMemo(() => liveBranches(revisions.data ?? [], started(), network()))
  const setBranches: Setter<Branch[]> = (next => {
    const all = typeof next === 'function' ? (next as (prev: Branch[]) => Branch[])(branches()) : next
    const listed = new Set((revisions.data ?? []).map(r => r.id))
    setStarted(all.filter(b => b.id !== OFFICIAL_BRANCH_ID && !listed.has(b.id)))
    if (all.some(b => b.revisionId && !listed.has(b.revisionId))) void revisions.refetch()
    return all
  }) as Setter<Branch[]>
  return { branches, setBranches }
}
