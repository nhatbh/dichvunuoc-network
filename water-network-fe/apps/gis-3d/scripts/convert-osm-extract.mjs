#!/usr/bin/env node
/**
 * Converts a downloaded OpenStreetMap XML extract (BBBike / Geofabrik `.osm` or `.osm.gz`,
 * any area — e.g. all of Hanoi) into the small `osm-hanoi.json` the mock generator uses.
 * It is the offline alternative to `fetch-osm-hanoi.mjs` (no Overpass server needed).
 *
 *   node scripts/convert-osm-extract.mjs path/to/planet_xxx.osm.gz
 *
 * Without an argument it uses the first `*.osm.gz` / `*.osm` it finds in the repository root.
 * Streams the file (nodes → ways), so memory stays small even for a whole city. Pure Node, no packages.
 * Data © OpenStreetMap contributors, ODbL.
 */
import { createReadStream, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// south, west, north, east — must cover the DMA polygons in hanoi-network.ts (plus a little margin)
const BBOX = [21.002, 105.815, 21.056, 105.89]
const MARGIN = 0.004
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../src/shared/api/mocks/osm-hanoi.json')
const MAX_BUILDINGS = 12000
const ROAD_CLASSES = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street'])
const e5 = (v) => Math.round(v * 1e5)

function findInput() {
  if (process.argv[2]) return resolve(process.argv[2])
  const root = resolve(HERE, '../../..')
  const hit = readdirSync(root).find((f) => /\.osm(\.gz)?$/i.test(f))
  if (!hit) throw new Error('Pass the extract path: node scripts/convert-osm-extract.mjs <file.osm.gz>')
  return join(root, hit)
}

const attr = (line, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(line)
  return m ? m[1] : undefined
}

async function main() {
  const file = findInput()
  console.log('Reading', file)
  let stream = createReadStream(file)
  if (/\.gz$/i.test(file)) stream = stream.pipe(createGunzip())
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  const [s, w, n, e] = [BBOX[0] - MARGIN, BBOX[1] - MARGIN, BBOX[2] + MARGIN, BBOX[3] + MARGIN]
  const nodes = new Map() // id -> [lon, lat] (only inside the box)
  const roads = []
  const water = []
  const centres = []
  let way = null
  let nNodes = 0

  const finishWay = () => {
    if (!way) return
    const t = way.tags
    const pts = way.refs.map((id) => ({ id, p: nodes.get(id) }))
    if (t.highway && ROAD_CLASSES.has(t.highway) && t.tunnel !== 'yes' && t.area !== 'yes') {
      // keep runs of nodes that are inside the box (a way leaving the box is cut there)
      let run = []
      const flush = () => {
        if (run.length > 1)
          roads.push({ c: t.highway, ...(t.bridge && t.bridge !== 'no' ? { b: 1 } : {}), i: run.map((r) => r.id), p: run.flatMap((r) => [e5(r.p[0]), e5(r.p[1])]) })
        run = []
      }
      for (const q of pts) {
        if (q.p) run.push(q)
        else flush()
      }
      flush()
    } else if (t.building && pts.length > 3 && pts.every((q) => q.p)) {
      const m = pts.slice(0, -1)
      centres.push(e5(m.reduce((a, q) => a + q.p[0], 0) / m.length), e5(m.reduce((a, q) => a + q.p[1], 0) / m.length))
    } else if ((t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir') && pts.length > 3 && pts[0].id === pts[pts.length - 1].id && pts.every((q) => q.p)) {
      water.push({ p: pts.flatMap((q) => [e5(q.p[0]), e5(q.p[1])]) })
    }
    way = null
  }

  for await (const raw of rl) {
    const line = raw.trimStart()
    if (line.startsWith('<node ')) {
      nNodes++
      const lat = parseFloat(attr(line, 'lat'))
      const lon = parseFloat(attr(line, 'lon'))
      if (lat >= s && lat <= n && lon >= w && lon <= e) nodes.set(attr(line, 'id'), [lon, lat])
    } else if (line.startsWith('<way ')) {
      finishWay()
      way = { refs: [], tags: {} }
      if (line.endsWith('/>')) way = null
    } else if (way && line.startsWith('<nd ')) {
      way.refs.push(attr(line, 'ref'))
    } else if (way && line.startsWith('<tag ')) {
      way.tags[attr(line, 'k')] = attr(line, 'v')
    } else if (line.startsWith('</way>')) {
      finishWay()
    } else if (line.startsWith('<relation ')) {
      finishWay()
      break // relations come last; multipolygon water is not needed for the pipe network
    }
    if (nNodes && nNodes % 5_000_000 === 0 && line.startsWith('<node ')) console.log(`  …${(nNodes / 1e6).toFixed(0)}M nodes read`)
  }
  finishWay()

  const nB = centres.length / 2
  const stride = Math.max(1, Math.ceil(nB / MAX_BUILDINGS))
  const buildings = []
  for (let k = 0; k < nB; k += stride) buildings.push(centres[2 * k], centres[2 * k + 1])
  // road ids are strings in the file; the generator only needs them to match, but numbers are smaller
  for (const r of roads) r.i = r.i.map(Number)

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify({ bbox: BBOX, fetchedAt: new Date().toISOString(), attribution: '© OpenStreetMap contributors (ODbL)', roads, water, buildings }))
  console.log(`\nWrote ${OUT}\n  nodes scanned: ${nNodes}, kept in box: ${nodes.size}\n  roads: ${roads.length}, water polygons: ${water.length}, buildings: ${buildings.length / 2} of ${nB}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
