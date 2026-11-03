/* Import Tam Dương (Vĩnh Phúc) real network → gis-full.json (window.GIS shape).
   Source: real GeoJSON fixtures (EPSG:4326) exported from the unit's GPX. Geometry is
   encoded to the FE's pixel space via the INVERSE affine (lonLatToPx) — the OL viewer/
   editor decode it back with pxToLonLat, so features land at their true position on the
   real basemap (exact round-trip). Real fields (DN from diameterMm) are kept; fields the
   source lacks (material/cond/valves/nodes) get sensible defaults / stay empty.

   Usage: node scripts/import-tam-duong.mjs <fixturesDir> <catalogFullJson> <outFile>       */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [, , FIX, CATALOG, OUT] = process.argv
if (!FIX || !CATALOG || !OUT) {
  console.error('usage: node import-tam-duong.mjs <fixturesDir> <catalogFullJson> <outFile>')
  process.exit(1)
}

/* ── inverse pixel affine (mirror packages/map-runtime/src/pixel-affine.ts) ── */
const LON0 = 105.8,
  LAT0 = 21.04,
  U2M = 1.15
const M_PER_DEG_LAT = 111132
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180)
const toPx = ([lon, lat]) => [Math.round(((lon - LON0) * M_PER_DEG_LON) / U2M), Math.round(((LAT0 - lat) * M_PER_DEG_LAT) / U2M)]

/* ── real ground length (haversine, metres) ── */
const R = 6371000
const hav = (a, b) => {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180,
    dLon = ((b[0] - a[0]) * Math.PI) / 180
  const la1 = (a[1] * Math.PI) / 180,
    la2 = (b[1] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
const lineMeters = (lls) => {
  let s = 0
  for (let i = 1; i < lls.length; i++) s += hav(lls[i - 1], lls[i])
  return s
}

/* ── Vĩnh Phúc bbox filter (drop GPX outliers: stray points near lat 12 / lon 100) ── */
const IN = ([lon, lat]) => lon > 105.3 && lon < 105.75 && lat > 21.2 && lat < 21.6
const cleanLine = (coords) => coords.filter(IN)

const readFix = (name) => {
  const d = JSON.parse(readFileSync(resolve(FIX, name), 'utf8'))
  return d.features || d
}

/* point-in-polygon (ray cast) on real lon/lat */
const pip = (pt, ring) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1],
      xj = ring[j][0],
      yj = ring[j][1]
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/* ── admin wards → DMA zones ── */
const wards = JSON.parse(readFileSync(resolve(FIX, 'admin-units.geojson'), 'utf8')).features
const DMA_COLS = ['#0E7C86', '#0969DA', '#1A7F37', '#8250DF', '#9A6700', '#D86C1F', '#D1242F', '#0891B2']
const dmas = wards.map((w, i) => {
  const ring = w.geometry.type === 'Polygon' ? w.geometry.coordinates[0] : w.geometry.coordinates[0][0]
  return { id: 'DMA-' + String(i + 1).padStart(2, '0'), name: w.properties.name_vi, col: DMA_COLS[i % DMA_COLS.length], poly: ring.map(toPx), _ring: ring }
})
const dmaAt = (ll) => {
  for (const d of dmas) if (pip(ll, d._ring)) return d.id
  return dmas[0] ? dmas[0].id : 'DMA-01'
}

/* ── pipes (existing + design) ── */
const matOf = (name) => (/HD|HDPE/i.test(name || '') ? 'HDPE' : 'Gang dẻo')
const condRoll = (i) => (i % 11 === 0 ? 'poor' : i % 5 === 0 ? 'fair' : 'good')
let pseq = 0
const buildPipes = (feats, plane) =>
  feats
    .map((f) => {
      const lls = cleanLine(f.geometry.coordinates)
      if (lls.length < 2) return null
      const dn = f.properties.diameterMm || 100
      const mid = lls[Math.floor(lls.length / 2)]
      const name = f.properties.name || f.properties.description || ''
      const id = 'P-' + String(++pseq).padStart(4, '0')
      const pts = lls.map(toPx)
      return {
        id,
        code: name || id,
        from: id + '-a',
        to: id + '-b',
        dn,
        trunk: dn >= 200,
        material: matOf(name),
        year: 2018 + (pseq % 8),
        cond: condRoll(pseq),
        status: plane === 'design' ? 'planned' : 'active',
        lenM: Math.round(lineMeters(lls)),
        pts,
        dma: dmaAt(mid),
      }
    })
    .filter(Boolean)

const pipes = [...buildPipes(readFix('pipes-existing.json'), 'existing'), ...buildPipes(readFix('pipes-design.json'), 'design')]
const pipeBy = Object.fromEntries(pipes.map((p) => [p.id, p]))

/* ── facilities (Point) → plant + reservoirs + pumps ── */
const facs = readFix('facility.json').filter((f) => IN(f.geometry.coordinates))
const facPt = (f) => toPx(f.geometry.coordinates)
const plantF = facs.find((f) => /nhà máy nước tam d/i.test(f.properties.name)) || facs[0]
const plant = plantF ? { id: 'PLANT-01', name: plantF.properties.name, ...xy(facPt(plantF)), flow: 12000 } : { id: 'PLANT-01', name: 'Nhà máy nước', x: 0, y: 0, flow: 12000 }
const reservoirs = facs
  .filter((f) => f !== plantF && /nhà máy|bể|đài/i.test(f.properties.name))
  .map((f, i) => ({ id: 'RES-' + (i + 1), name: f.properties.name, ...xy(facPt(f)), cap: 5000, level: 70, dma: dmaAt(f.geometry.coordinates) }))
const pumps = facs
  .filter((f) => /tăng áp|bơm|tb /i.test(f.properties.name))
  .map((f, i) => ({ id: 'PUMP-' + (i + 1), name: f.properties.name, ...xy(facPt(f)), pumps: 2, run: 1, dma: dmaAt(f.geometry.coordinates) }))

function xy(p) {
  return { x: p[0], y: p[1] }
}

/* ── world bbox (px) covering all geometry ── */
const allPx = [...pipes.flatMap((p) => p.pts), ...dmas.flatMap((d) => d.poly)]
const xs = allPx.map((p) => p[0]),
  ys = allPx.map((p) => p[1])
const world = { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), x0: Math.min(...xs), y0: Math.min(...ys) }

/* ── DASH (computed) ── */
const pipeKm = Math.round(pipes.reduce((s, p) => s + p.lenM, 0) / 100) / 10
const condMixDef = { good: '#1A7F37', fair: '#9A6700', poor: '#D1242F', abandoned: '#8B949E' }
const condMix = Object.entries(condMixDef).map(([k, col]) => ({ k, label: k, col, n: pipes.filter((p) => p.cond === k).length }))
const matMix = ['HDPE', 'Gang dẻo'].map((label) => ({ label, n: pipes.filter((p) => p.material === label).length }))

/* ── keep catalogs from the synthetic seed ── */
const cat = JSON.parse(readFileSync(resolve(CATALOG), 'utf8'))
const keep = (k, fallback) => (cat[k] !== undefined ? cat[k] : fallback)

const out = {
  TODAY: cat.TODAY || '01/07/2026',
  SRID: 'EPSG:4326 (WGS84)',
  world: { w: world.w, h: world.h },
  nodes: [],
  pipes,
  pipeBy,
  valves: [],
  hydrants: [],
  plant,
  reservoirs,
  pumps,
  dmas: dmas.map(({ _ring, ...d }) => d),
  blocks: [],
  parks: [],
  river: '',
  lake: [],
  connDots: [],
  connections: [],
  LAYERS: keep('LAYERS', []),
  assets: [],
  ASSET_TYPES: keep('ASSET_TYPES', {}),
  COND: keep('COND', {}),
  PSTATUS: keep('PSTATUS', {}),
  MATERIALS: keep('MATERIALS', ['HDPE', 'Gang dẻo', 'uPVC', 'Thép', 'Gang xám']),
  CTYPE: keep('CTYPE', {}),
  TOPO_KINDS: keep('TOPO_KINDS', {}),
  topoIssues: [],
  isolation: keep('isolation', {}),
  importJobs: keep('importJobs', []),
  importErrors: [],
  changeSets: [],
  fieldObs: [],
  offlinePkgs: [],
  ROLES: keep('ROLES', []),
  DATAFLOW: keep('DATAFLOW', { inputs: [], outputs: [] }),
  DASH: {
    pipeKm,
    pipeCount: pipes.length,
    valveCount: 0,
    hydrantCount: 0,
    connCount: 0,
    dmaCount: dmas.length,
    topoOpen: 0,
    csPending: 0,
    importPending: 0,
    fieldPending: 0,
    geocodedPct: 0,
    rtkPct: 0,
    condMix,
    matMix,
  },
  SERVICES: keep('SERVICES', {}),
  LINK_STATE: keep('LINK_STATE', {}),
}

writeFileSync(resolve(OUT), JSON.stringify(out))
console.log(`Tam Dương → ${OUT}`)
console.log(`  pipes: ${pipes.length} (existing+design) · pipeKm: ${pipeKm} · DMA(wards): ${dmas.length}`)
console.log(`  plant: ${plant.name} · reservoirs: ${reservoirs.length} · pumps: ${pumps.length}`)
console.log(`  world px: ${world.w} × ${world.h}`)
