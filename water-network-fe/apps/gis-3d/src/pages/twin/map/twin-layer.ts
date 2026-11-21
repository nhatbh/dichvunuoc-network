/**
 * MapLibre custom layer drawing the twin's three.js scene in the map's WebGL context (shared depth buffer).
 * The scene is authored in the local metric frame of geo.ts; each frame the map's projection is combined with
 * the frame's mercator transform, the camera position is recovered from that matrix, and the LoD managers
 * (network chunks, plant, intake) pick their level from the map's zoom: one level per object for the whole view, so
 * a tilted view does not draw its near and far parts at different levels.
 */
import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LOD_HYSTERESIS, metresPerPx, NetworkLod, type LodLevel } from './network-lod'
import { MERC_PER_M, ORIGIN_MERC, type XY } from '../data/geo'
import { DEVICE_BY_ID, isServiceDevice, NET_DEVICES } from '../data/network-devices'
import { INTAKE_MAP_SCALE, NET, PIPE_BY_ID, segDist, type NetPipe } from '../data/network-model'
import { INTAKE, PLANT } from '../data/plant-model'
import { buildIntake, INTAKE_ANIM, INTAKE_HEADING, INTAKE_REACH } from '../three/intake-builder'
import { buildPlant } from '../three/plant-builder'
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl'

export type SiteLevel = 0 | 1 | 2 | 3
export type PickInfo = { type: 'plant' } | { type: 'intake' } | { type: 'pipe'; id: string } | { type: 'valve'; code: string } | { type: 'device'; id: string }

export interface RenderStats {
  fps: number
  calls: number
  triangles: number
  chunks: number[]
  /** catalog components drawn as 3D models (L2 chunks) */
  devices: number
  plant: SiteLevel
  intake: SiteLevel
  camDist: number
  zoom: number
}

/** the most a site's massing is raised from afar (its footprint always scales with the map) */
const MAX_RAISE = 3
/** How a site keeps some height from afar, in its massing level (L1): its buildings rise towards `minHeightPx`. */
interface Presence {
  /** the tallest building (m) */
  tallest: number
  minHeightPx: number
  /** the whole site drawn this many times its size (1 = true size) */
  scale?: number
}

/** A site (plant, intake) with one model per level, chosen by map zoom; the massing (L1) shows at every zoom below. */
class SiteLod {
  readonly group = new THREE.Group()
  readonly levels: Partial<Record<1 | 2 | 3, THREE.Group>> = {}
  level: SiteLevel = 0
  hitbox: THREE.Mesh | null = null
  constructor(
    private build: (l: 1 | 2 | 3) => { group: THREE.Group; hitbox: THREE.Mesh },
    origin: XY,
    rotation: number,
    private radius: number,
    /** map zoom from which levels 3, 2 and 1 are drawn */
    readonly zooms: [number, number, number],
    private presence: Presence,
  ) {
    this.group.position.set(origin[0], origin[1], 0)
    this.group.rotation.z = rotation
    this.group.scale.setScalar(presence.scale ?? 1)
  }
  update(zoom: number, frustum?: THREE.Frustum): SiteLevel {
    const lvl = this.#level(zoom, frustum)
    const g = this.levels[1]
    if (g) {
      // from afar the massing keeps its footprint (it shrinks with the map) but its buildings are raised a little,
      // up to MAX_RAISE times, so the works still stand out of the ground
      const p = this.presence
      const raise = Math.min(MAX_RAISE, Math.max(1, (p.minHeightPx * metresPerPx(zoom)) / p.tallest))
      // back to true height over the last zoom level before the detailed model, so it does not jump at the switch
      const fade = Math.min(1, Math.max(0, (this.zooms[1] - zoom) / 1))
      const sv = lvl === 1 ? 1 + (raise - 1) * fade : 1
      g.scale.set(1, 1, sv)
    }
    return lvl
  }
  #level(zoom: number, frustum?: THREE.Frustum): SiteLevel {
    const z = this.zooms
    const reach = (threshold: number, level: number) => zoom >= threshold - (this.level >= level ? LOD_HYSTERESIS : 0)
    const lvl: SiteLevel = reach(z[0], 3) ? 3 : reach(z[1], 2) ? 2 : reach(z[2], 1) ? 1 : 0
    // a level not built yet is built when the site is in view
    const seen = !frustum || frustum.intersectsSphere(new THREE.Sphere(this.group.position, this.radius * 3))
    if (lvl > 0 && !this.levels[lvl as 1 | 2 | 3] && !seen) return this.level
    if (lvl !== this.level) {
      this.level = lvl
      for (const [k, g] of Object.entries(this.levels)) if (g) g.visible = Number(k) === lvl
      if (lvl > 0 && !this.levels[lvl as 1 | 2 | 3]) {
        const b = this.build(lvl as 1 | 2 | 3)
        this.levels[lvl as 1 | 2 | 3] = b.group
        this.group.add(b.group)
        this.hitbox = b.hitbox
      }
      const cur = this.levels[lvl as 1 | 2 | 3]
      if (cur) {
        cur.visible = true
        this.hitbox = cur.children.find(o => o.userData.pick) as THREE.Mesh
      }
    }
    return lvl
  }
}

function plantPresence(): Presence {
  return { tallest: Math.max(...PLANT.structures.map(s => s.height)), minHeightPx: 16 }
}

export class TwinLayer implements CustomLayerInterface {
  readonly id = 'twin-3d'
  readonly type = 'custom' as const
  readonly renderingMode = '3d' as const
  map!: MlMap
  renderer!: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.Camera()
  readonly network = new NetworkLod()
  readonly plant = new SiteLod(l => buildPlant(l), PLANT.origin, PLANT.rotation, 160, [17.2, 15.9, -Infinity], plantPresence())
  // TB1 is drawn larger than life, like the pipes are thickened (RW-01 starts inside its scaled pump house)
  readonly intake = new SiteLod(l => buildIntake(l, INTAKE_REACH / INTAKE_MAP_SCALE), INTAKE.origin, INTAKE_HEADING, 25 * INTAKE_MAP_SCALE, [19, 17.1, -Infinity], {
    tallest: 12,
    minHeightPx: 10,
    scale: INTAKE_MAP_SCALE,
  })
  readonly camPos = new THREE.Vector3()
  animate = true
  /** raw-water flow at TB1 relative to its design flow: drives the intake's water animation */
  intakeFlow = 1
  show = { plant: true, intake: true }
  onStats: (s: RenderStats) => void = () => {}
  #t0 = performance.now()
  #last = performance.now()
  #fps = 60
  #statsAt = 0
  #highlight: LineSegments2 | null = null
  #highlightMat = new LineMaterial({ color: 0xffd400, linewidth: 7, worldUnits: false, depthTest: false, transparent: true, opacity: 0.95 })
  #valveRing: THREE.Mesh | null = null
  #ringId: string | null = null

  onAdd(map: MlMap, gl: WebGL2RenderingContext | WebGLRenderingContext) {
    this.map = map
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true })
    this.renderer.autoClear = false
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    const hemi = new THREE.HemisphereLight(0xf4f7ff, 0x6b6656, 1.35)
    hemi.position.set(0, 0, 1)
    const sun = new THREE.DirectionalLight(0xffffff, 1.9)
    sun.position.set(-0.45, -0.8, 1.4)
    this.scene.add(hemi, sun, new THREE.AmbientLight(0xffffff, 0.25))
    this.scene.add(this.network.group, this.plant.group, this.intake.group)
  }

  onRemove() {
    this.renderer?.dispose()
  }

  render(_gl: WebGL2RenderingContext | WebGLRenderingContext, args: CustomRenderMethodInput) {
    const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix as unknown as number[])
    const l = new THREE.Matrix4().makeTranslation(ORIGIN_MERC.x, ORIGIN_MERC.y, 0).scale(new THREE.Vector3(MERC_PER_M, -MERC_PER_M, MERC_PER_M))
    this.camera.projectionMatrix = m.multiply(l)
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert()
    this.#cameraPosition()

    const now = performance.now()
    const dt = now - this.#last
    this.#last = now
    if (dt > 0 && dt < 1000) this.#fps = this.#fps * 0.92 + (1000 / dt) * 0.08
    const canvas = this.map.getCanvas()
    this.network.setResolution(canvas.width, canvas.height)
    this.#highlightMat.resolution.set(canvas.width, canvas.height)
    const zoom = this.map.getZoom()
    const frustum = new THREE.Frustum().setFromProjectionMatrix(this.camera.projectionMatrix)
    // the map's real device ratio (not a capped devicePixelRatio): line widths in CSS px must match the canvas
    const pixelRatio = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1
    const ns = this.network.update((now - this.#t0) / 1000, zoom, frustum, pixelRatio, this.camPos)
    INTAKE_ANIM.uTime.value = (now - this.#t0) / 1000
    INTAKE_ANIM.uFlow.value = this.intakeFlow
    // the ring follows its fitting when the level changes (L2 draws it at its seat)
    if (this.#valveRing && this.#ringId) {
      const at = this.#deviceAt(this.#ringId)
      if (at) this.#valveRing.position.set(at[0], at[1], 0.5)
    }
    const pl = this.show.plant ? this.plant.update(zoom, frustum) : 0
    const il = this.show.intake ? this.intake.update(zoom, frustum) : 0
    this.plant.group.visible = this.show.plant
    this.intake.group.visible = this.show.intake

    this.renderer.resetState()
    // three never learns of canvas resizes (MapLibre owns the canvas); LineSegments2.onBeforeRender reads the line
    // resolution from this viewport, so a stale one would scale every screen-space line width
    this.renderer.setViewport(0, 0, canvas.width, canvas.height)
    this.renderer.render(this.scene, this.camera)
    if (now - this.#statsAt > 500) {
      this.#statsAt = now
      const info = this.renderer.info.render
      this.onStats({
        fps: Math.round(this.#fps),
        calls: info.calls,
        triangles: info.triangles,
        chunks: ns.chunks,
        devices: ns.devices,
        plant: pl,
        intake: il,
        camDist: this.camPos.z,
        zoom,
      })
    }
    // keep drawing while animating, and until every chunk in view has been built (they build a few per frame)
    if (this.animate || ns.pending > 0) this.map.triggerRepaint()
  }

  /** camera position in the local frame: the point the projection maps to x = y = w = 0 */
  #cameraPosition() {
    const e = this.camera.projectionMatrix.elements
    const A = new THREE.Matrix3().set(e[0]!, e[4]!, e[8]!, e[1]!, e[5]!, e[9]!, e[3]!, e[7]!, e[11]!)
    const b = new THREE.Vector3(-e[12]!, -e[13]!, -e[15]!)
    const det = A.determinant()
    if (Math.abs(det) < 1e-30) return
    this.camPos.copy(b.applyMatrix3(A.invert()))
  }

  /** where a component is drawn: at its seat on the pipe axes up close (L2), at its node otherwise */
  #deviceAt(id: string): XY | null {
    const d = DEVICE_BY_ID[id]
    if (!d) return null
    return this.network.level === 2 ? (this.network.seat.get(id) ?? d.at) : d.at
  }

  // ───────────── picking ─────────────
  /** screen position (CSS px) of a local point, null when behind the camera */
  project(x: number, y: number, z: number): [number, number] | null {
    const v = new THREE.Vector4(x, y, z, 1).applyMatrix4(this.camera.projectionMatrix)
    if (v.w <= 0) return null
    const c = this.map.getCanvas()
    const w = c.clientWidth
    const h = c.clientHeight
    return [((v.x / v.w + 1) / 2) * w, ((1 - v.y / v.w) / 2) * h]
  }

  pick(px: number, py: number, filter: { mains: boolean; dist: boolean; service: boolean }): PickInfo | null {
    // sites first (ray against their hit boxes)
    const c = this.map.getCanvas()
    const nx = (px / c.clientWidth) * 2 - 1
    const ny = -(py / c.clientHeight) * 2 + 1
    const inv = this.camera.projectionMatrixInverse
    const p0 = new THREE.Vector4(nx, ny, -1, 1).applyMatrix4(inv)
    const p1 = new THREE.Vector4(nx, ny, 1, 1).applyMatrix4(inv)
    const a = new THREE.Vector3(p0.x / p0.w, p0.y / p0.w, p0.z / p0.w)
    const b = new THREE.Vector3(p1.x / p1.w, p1.y / p1.w, p1.z / p1.w)
    const ray = new THREE.Raycaster(a, b.sub(a).normalize())
    this.scene.updateMatrixWorld()
    for (const [site, type] of [
      [this.plant, 'plant'],
      [this.intake, 'intake'],
    ] as const) {
      if (site.level > 0 && site.hitbox && ray.intersectObject(site.hitbox, false).length) return { type }
    }
    // catalog components (valves, meters, sensors, hydrants …) near enough to be drawn, then pipes, in screen space
    let best: PickInfo | null = null
    let bd = 12
    const valveCodes = new Set(NET.valves.map(v => v.code))
    for (const d of NET_DEVICES) {
      const service = isServiceDevice(d)
      if (service ? !filter.service : !filter.dist) continue
      // service fittings and saddles are drawn only close up (L2): pick them only there
      const at = this.network.level === 2 ? (this.network.seat.get(d.id) ?? d.at) : d.at
      if (Math.hypot(at[0] - this.camPos.x, at[1] - this.camPos.y) > (service ? 320 : 1600)) continue
      const s = this.project(at[0], at[1], 0.8)
      if (!s) continue
      const dd = Math.hypot(s[0] - px, s[1] - py)
      if (dd < bd) [bd, best] = [dd, valveCodes.has(d.id) ? { type: 'valve', code: d.id } : { type: 'device', id: d.id }]
    }
    if (best) return best
    bd = 8
    for (const p of NET.pipes) {
      if (p.kind === 'service' ? !filter.service : p.kind === 'dist' ? !filter.dist : !filter.mains) continue
      const lim = p.kind === 'service' ? 5 : 8
      let prev: [number, number] | null = null
      for (const q of p.path) {
        const s = this.project(q[0], q[1], 0.6)
        if (s && prev) {
          const d = segDist([px, py], prev, s)
          if (d < Math.min(bd, lim)) [bd, best] = [d, { type: 'pipe', id: p.id }]
        }
        prev = s
      }
    }
    // the sites are also picked when no hit box is drawn (far away): near their marker
    return best
  }

  highlightPipe(id: string | null) {
    if (this.#highlight) {
      this.scene.remove(this.#highlight)
      this.#highlight.geometry.dispose()
      this.#highlight = null
    }
    const p: NetPipe | undefined = id ? PIPE_BY_ID[id] : undefined
    if (!p) return
    const seg: number[] = []
    for (let i = 1; i < p.path.length; i++) seg.push(p.path[i - 1]![0], p.path[i - 1]![1], 3, p.path[i]![0], p.path[i]![1], 3)
    const g = new LineSegmentsGeometry().setPositions(seg)
    this.#highlight = new LineSegments2(g, this.#highlightMat)
    this.#highlight.renderOrder = 10
    this.scene.add(this.#highlight)
    this.map?.triggerRepaint()
  }

  highlightValve(code: string | null) {
    if (this.#valveRing) {
      this.scene.remove(this.#valveRing)
      this.#valveRing.geometry.dispose()
      ;(this.#valveRing.material as THREE.Material).dispose()
      this.#valveRing = null
    }
    this.#ringId = code
    const v = code ? this.#deviceAt(code) : null
    if (!v) return
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 4.2, 40), new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.9, depthTest: false }))
    ring.position.set(v[0], v[1], 0.5)
    ring.renderOrder = 11
    this.#valveRing = ring
    this.scene.add(ring)
    this.map?.triggerRepaint()
  }

  /** the LoD level a chunk around a point uses (for the inspector) */
  levelAt(p: XY): LodLevel | null {
    let best: LodLevel | null = null
    let bd = Infinity
    for (const c of this.network.chunks) {
      const d = Math.hypot(c.center.x - p[0], c.center.y - p[1])
      if (d < bd) [bd, best] = [d, c.level]
    }
    return best
  }
}
