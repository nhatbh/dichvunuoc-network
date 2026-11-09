/* Topology mock (`/api/gis/topology/*`, decision 0029): answers from the official demo network
   with the same graph rules as topology-rs (`@wn/contracts/topology`), so the Trace screen
   behaves offline as it does against the real services. */
import { buildTopologyGraph, isolate, trace, TraceDirection, type GraphAsset } from '@wn/contracts/topology'
import { http, HttpResponse } from 'msw'
import { officialAssets, officialVersion } from './editor-handlers'

let cache: { version: number; graph: ReturnType<typeof buildTopologyGraph> } | null = null
function graph() {
  const version = officialVersion()
  if (cache?.version !== version) {
    const assets: GraphAsset[] = officialAssets().map(a => ({
      id: a.draftAssetId,
      kind: a.kind,
      componentCode: a.attributes.componentCode ?? (a.kind === 'Pipe' ? 'Pipe' : undefined),
      fromRef: a.fromRef,
      toRef: a.toRef,
      hostRef: a.hostRef,
      state: a.attributes.state,
    }))
    cache = { version, graph: buildTopologyGraph(assets) }
  }
  return cache.graph
}
const meta = () => ({ graphVersion: officialVersion() + 1, graphReady: true })
const invalid = (detail: string) => HttpResponse.json({ code: 'VALIDATION_FAILED', detail }, { status: 400 })

export const topologyHandlers = [
  http.post('*/topology/isolation', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { pipeId?: string; nodeId?: string }
    if (!body.pipeId === !body.nodeId) return invalid('Give exactly one of pipeId or nodeId.')
    return HttpResponse.json({ ...isolate(graph(), body), ...meta() })
  }),
  http.get('*/topology/trace', ({ request }) => {
    const url = new URL(request.url)
    const from = url.searchParams.get('from')
    const direction = TraceDirection.safeParse(url.searchParams.get('direction') ?? 'downstream')
    if (!from || !direction.success) return invalid('from and direction are required.')
    return HttpResponse.json({ ...trace(graph(), from, direction.data, Number(url.searchParams.get('maxDepth')) || 0), ...meta() })
  }),
  http.get('*/topology/issues', () => HttpResponse.json({ issues: [], ...meta() })),
]
