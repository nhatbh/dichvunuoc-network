// Seeds the local backend stack through gis-be's own write API, so the SYSTEM 3D frontend has a
// real network to load from the BFF.
//
//   node scripts/local-stack/seed.mjs [--gis http://localhost:8081] [--force]
//        [--network <draft-assets.json> | --demo]
//
// Default: the Vĩnh Thịnh Đợt 3 network — the CAD import service's own output for the drawing
// "1.MB-PP-Vinh Thinh - Dot 3.dwg" with networks/vinh-thinh-dot3.review.json
// (networks/vinh-thinh-dot3.drafts.json; see networks/README.md to regenerate it). Every draft
// is registered as the importer produced it: its component, host, and the catalog properties
// among its attributes. Nothing is added.
//
// --demo: the canonical mock's demo network (54 nodes, 93 pipes, valves, hydrants, plant,
// reservoirs and pump stations), mapped as follows.
//
// Pipes get their end nodes by matching coordinates (a junction is registered where no node
// sits); valves go on the nearest pipe, hydrants and pumps on the nearest node. Codes become
// gis-be asset codes ([A-Za-z0-9_-]); Vietnamese material labels become material codes.
// DMAs are left out until zone-be is merged.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// the built package itself, not the app's installed copy of it (pnpm copies file: packages at install)
import { pipeMaterialCode, propertiesIn } from '../../../../packages/contracts/dist/catalog/index.js'
import { devToken } from './dev-token.mjs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const GIS = (arg('gis', process.env.WN_GIS_URL ?? 'http://localhost:8081')).replace(/\/$/, '')
const FORCE = process.argv.includes('--force')
const TOKEN = devToken()
const DEMO = process.argv.includes('--demo')
const NETWORK = arg('network', fileURLToPath(new URL('./networks/vinh-thinh-dot3.drafts.json', import.meta.url)))

const M_PER_DEG = 111_320
const metres = (a, b) => {
  const k = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180))
  return Math.hypot((a[0] - b[0]) * M_PER_DEG * k, (a[1] - b[1]) * M_PER_DEG)
}
const toSegment = (p, a, b) => {
  const k = Math.cos(p[1] * (Math.PI / 180))
  const P = [p[0] * k, p[1]], A = [a[0] * k, a[1]], B = [b[0] * k, b[1]]
  const dx = B[0] - A[0], dy = B[1] - A[1]
  const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(P[0] - A[0] - t * dx, P[1] - A[1] - t * dy) * M_PER_DEG
}
const code = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)

async function call(method, path, body) {
  const res = await fetch(`${GIS}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

const stats = { nodes: 0, autoJunctions: 0, pipes: 0, devices: 0, skipped: [] }

async function main() {
  const boot = await call('GET', '/api/network/assets/bootstrap')
  if (boot?.counts?.total > 0 && !FORCE) {
    console.log(`gis-be already holds ${boot.counts.total} assets; nothing seeded (use --force to add the network anyway)`)
    return
  }

  if (!DEMO) return seedNetwork(JSON.parse(readFileSync(NETWORK, 'utf8')))
  const seed = JSON.parse(readFileSync(new URL('../../src/shared/api/mocks/gis-seed.json', import.meta.url), 'utf8')).network

  // nodes: junctions, then facilities as nodes (plant/reservoir = Reservoir, elevated tank = Tank,
  // pump station = PumpStation). Every asset names its catalog component (decision 0028).
  const nodes = [] // { id, at, code }
  const addNode = async (assetCode, componentCode, at) => {
    const { id } = await call('POST', '/api/network/nodes', { assetCode, componentCode, latitude: at[1], longitude: at[0] })
    nodes.push({ id, at, code: assetCode })
    stats.nodes++
    return id
  }
  for (const f of seed.node.features) await addNode(code(f.properties.code ?? f.id), 'Junction', f.geometry.coordinates)
  const facilityNode = new Map() // seed facility id → node id
  for (const f of seed.source.features) {
    const t = f.properties.assetType
    const type = t === 'pump' ? 'PumpStation' : /đài/i.test(f.properties.name ?? '') ? 'Tank' : 'Reservoir'
    facilityNode.set(f.id, await addNode(code(f.properties.code ?? f.id), type, f.geometry.coordinates))
  }

  const nodeAt = async (at) => {
    let best = null
    for (const n of nodes) {
      const d = metres(n.at, at)
      if (d < 1 && (!best || d < best.d)) best = { id: n.id, d }
    }
    if (best) return best.id
    stats.autoJunctions++
    return addNode(`J-AUTO-${String(stats.autoJunctions).padStart(3, '0')}`, 'Junction', at)
  }

  // pipes
  const pipes = [] // { id, coords }
  for (const f of seed.pipe.features) {
    const c = f.geometry.coordinates
    const material = pipeMaterialCode(f.properties.material ?? '')
    if (!material) {
      stats.skipped.push(`${f.id}: unknown material ${f.properties.material}`)
      continue
    }
    const from = await nodeAt(c[0])
    const to = await nodeAt(c[c.length - 1])
    const { id } = await call('POST', '/api/network/pipes', {
      assetCode: code(f.properties.code ?? f.id),
      fromNodeId: from,
      toNodeId: to,
      points: c.map(([lng, lat]) => ({ lat, lng })),
      diameterMm: Math.round(f.properties.dn ?? 100),
      material,
      lengthM: null,
    })
    pipes.push({ id, coords: c })
    stats.pipes++
  }

  const nearestPipe = (at) => {
    let best = null
    for (const p of pipes)
      for (let i = 1; i < p.coords.length; i++) {
        const d = toSegment(at, p.coords[i - 1], p.coords[i])
        if (!best || d < best.d) best = { id: p.id, d }
      }
    return best
  }
  const nearestNode = (at) => nodes.reduce((b, n) => {
    const d = metres(n.at, at)
    return !b || d < b.d ? { id: n.id, d } : b
  }, null)

  const install = async (assetCode, componentCode, host, at, properties) => {
    await call('POST', '/api/network/devices', { assetCode, componentCode, ...host, latitude: at[1], longitude: at[0], properties })
    stats.devices++
  }
  for (const f of seed.valve.features) {
    const at = f.geometry.coordinates
    const p = nearestPipe(at)
    if (!p || p.d > 25) { stats.skipped.push(`${f.id}: no pipe within 25 m`); continue }
    const kind = String(f.properties.kind ?? '').toLowerCase()
    const component = kind.includes('butterfly') || kind.includes('bướm') ? 'ButterflyValve' : 'GateValve'
    const state = ['open', 'closed', 'throttled'].includes(f.properties.state) ? { state: f.properties.state } : undefined
    await install(code(f.properties.code ?? f.id), component, { hostPipeId: p.id }, at, state)
  }
  for (const f of seed.hydrant.features) {
    const at = f.geometry.coordinates
    const n = nearestNode(at)
    // a hydrant sits on its own branch node when no network node is close
    const host = n && n.d <= 5 ? n.id : await addNode(`${code(f.properties.code ?? f.id)}-N`, 'Junction', at)
    await install(code(f.properties.code ?? f.id), 'Hydrant', { hostNodeId: host }, at)
  }
  // pump stations are PumpStation nodes (above); a Pump device sits on a pipe, so none is added here

  const after = await call('GET', '/api/network/assets/bootstrap')
  console.log(JSON.stringify({ seeded: stats, gisCounts: after?.counts }, null, 2))
}

// The CAD import's draft assets (draft-assets.json): nodes, pipes between node refs, devices on a
// pipe or node ref, all named by catalog component (decision 0028).
async function seedNetwork({ assets }) {
  const id = new Map() // draft clientRef → gis-be id
  const props = (code, attrs) => {
    const p = propertiesIn(code, attrs)
    return Object.keys(p).length ? p : undefined
  }
  for (const a of assets.filter((x) => x.kind === 'Node')) {
    const [lon, lat] = a.geometry.coordinates[0]
    const code = a.attributes.componentCode
    const r = await call('POST', '/api/network/nodes', {
      assetCode: a.assetCode, componentCode: code, latitude: lat, longitude: lon, properties: props(code, a.attributes),
    })
    id.set(a.clientRef, r.id)
    stats.nodes++
  }
  for (const a of assets.filter((x) => x.kind === 'Pipe')) {
    const r = await call('POST', '/api/network/pipes', {
      assetCode: a.assetCode,
      fromNodeId: id.get(a.fromRef),
      toNodeId: id.get(a.toRef),
      points: a.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      diameterMm: Number(a.attributes.diameterMm),
      material: a.attributes.material,
      lengthM: Number(a.attributes.lengthM),
      properties: props('Pipe', a.attributes),
    })
    id.set(a.clientRef, r.id)
    stats.pipes++
  }
  for (const a of assets.filter((x) => x.kind === 'Device')) {
    const [lon, lat] = a.geometry.coordinates[0]
    const code = a.attributes.componentCode
    const onPipe = assets.some((x) => x.kind === 'Pipe' && x.clientRef === a.hostRef)
    await call('POST', '/api/network/devices', {
      assetCode: a.assetCode,
      componentCode: code,
      hostPipeId: onPipe ? id.get(a.hostRef) : null,
      hostNodeId: onPipe ? null : id.get(a.hostRef),
      latitude: lat,
      longitude: lon,
      properties: props(code, a.attributes),
    })
    stats.devices++
  }
  const after = await call('GET', '/api/network/assets/bootstrap')
  console.log(JSON.stringify({ network: NETWORK, seeded: stats, gisCounts: after?.counts }, null, 2))
}

main().catch((e) => {
  console.error(String(e?.stack ?? e))
  process.exit(1)
})
