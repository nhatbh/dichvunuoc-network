/**
 * Level of detail and culling for the plant's equipment in the factory view.
 *
 *   full    the catalog model, every part its own mesh and material (hover glow, spinning rotors, status LEDs)
 *   proxy   the same parts merged into one vertex-coloured mesh: one draw call per item
 *   off     not drawn: a few pixels or less on screen, or inside a building whose roof is on
 *
 * The level follows the item's size on screen, with a margin around each threshold so an item does not flicker
 * while the camera moves. The selected and hovered items always stay at full detail. The proxies also serve as
 * pick targets: one mesh per item instead of a dozen.
 */
import * as THREE from 'three'

export type Level = 'full' | 'proxy' | 'off'

/** radius (px) on screen of a sphere of radius `r` seen from `d` metres */
export function screenRadius(r: number, d: number, fovDeg: number, viewH: number) {
  return ((r / Math.max(0.001, d)) * (viewH / 2)) / Math.tan((fovDeg * Math.PI) / 360)
}

/** full detail from this radius on screen (px) */
export const FULL_PX = 26
/** drawn at all from this radius on screen (px) */
export const PROXY_PX = 2.2

/** next level for an item `px` pixels in radius, given its current level (15 % margin to stay where it is) */
export function levelFor(px: number, prev: Level): Level {
  const fullAt = prev === 'full' ? FULL_PX * 0.85 : FULL_PX
  const proxyAt = prev === 'off' ? PROXY_PX : PROXY_PX * 0.85
  return px >= fullAt ? 'full' : px >= proxyAt ? 'proxy' : 'off'
}

/** a closed building: what is inside its walls is hidden while its roof is on and the camera is outside */
export interface Cover {
  box: THREE.Box3
  roof: THREE.Object3D
}

interface Item {
  tag: string
  group: THREE.Object3D
  models: THREE.Object3D[]
  proxy: THREE.Mesh
  ring?: THREE.Object3D
  centre: THREE.Vector3
  radius: number
  cover: Cover | null
  level: Level
  covered: boolean
}

const proxyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 })
const WHITE = new THREE.Color(0xffffff)

function copy3(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  const out = new Float32Array(a.count * 3)
  for (let i = 0; i < a.count; i++) {
    out[i * 3] = a.getX(i)
    out[i * 3 + 1] = a.getY(i)
    out[i * 3 + 2] = a.getZ(i)
  }
  return new THREE.BufferAttribute(out, 3)
}

/** every visible mesh under `roots`, merged into one vertex-coloured geometry in `frame`'s local space */
export function mergedGeometry(roots: THREE.Object3D[], frame: THREE.Object3D): THREE.BufferGeometry | null {
  frame.updateMatrixWorld(true)
  const inv = frame.matrixWorld.clone().invert()
  const m = new THREE.Matrix4()
  const parts: THREE.BufferGeometry[] = []
  let count = 0
  for (const root of roots)
    root.traverse(o => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined
      if (!mat || mat.visible === false) return
      const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
      const pos = src.getAttribute('position')
      if (!pos) return
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', copy3(pos))
      const nrm = src.getAttribute('normal')
      if (nrm) g.setAttribute('normal', copy3(nrm))
      else g.computeVertexNormals()
      if (src !== mesh.geometry) src.dispose()
      g.applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld))
      const c = mat.color ?? WHITE
      const col = new Float32Array(pos.count * 3)
      for (let i = 0; i < pos.count; i++) {
        col[i * 3] = c.r
        col[i * 3 + 1] = c.g
        col[i * 3 + 2] = c.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3))
      parts.push(g)
      count += pos.count
    })
  if (!parts.length) return null
  const pos = new Float32Array(count * 3)
  const nrm = new Float32Array(count * 3)
  const col = new Float32Array(count * 3)
  let k = 0
  for (const p of parts) {
    pos.set(p.getAttribute('position').array as Float32Array, k)
    nrm.set(p.getAttribute('normal').array as Float32Array, k)
    col.set(p.getAttribute('color').array as Float32Array, k)
    k += p.getAttribute('position').count * 3
    p.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  out.setAttribute('color', new THREE.BufferAttribute(col, 3))
  out.computeBoundingSphere()
  return out
}

export class EquipmentLod {
  readonly #items = new Map<string, Item>()
  /** pick targets that have no levels (hit boxes of basins drawn by the plant builder) */
  readonly #fixedPick: THREE.Object3D[] = []
  readonly #tmp = new THREE.Vector3()

  constructor(equipment: Map<string, THREE.Group>, covers: Cover[]) {
    const box = new THREE.Box3()
    const sphere = new THREE.Sphere()
    for (const [tag, g] of equipment) {
      const models = (g.userData.models as THREE.Object3D[] | undefined) ?? []
      g.traverse(o => {
        if (o !== g && o.userData.tag === tag && (o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material as THREE.Material).visible === false) this.#fixedPick.push(o)
      })
      const geo = models.length ? mergedGeometry(models, g) : null
      if (!geo) continue
      const proxy = new THREE.Mesh(geo, proxyMaterial)
      proxy.name = 'lod-proxy'
      proxy.userData.tag = tag
      proxy.userData.part = 'proxy'
      proxy.castShadow = true
      proxy.receiveShadow = true
      proxy.visible = false
      g.add(proxy)
      box.makeEmpty()
      for (const m of models) box.expandByObject(m)
      box.getBoundingSphere(sphere)
      const cover = covers.find(c => sphere.center.x > c.box.min.x && sphere.center.x < c.box.max.x && sphere.center.y > c.box.min.y && sphere.center.y < c.box.max.y && sphere.center.z < c.box.min.z) ?? null
      this.#items.set(tag, { tag, group: g, models, proxy, ring: g.userData.ring as THREE.Object3D | undefined, centre: sphere.center.clone(), radius: Math.max(0.3, sphere.radius), cover, level: 'full', covered: false })
      // the item never moves: only its rotors need their matrices recomputed each frame
      const rotors = new Set((g.userData.anim as { spin?: THREE.Object3D[] } | undefined)?.spin ?? [])
      g.updateMatrixWorld(true)
      g.traverse(o => {
        if (!rotors.has(o)) o.matrixAutoUpdate = false
      })
    }
  }

  /** choose every item's level for this camera; true when any item changed level (shadows need a refresh) */
  update(camera: THREE.PerspectiveCamera, viewH: number, pinned: (tag: string) => boolean): boolean {
    const cam = camera.position
    let changed = false
    for (const it of this.#items.values()) {
      const c = it.cover
      it.covered = !!c && c.roof.visible && !(cam.x > c.box.min.x && cam.x < c.box.max.x && cam.y > c.box.min.y && cam.y < c.box.max.y && cam.z < c.box.min.z)
      let level: Level
      if (pinned(it.tag)) level = 'full'
      else if (it.covered) level = 'off'
      else level = levelFor(screenRadius(it.radius, this.#tmp.copy(it.centre).distanceTo(cam), camera.fov, viewH), it.level)
      if (level === it.level) continue
      it.level = level
      changed = true
      for (const m of it.models) m.visible = level === 'full'
      it.proxy.visible = level === 'proxy'
      if (it.ring) it.ring.visible = level !== 'off'
    }
    return changed
  }

  level(tag: string): Level {
    return this.#items.get(tag)?.level ?? 'full'
  }
  /** inside a closed building whose roof is on (its label is hidden too) */
  covered(tag: string): boolean {
    return this.#items.get(tag)?.covered ?? false
  }
  /** what a click can hit right now: one proxy per drawn item, plus the basins' hit boxes */
  pickTargets(): THREE.Object3D[] {
    const out = [...this.#fixedPick]
    for (const it of this.#items.values()) if (it.level !== 'off') out.push(it.proxy)
    return out
  }
  stats() {
    const s = { full: 0, proxy: 0, off: 0 }
    for (const it of this.#items.values()) s[it.level]++
    return s
  }
}
