#!/usr/bin/env node
/**
 * Run-once helper: downloads the OpenStreetMap data the Hanoi mock network is built from
 * (roads, water, building centroids) and writes it to
 *   src/shared/api/mocks/osm-hanoi.json
 *
 *   node scripts/fetch-osm-hanoi.mjs            # or: pnpm run osm:fetch
 *
 * Needs Node 18+ and internet access to an Overpass API server (several mirrors are tried).
 * The result is committed-able (a few MB); the seed generator uses it automatically when present
 * and falls back to the built-in synthetic street grid when it is not.
 *
 * Data © OpenStreetMap contributors, ODbL — keep the attribution if you ship it.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// south, west, north, east — must cover the DMA polygons in hanoi-network.ts
const BBOX = [21.002, 105.815, 21.056, 105.89]
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/shared/api/mocks/osm-hanoi.json')
const MAX_BUILDINGS = 12000
const SERVERS = [
  ...(process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : []),
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]
const HEADERS = {
  'User-Agent': 'water-platform-gis-3d-demo/1.0 (one-off mock data fetch)',
  Accept: 'application/json',
  'Content-Type': 'application/x-www-form-urlencoded',
}
const ROAD_CLASSES = ['trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const e5 = (v) => Math.round(v * 1e5)

async function overpass(query, label) {
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of SERVERS) {
      try {
        console.log(`  ${label}: asking ${new URL(url).host}… (up to 2 min)`)
        const res = await fetch(url, { method: 'POST', headers: HEADERS, body: 'data=' + encodeURIComponent(query), signal: AbortSignal.timeout(120_000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        console.log(`  ${label}: ${json.elements.length} elements from ${new URL(url).host}`)
        return json.elements
      } catch (err) {
        lastErr = err
        console.warn(`  ${label}: ${new URL(url).host} failed (${err.message}); trying next`)
      }
    }
    await sleep(5000 * (attempt + 1))
  }
  throw new Error(`Overpass failed for ${label}: ${lastErr?.message}`)
}

/** Split the bbox into nx × ny tiles so each request stays small. */
function tiles(nx, ny) {
  const [s, w, n, e] = BBOX
  const out = []
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      out.push([s + ((n - s) * j) / ny, w + ((e - w) * i) / nx, s + ((n - s) * (j + 1)) / ny, w + ((e - w) * (i + 1)) / nx])
  return out
}
const bb = (t) => t.map((v) => v.toFixed(5)).join(',')

/** Join open way fragments into closed rings (multipolygon outers). */
function stitch(parts) {
  const rings = []
  const open = parts.filter((p) => p.length > 1).map((p) => p.slice())
  const same = (a, b) => a[0] === b[0] && a[1] === b[1]
  while (open.length) {
    let ring = open.pop()
    let grew = true
    while (grew && !same(ring[0], ring[ring.length - 1])) {
      grew = false
      for (let i = 0; i < open.length; i++) {
        const o = open[i]
        if (same(ring[ring.length - 1], o[0])) ring = ring.concat(o.slice(1))
        else if (same(ring[ring.length - 1], o[o.length - 1])) ring = ring.concat(o.slice().reverse().slice(1))
        else if (same(ring[0], o[o.length - 1])) ring = o.concat(ring.slice(1))
        else if (same(ring[0], o[0])) ring = o.slice().reverse().concat(ring.slice(1))
        else continue
        open.splice(i, 1)
        grew = true
        break
      }
    }
    if (ring.length > 3 && same(ring[0], ring[ring.length - 1])) rings.push(ring)
  }
  return rings
}

const flat = (pts) => pts.flatMap(([lon, lat]) => [e5(lon), e5(lat)])
const geom = (g) => g.map((p) => [p.lon, p.lat])

async function main() {
  console.log('Fetching OpenStreetMap data for central Hanoi…')

  // roads
  const roads = new Map()
  for (const t of tiles(2, 2)) {
    const q = `[out:json][timeout:120];way["highway"~"^(${ROAD_CLASSES.join('|')})$"]["tunnel"!="yes"]["area"!="yes"](${bb(t)});out geom tags;`
    for (const el of await overpass(q, 'roads')) {
      if (el.type !== 'way' || roads.has(el.id) || !el.geometry || !el.nodes) continue
      const c = el.tags?.highway
      if (!ROAD_CLASSES.includes(c)) continue
      roads.set(el.id, { c, ...(el.tags?.bridge && el.tags.bridge !== 'no' ? { b: 1 } : {}), i: el.nodes, p: flat(geom(el.geometry)) })
    }
    await sleep(1500)
  }

  // water
  const water = []
  const seenWater = new Set()
  for (const t of tiles(2, 2)) {
    const q = `[out:json][timeout:120];(way["natural"="water"](${bb(t)});way["waterway"="riverbank"](${bb(t)});way["landuse"="reservoir"](${bb(t)});relation["natural"="water"](${bb(t)});relation["waterway"="riverbank"](${bb(t)}););out geom tags;`
    for (const el of await overpass(q, 'water')) {
      const key = el.type + el.id
      if (seenWater.has(key)) continue
      seenWater.add(key)
      if (el.type === 'way' && el.geometry) {
        const g = geom(el.geometry)
        if (g.length > 3 && g[0][0] === g[g.length - 1][0] && g[0][1] === g[g.length - 1][1]) water.push({ p: flat(g) })
      } else if (el.type === 'relation') {
        const outers = (el.members ?? []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => geom(m.geometry))
        for (const ring of stitch(outers)) water.push({ p: flat(ring) })
      }
    }
    await sleep(1500)
  }

  // buildings (centroids only)
  const seenB = new Set()
  const centres = []
  for (const t of tiles(3, 3)) {
    const q = `[out:json][timeout:180];(way["building"](${bb(t)}););out center qt;`
    for (const el of await overpass(q, 'buildings')) {
      if (seenB.has(el.id) || !el.center) continue
      seenB.add(el.id)
      centres.push(e5(el.center.lon), e5(el.center.lat))
    }
    await sleep(2500)
  }
  const nB = centres.length / 2
  const stride = Math.max(1, Math.ceil(nB / MAX_BUILDINGS))
  const buildings = []
  for (let k = 0; k < nB; k += stride) buildings.push(centres[2 * k], centres[2 * k + 1])

  const data = { bbox: BBOX, fetchedAt: new Date().toISOString(), attribution: '© OpenStreetMap contributors (ODbL)', roads: [...roads.values()], water, buildings }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(data))
  console.log(`\nWrote ${OUT}\n  roads: ${data.roads.length}, water polygons: ${water.length}, buildings (sampled): ${buildings.length / 2} of ${nB}`)
  console.log('Restart `pnpm run dev:mock` to see the pipes follow the streets.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
