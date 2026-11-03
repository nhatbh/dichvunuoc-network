import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const LON0 = 105.8, LAT0 = 21.04, U2M = 1.15
const M_PER_DEG_LAT = 111132
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180)
const lon = (x) => LON0 + (x * U2M) / M_PER_DEG_LON
const lat = (y) => LAT0 - (y * U2M) / M_PER_DEG_LAT
const pt = (x, y) => [Number(lon(x).toFixed(7)), Number(lat(y).toFixed(7))]

// run data.js in a sandbox with a window shim
const code = readFileSync(resolve(here, '_design/gis-data.js'), 'utf8')
const win = {}
const fn = new Function('window', code)
fn(win)
const G = win.GIS

const fc = (features) => ({ type: 'FeatureCollection', features })
const feat = (id, geometry, properties) => ({ type: 'Feature', id, geometry, properties })

// pipe → LineString
const pipeFC = fc(G.pipes.map((p) =>
  feat(p.id, { type: 'LineString', coordinates: [pt(p.pts[0][0], p.pts[0][1]), pt(p.pts[1][0], p.pts[1][1])] },
    { kind: 'pipe', assetType: 'pipe', code: p.code, name: `Ống DN${p.dn} · ${p.material}`,
      dma: p.dma, status: p.status, dn: p.dn, material: p.material, cond: p.cond, trunk: !!p.trunk })))

const ptFeat = (a, assetType, kind, name, extra) =>
  feat(a.id, { type: 'Point', coordinates: pt(a.x, a.y) },
    { kind, assetType, code: a.code ?? a.id, name, dma: a.dma ?? null, status: a.status ?? 'ok', ...extra })

const valveFC = fc(G.valves.map((v) => ptFeat(v, 'valve', 'component',
  `Van ${v.kind === 'boundary' ? 'biên DMA' : 'chặn'} DN${v.dn}`, { dn: v.dn, vkind: v.kind, state: v.state })))
const hydrantFC = fc(G.hydrants.map((h) => ptFeat(h, 'hydrant', 'component', 'Trụ cứu hoả', {})))
const nodeFC = fc(G.nodes.map((n) => ptFeat(n, 'node', 'node', `Nút lưới ${n.code}`, { z: n.z })))
const sourceFC = fc([
  ptFeat(G.plant, 'plant', 'facility', G.plant.name, {}),
  ...G.reservoirs.map((r) => ptFeat(r, 'reservoir', 'facility', r.name, { cap: r.cap, level: r.level })),
  ...G.pumps.map((s) => ptFeat(s, 'pump', 'facility', s.name, { pumps: s.pumps, run: s.run })),
])
const ring = (poly) => [...poly.map((q) => pt(q[0], q[1])), pt(poly[0][0], poly[0][1])]
const dmaFC = fc(G.dmas.map((d) =>
  feat(d.id, { type: 'Polygon', coordinates: [ring(d.poly)] },
    { kind: 'component', assetType: 'dma', code: d.id, name: d.name, dma: d.id, status: 'ok', col: d.col })))

const seed = {
  today: G.TODAY, srid: G.SRID,
  dashboard: G.DASH,
  layers: G.LAYERS,
  network: { pipe: pipeFC, valve: valveFC, hydrant: hydrantFC, node: nodeFC, source: sourceFC, dma: dmaFC },
}

// output to the seed directory inside the C# project (ContentRootPath at runtime)
const out = resolve(here, '../water-network-gis-bff/WaterNetwork.GisBff/seed/gis-seed.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(seed))
console.log('seed written:', out)
console.log('pipes:', G.pipes.length, '| valves:', G.valves.length, '| hydrants:', G.hydrants.length, '| nodes:', G.nodes.length)

// ── FULL dataset dump ────────────────────────────────────────────────────────
// The design's screens (Dashboard / Map / NetworkMap SVG) read the raw
// `window.GIS` object directly (pixel coords + every collection). We dump the
// full shape to JSON, dropping the FUNCTION members (midOf / assetLinks / dmaOf)
// — the FE recomputes `midOf` client-side and ServiceLinks is a stub here.
const { midOf: _midOf, assetLinks: _assetLinks, dmaOf: _dmaOf, ...full } = G
const fullOut = resolve(here, '../water-network-gis-bff/WaterNetwork.GisBff/seed/gis-full.json')
writeFileSync(fullOut, JSON.stringify(full))
console.log('full written:', fullOut)

// Mirror into the FE mock dir so MSW can serve /full offline.
const feFullOut = resolve(here, '../apps/gis/src/shared/api/mocks/gis-full.json')
mkdirSync(dirname(feFullOut), { recursive: true })
writeFileSync(feFullOut, JSON.stringify(full))
console.log('full mirrored to FE mock:', feFullOut)
console.log('full keys:', Object.keys(full).join(', '))

// validation: print a sample pipe's first coordinate
const samplePipe = seed.network.pipe.features[0]
const [sLon, sLat] = samplePipe.geometry.coordinates[0]
console.log(`sample pipe[0] coord: lon=${sLon}, lat=${sLat}`)
console.log('dashboard.pipeKm:', seed.dashboard.pipeKm.toFixed(3))
