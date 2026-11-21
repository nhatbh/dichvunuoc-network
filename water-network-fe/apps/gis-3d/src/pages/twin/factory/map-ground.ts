/**
 * Ground of the plant's 3D view, drawn from the same raster tiles as the network map, so the area around the
 * plant and around TB1 looks exactly like it does on the map.
 *
 * Each site gets a round patch: the tiles around it are stitched north-up into one canvas (Web Mercator pixels
 * are linear in the map frame's metres), the canvas is laid on a disc in the map frame and the disc is turned
 * into the site's own frame. Towards the rim the imagery fades into the basemap's average colour, which is also
 * the colour of the ground beyond, so there is no visible edge. The ground draws first and writes no depth, so
 * it never fights with the site pads and roads drawn just above it.
 */
import * as THREE from 'three'
import { MERC_PER_M, ORIGIN_MERC, type XY } from '../data/geo'
import type { Raster } from '../ui/basemap'

const TILE = 256

export interface GroundSite {
  /** patch centre in the map frame (metres east / north of the map origin) */
  centre: XY
  /** where that centre sits in the view, and the view frame's rotation from the map frame (rad) */
  at: THREE.Vector3
  rotation: number
  radius: number
  /** deepest zoom wanted for this patch (capped by the tile server) */
  zoom: number
}

function loadImage(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    const abort = () => {
      img.src = ''
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    img.onload = () => {
      signal.removeEventListener('abort', abort)
      resolve(img)
    }
    img.onerror = () => {
      signal.removeEventListener('abort', abort)
      reject(new Error(`tile ${url}`))
    }
    img.src = url
  })
}

/** Tiles covering a square of `2·half` metres around `c` (map frame), stitched north-up; also returns its size in metres. */
async function stitch(r: Raster, c: XY, half: number, zoom: number, signal: AbortSignal) {
  const S = TILE * 2 ** zoom
  const px0 = (ORIGIN_MERC.x + (c[0] - half) * MERC_PER_M) * S
  const px1 = (ORIGIN_MERC.x + (c[0] + half) * MERC_PER_M) * S
  const py0 = (ORIGIN_MERC.y - (c[1] + half) * MERC_PER_M) * S
  const py1 = (ORIGIN_MERC.y - (c[1] - half) * MERC_PER_M) * S
  const size = Math.round(px1 - px0)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  // a tile that fails to load shows the ground colour, not a black hole
  ctx.fillStyle = `#${r.ground.toString(16).padStart(6, '0')}`
  ctx.fillRect(0, 0, size, size)
  const url = r.tiles[0]!
  const jobs: Promise<void>[] = []
  let failed = 0
  for (let ty = Math.floor(py0 / TILE); ty <= Math.floor((py1 - 1) / TILE); ty++)
    for (let tx = Math.floor(px0 / TILE); tx <= Math.floor((px1 - 1) / TILE); tx++) {
      const u = url.replace('{z}', String(zoom)).replace('{x}', String(tx)).replace('{y}', String(ty))
      jobs.push(
        loadImage(u, signal).then(
          img => ctx.drawImage(img, tx * TILE - px0, ty * TILE - py0),
          () => {
            failed++
          },
        ),
      )
    }
  await Promise.all(jobs)
  if (signal.aborted) throw new DOMException('aborted', 'AbortError')
  return { canvas, metres: size / (S * MERC_PER_M), failed, total: jobs.length }
}

/** average colour of a canvas (null when the browser refuses to read it back) */
function averageColour(canvas: HTMLCanvasElement): THREE.Color | null {
  try {
    const s = document.createElement('canvas')
    s.width = s.height = 8
    const ctx = s.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(canvas, 0, 0, 8, 8)
    const d = ctx.getImageData(0, 0, 8, 8).data
    let r = 0
    let g = 0
    let b = 0
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]!
      g += d[i + 1]!
      b += d[i + 2]!
    }
    const n = d.length / 4
    return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace)
  } catch {
    return null
  }
}

/** fade the imagery into `fill` from `inner`·radius to the rim of the inscribed disc */
function feather(canvas: HTMLCanvasElement, fill: THREE.Color, inner = 0.62) {
  const ctx = canvas.getContext('2d')!
  const h = canvas.width / 2
  const css = `#${fill.getHexString(THREE.SRGBColorSpace)}`
  const grad = ctx.createRadialGradient(h, h, h * inner, h, h, h)
  grad.addColorStop(0, `${css}00`)
  grad.addColorStop(1, `${css}ff`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, canvas.width, canvas.height)
}

const groundMaterial = (opts: THREE.MeshBasicMaterialParameters) => new THREE.MeshBasicMaterial({ toneMapped: false, depthWrite: false, ...opts })

export class MapGround {
  readonly group = new THREE.Group()
  readonly base: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  /** attribution of the tiles on show */
  attribution = ''
  onChange: () => void = () => {}
  #patches: Array<THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>> = []
  #abort: AbortController | null = null

  constructor(
    private sites: GroundSite[],
    private anisotropy: number,
    baseSize: number,
    baseAt: THREE.Vector3,
  ) {
    this.base = new THREE.Mesh(new THREE.PlaneGeometry(baseSize, baseSize), groundMaterial({ color: 0xdfe5e2 }))
    this.base.position.copy(baseAt)
    this.base.renderOrder = -2
    this.group.add(this.base)
    this.group.name = 'map-ground'
  }

  /** load the tiles of `r` for every site (cancels a load still running) */
  async show(r: Raster) {
    this.#abort?.abort()
    const ac = (this.#abort = new AbortController())
    this.attribution = r.attribution
    this.base.material.color.setHex(r.ground)
    this.onChange()
    const loaded = await Promise.all(
      this.sites.map(s =>
        stitch(r, s.centre, s.radius, Math.min(r.max, s.zoom), ac.signal).catch((e: unknown) => {
          if ((e as DOMException).name !== 'AbortError') console.warn('[twin] ground tiles', e)
          return null
        }),
      ),
    )
    if (ac.signal.aborted) return
    this.#clear()
    // one ground colour for all patches: the average of the biggest one
    const first = loaded[0]
    const avg = first && first.failed < first.total ? averageColour(first.canvas) : null
    const fill = avg ?? new THREE.Color().setHex(r.ground)
    this.base.material.color.copy(fill)
    loaded.forEach((l, i) => {
      if (!l || l.failed === l.total) return
      const s = this.sites[i]!
      feather(l.canvas, fill)
      const tex = new THREE.CanvasTexture(l.canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = this.anisotropy
      // the disc is inscribed in the stitched square: its UVs span the whole texture
      const m = new THREE.Mesh(new THREE.CircleGeometry(l.metres / 2, 96), groundMaterial({ map: tex }))
      m.rotation.z = s.rotation
      m.position.copy(s.at)
      m.renderOrder = -1
      this.group.add(m)
      this.#patches.push(m)
    })
    this.onChange()
  }

  #clear() {
    for (const p of this.#patches) {
      p.material.map?.dispose()
      p.material.dispose()
      p.geometry.dispose()
      p.removeFromParent()
    }
    this.#patches = []
  }

  dispose() {
    this.#abort?.abort()
    this.#clear()
    this.base.geometry.dispose()
    this.base.material.dispose()
  }
}
