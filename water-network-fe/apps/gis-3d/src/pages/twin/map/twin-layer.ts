/**
 * MapLibre custom layer drawing the twin's three.js scene in the map's WebGL context (shared depth buffer).
 * The scene is authored in the local metric frame of geo.ts; each frame the map's projection is combined with
 * the frame's mercator transform, the camera position is recovered from that matrix, and the LoD managers
 * (network chunks, plant, intake) pick their level from the camera distance.
 */
import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { NetworkLod, type LodLevel } from './network-lod'
import { MERC_PER_M, ORIGIN_MERC, type XY } from '../data/geo'
import { DEVICE_BY_ID, NET_DEVICES } from '../data/network-devices'
import { NET, PIPE_BY_ID, segDist, type NetPipe } from '../data/network-model'
import { INTAKE, PLANT } from '../data/plant-model'
import { buildIntake, INTAKE_HEADING } from '../three/intake-builder'
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
}

/** A site (plant, intake) with one model per level, chosen by distance. Level 0 = not drawn (map marker only). */
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
    private dist: [number, number, number],
  ) {
    this.group.position.set(origin[0], origin[1], 0)
    this.group.rotation.z = rotation
  }
  update(cam: THREE.Vector3): SiteLevel {
    const d = Math.max(0, cam.distanceTo(this.group.position) - this.radius)
    const h = (l: number) => (this.level === l ? 1.15 : 1)
    const lvl: SiteLevel = d < this.dist[0] * h(3) ? 3 : d < this.dist[1] * h(2) ? 2 : d < this.dist[2] * h(1) ? 1 : 0
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

export class TwinLayer implements CustomLayerInterface {
  readonly id = 'twin-3d'
  readonly type = 'custom' as const
  readonly renderingMode = '3d' as const
  map!: MlMap
  renderer!: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.Camera()
  readonly network = new NetworkLod()
  readonly plant = new SiteLod(l => buildPlant(l), PLANT.origin, PLANT.rotation, 160, [520, 1600, 6000])
  readonly intake = new SiteLod(l => buildIntake(l), INTAKE.origin, INTAKE_HEADING, 25, [180, 700, 3500])
  readonly camPos = new THREE.Vector3()
  animate = true
  show = { plant: true, intake: true }
  onStats: (s: RenderStats) => void = () => {}
  #t0 = performance.now()
  #last = performance.now()
  #fps = 60
  #statsAt = 0
  #highlight: LineSegments2 | null = null
  #highlightMat = new LineMaterial({ color: 0xffd400, linewidth: 7, worldUnits: false, depthTest: false, transparent: true, opacity: 0.95 })
  #valveRing: THREE.Mesh | null = null

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
    const ns = this.network.update(this.camPos, (now - this.#t0) / 1000)
    const pl = this.show.plant ? this.plant.update(this.camPos) : 0
    const il = this.show.intake ? this.intake.update(this.camPos) : 0
    this.plant.group.visible = this.show.plant
    this.intake.group.visible = this.show.intake

    this.renderer.resetState()
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
      })
    }
    if (this.animate) this.map.triggerRepaint()
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
      if (d.code === 'TappingSaddle' || (d.code === 'CustomerMeter' && !filter.service) || (!filter.dist && d.code !== 'CustomerMeter')) continue
      if (Math.hypot(d.at[0] - this.camPos.x, d.at[1] - this.camPos.y) > 1600) continue
      const s = this.project(d.at[0], d.at[1], 0.8)
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
      this.#valveRing = null
    }
    const v = code ? DEVICE_BY_ID[code] : null
    if (!v) return
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 4.2, 40), new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.9, depthTest: false }))
    ring.position.set(v.at[0], v.at[1], 0.5)
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
