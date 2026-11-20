/**
 * The component catalog (@wn/component-models) in the twin's scenes.
 *
 * Catalog models are built Y-up with the pipe axis along +X (port A at −X). The twin is Z-up, so every model is
 * turned by +90° about X (Y→Z) and then by its heading about Z.
 *  - `instancedDevices`: one InstancedMesh per (code, size, material part) for the map — hundreds of valves,
 *    saddles, hydrants and sensors cost a few draw calls per 300 m chunk. Status parts (sensor rings, LEDs) and
 *    bodies take per-instance colours, so live state repaints without a rebuild.
 *  - `symbolInstances`: the catalog's flat symbols, lying on the ground (mid-distance LoD).
 *  - `catalogModel`: a single Z-up model with its own materials (factory view: hover/selection glow per item).
 */
import { createComponent, symbolTexture, toInstancedParts, type Status } from '@wn/component-models'
import * as THREE from 'three'

export const STATUS_COLOR: Record<Status, number> = { normal: 0x2fb36b, warning: 0xe5a00d, critical: 0xe0453a, offline: 0x7d838a }
const Y_TO_Z = new THREE.Matrix4().makeRotationX(Math.PI / 2)

type Parts = ReturnType<typeof toInstancedParts>
const partsCache = new Map<string, Parts>()
export function catalogParts(code: string, dn: number, dn2?: number, segments = 10): Parts {
  const key = `${code}|${dn}|${dn2 ?? ''}|${segments}`
  let p = partsCache.get(key)
  if (!p) {
    const g = createComponent(code, { dn, dn2, segments, handwheel: true })
    p = toInstancedParts(g)
    for (const part of p) part.geometry.applyMatrix4(Y_TO_Z)
    partsCache.set(key, p)
  }
  return p
}

export interface DeviceInstance {
  id: string
  code: string
  dn: number
  dn2?: number
  at: [number, number]
  z: number
  heading: number
  scale: number
}
export interface InstancedDevices {
  group: THREE.Group
  /** paint body tint and status colour per device id */
  paint: (tintOf: (id: string) => THREE.Color | null, statusOf: (id: string) => Status) => void
}

const statusMats = new Map<string, THREE.MeshStandardMaterial>()
const statusMat = () => {
  let m = statusMats.get('s')
  if (!m) statusMats.set('s', (m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0x202020 })))
  return m
}

export function instancedDevices(items: DeviceInstance[], castShadow = true): InstancedDevices {
  const group = new THREE.Group()
  const groups = new Map<string, DeviceInstance[]>()
  for (const d of items) {
    const k = `${d.code}|${d.dn}|${d.dn2 ?? ''}`
    ;(groups.get(k) ?? groups.set(k, []).get(k)!).push(d)
  }
  const meshes: Array<{ mesh: THREE.InstancedMesh; ids: string[]; status: boolean }> = []
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const zAxis = new THREE.Vector3(0, 0, 1)
  for (const list of groups.values()) {
    const first = list[0]!
    for (const part of catalogParts(first.code, first.dn, first.dn2)) {
      const mat = part.status ? statusMat() : (part.material as THREE.Material).clone()
      const mesh = new THREE.InstancedMesh(part.geometry, mat, list.length)
      list.forEach((d, i) => {
        q.setFromAxisAngle(zAxis, d.heading)
        m.compose(new THREE.Vector3(d.at[0], d.at[1], d.z), q, new THREE.Vector3(d.scale, d.scale, d.scale))
        mesh.setMatrixAt(i, m)
        mesh.setColorAt(i, new THREE.Color(part.status ? STATUS_COLOR.normal : 0xffffff))
      })
      mesh.castShadow = castShadow && !part.status
      mesh.computeBoundingSphere()
      mesh.userData.deviceIds = list.map(d => d.id)
      group.add(mesh)
      meshes.push({ mesh, ids: list.map(d => d.id), status: part.status })
    }
  }
  const white = new THREE.Color(0xffffff)
  const c = new THREE.Color()
  return {
    group,
    paint(tintOf, statusOf) {
      for (const { mesh, ids, status } of meshes) {
        ids.forEach((id, i) => mesh.setColorAt(i, status ? c.setHex(STATUS_COLOR[statusOf(id)]) : (tintOf(id) ?? white)))
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
    },
  }
}

/** Catalog flat symbols lying on the ground, one InstancedMesh per (code, status). */
export function symbolInstances(items: Array<{ id: string; code: string; at: [number, number]; heading: number; status: Status; size: number; align: boolean }>, z: number) {
  const group = new THREE.Group()
  const groups = new Map<string, typeof items>()
  for (const d of items) {
    const k = `${d.code}|${d.status}`
    ;(groups.get(k) ?? groups.set(k, []).get(k)!).push(d)
  }
  const plane = new THREE.PlaneGeometry(1, 1)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const zAxis = new THREE.Vector3(0, 0, 1)
  for (const list of groups.values()) {
    const f = list[0]!
    const mat = new THREE.MeshBasicMaterial({ map: symbolTexture(f.code, f.status === 'normal' ? undefined : f.status, 128), transparent: true, alphaTest: 0.05, depthWrite: false })
    const mesh = new THREE.InstancedMesh(plane, mat, list.length)
    list.forEach((d, i) => {
      q.setFromAxisAngle(zAxis, d.align ? d.heading : 0)
      m.compose(new THREE.Vector3(d.at[0], d.at[1], z), q, new THREE.Vector3(d.size, d.size, 1))
      mesh.setMatrixAt(i, m)
    })
    mesh.renderOrder = 3
    mesh.computeBoundingSphere()
    group.add(mesh)
  }
  return group
}

/**
 * One catalog model, Z-up, with its own materials (so highlighting one item does not light up every pump) and
 * one own status material (recoloured by `setModelStatus`). Spinning parts are in the child named 'rotor'.
 */
export function catalogModel(code: string, opts: { dn?: number; dn2?: number; segments?: number } = {}): THREE.Group {
  const inner = createComponent(code, { segments: 20, ...opts })
  const own = new Map<THREE.Material, THREE.Material>()
  const status = new THREE.MeshStandardMaterial({ color: STATUS_COLOR.normal, emissive: STATUS_COLOR.normal, emissiveIntensity: 0.5, roughness: 0.4 })
  const rotors: THREE.Object3D[] = []
  inner.traverse(o => {
    if (o.name === 'rotor') rotors.push(o)
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    if (mesh.userData.part === 'status') {
      mesh.material = status
      return
    }
    const src = mesh.material as THREE.Material
    let m = own.get(src)
    if (!m) own.set(src, (m = src.clone()))
    mesh.material = m
  })
  const wrap = new THREE.Group()
  inner.rotation.x = Math.PI / 2
  wrap.add(inner)
  wrap.userData.catalog = { code, statusMaterial: status, rotors }
  return wrap
}

export function setModelStatus(g: THREE.Object3D, s: Status) {
  const c = (g.userData.catalog as { statusMaterial?: THREE.MeshStandardMaterial } | undefined)?.statusMaterial
  if (!c) return
  c.color.setHex(STATUS_COLOR[s])
  c.emissive.setHex(STATUS_COLOR[s])
}
