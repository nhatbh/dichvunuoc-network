// Seeds the local backend stack with the demo network (the canonical mock's 54 nodes, 93 pipes,
// valves, hydrants, plant, reservoirs and pump stations) through gis-be's own write API, so the
// SYSTEM 3D frontend has a real network to load from the BFF.
//
//   node scripts/local-stack/seed.mjs [--gis http://localhost:8081] [--force]
//
// Pipes get their end nodes by matching coordinates (a junction is registered where no node
// sits); valves go on the nearest pipe, hydrants and pumps on the nearest node. Codes become
// gis-be asset codes ([A-Za-z0-9_-]); Vietnamese material labels become material codes.
// DMAs are left out until zone-be is merged.
import { readFileSync } from 'node:fs'
// the built package itself, not the app's installed copy of it (pnpm copies file: packages at install)
import { pipeMaterialCode } from '../../../../packages/contracts/dist/catalog/index.js'
import { devToken } from './dev-token.mjs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const GIS = (arg('gis', process.env.WN_GIS_URL ?? 'http://localhost:8081')).replace(/\/$/, '')
const FORCE = process.argv.includes('--force')
const TOKEN = devToken()
const seed = JSON.parse(readFileSync(new URL('../../src/shared/api/mocks/gis-seed.json', import.meta.url), 'utf8')).network

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
    console.log(`gis-be already holds ${boot.counts.total} assets; nothing seeded (use --force to add the demo network anyway)`)
    return
  }

  // nodes: junctions, then facilities as nodes (plant/reservoir = Reservoir, elevated tank = Tank, pump station = Other)
  const nodes = [] // { id, at, code }
  const addNode = async (assetCode, nodeType, at) => {
    const { id } = await call('POST', '/api/network/nodes', { assetCode, nodeType, latitude: at[1], longitude: at[0] })
    nodes.push({ id, at, code: assetCode })
    stats.nodes++
    return id
  }
  for (const f of seed.node.features) await addNode(code(f.properties.code ?? f.id), 'Junction', f.geometry.coordinates)
  const facilityNode = new Map()
  for (const f of seed.source.features) {
    const t = f.properties.assetType
    const type = t === 'pump' ? 'Other' : /đài/i.test(f.properties.name ?? '') ? 'Tank' : 'Reservoir'
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

  const install = async (assetCode, deviceType, host, at) => {
    await call('POST', '/api/network/devices', { assetCode, deviceType, ...host, latitude: at[1], longitude: at[0] })
    stats.devices++
  }
  for (const f of seed.valve.features) {
    const at = f.geometry.coordinates
    const p = nearestPipe(at)
    if (!p || p.d > 25) { stats.skipped.push(`${f.id}: no pipe within 25 m`); continue }
    await install(code(f.properties.code ?? f.id), 'Valve', { hostPipeId: p.id }, at)
  }
  for (const f of seed.hydrant.features) {
    const at = f.geometry.coordinates
    const n = nearestNode(at)
    // a hydrant sits on its own branch node when no network node is close
    const host = n && n.d <= 5 ? n.id : await addNode(`${code(f.properties.code ?? f.id)}-N`, 'Hydrant', at)
    await install(code(f.properties.code ?? f.id), 'Hydrant', { hostNodeId: host }, at)
  }
  for (const f of seed.source.features.filter((x) => x.properties.assetType === 'pump')) {
    await install(`${code(f.properties.code ?? f.id)}-P`, 'Pump', { hostNodeId: facilityNode.get(f.id) }, f.geometry.coordinates)
  }

  const after = await call('GET', '/api/network/assets/bootstrap')
  console.log(JSON.stringify({ seeded: stats, gisCounts: after?.counts }, null, 2))
}

main().catch((e) => {
  console.error(String(e?.stack ?? e))
  process.exit(1)
})
