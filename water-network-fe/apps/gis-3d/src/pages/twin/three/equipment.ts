/**
 * Procedural 3D models of the plant's equipment (z-up, metres, origin at the equipment's base centre).
 * Each model is a Group whose meshes all carry `userData.tag` (picking) and own their materials (highlight).
 * Moving parts are exposed in `userData.anim` so the factory view can spin impellers / paddles.
 */
import * as THREE from 'three'
import type { Equipment } from '../data/plant-model'

export const COLORS = {
  pump: 0x2f6db3,
  motor: 0x6f7f86,
  steel: 0x9aa3a8,
  concrete: 0xb9b6ad,
  yellow: 0xe0b021,
  pipeBlue: 0x3a86c8,
  white: 0xeef0ee,
  green: 0x2f9e5a,
  dark: 0x2a3236,
  orange: 0xe07a2a,
}

export const mat = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, ...o })

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m)
  o.position.set(x, y, z)
  o.castShadow = true
  o.receiveShadow = true
  return o
}
const box = (w: number, d: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0) => mesh(new THREE.BoxGeometry(w, d, h), m, x, y, z + h / 2)
/** vertical cylinder standing on z */
const vcyl = (r: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 20) => {
  const o = mesh(new THREE.CylinderGeometry(r, r, h, seg), m, x, y, z + h / 2)
  o.rotation.x = Math.PI / 2
  return o
}
/** horizontal cylinder along x, centre at (x,y,z) */
const hcylX = (r: number, l: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 20) => {
  const o = mesh(new THREE.CylinderGeometry(r, r, l, seg), m, x, y, z)
  o.rotation.z = Math.PI / 2
  return o
}
const hcylY = (r: number, l: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 20) => mesh(new THREE.CylinderGeometry(r, r, l, seg), m, x, y, z)

/** status ring drawn on the floor under running equipment */
export function statusRing(radius: number) {
  const m = new THREE.MeshBasicMaterial({ color: 0x8a948f, transparent: true, opacity: 0.85, depthWrite: false })
  const r = new THREE.Mesh(new THREE.RingGeometry(radius * 0.86, radius, 40), m)
  r.position.z = 0.04
  r.renderOrder = 2
  r.userData.ring = true
  return r
}

function pump(scale: number, vertical = false) {
  const g = new THREE.Group()
  const anim: THREE.Object3D[] = []
  const s = scale
  g.add(box(2.6 * s, 1.3 * s, 0.35, mat(COLORS.concrete, { metalness: 0 })))
  if (!vertical) {
    // volute + motor (horizontal end-suction / split case)
    const vol = hcylY(0.55 * s, 0.5 * s, mat(COLORS.pump), -0.55 * s, 0, 0.35 + 0.6 * s, 28)
    g.add(vol)
    g.add(hcylX(0.28 * s, 0.9 * s, mat(COLORS.pump), -0.55 * s, 0, 0.35 + 0.6 * s))
    const motor = hcylX(0.42 * s, 1.35 * s, mat(COLORS.motor), 0.6 * s, 0, 0.35 + 0.6 * s, 24)
    g.add(motor)
    for (let i = 0; i < 6; i++) g.add(hcylX(0.45 * s, 0.04, mat(COLORS.motor), 0.15 * s + i * 0.18 * s, 0, 0.35 + 0.6 * s, 24))
    const fan = hcylX(0.36 * s, 0.12, mat(COLORS.dark), 1.32 * s, 0, 0.35 + 0.6 * s, 6)
    anim.push(fan)
    g.add(fan)
    // suction (−y) and discharge (+z) nozzles
    g.add(hcylY(0.22 * s, 0.9 * s, mat(COLORS.pump), -0.55 * s, -0.6 * s, 0.35 + 0.6 * s))
    g.add(vcyl(0.2 * s, 0.9 * s, mat(COLORS.pump), -0.55 * s, 0, 0.35 + 1.1 * s))
  } else {
    g.add(vcyl(0.5 * s, 0.8 * s, mat(COLORS.pump), 0, 0, 0.35))
    const motor = vcyl(0.42 * s, 1.4 * s, mat(COLORS.motor), 0, 0, 0.35 + 0.8 * s)
    g.add(motor)
    const fan = vcyl(0.3 * s, 0.1, mat(COLORS.dark), 0, 0, 0.35 + 2.25 * s, 6)
    anim.push(fan)
    g.add(fan)
  }
  g.userData.anim = { spin: anim, axis: vertical ? 'z' : 'x' }
  return g
}

function subpump() {
  const g = new THREE.Group()
  g.add(vcyl(0.05, 3.6, mat(COLORS.steel), -0.35, 0, -3.4))
  g.add(vcyl(0.05, 3.6, mat(COLORS.steel), 0.35, 0, -3.4))
  g.add(vcyl(0.32, 0.9, mat(COLORS.pump), 0, 0, -3.3))
  g.add(box(1.2, 0.8, 0.12, mat(COLORS.steel), 0, 0, 0))
  g.userData.anim = { spin: [], axis: 'z' }
  return g
}

function blower() {
  const g = new THREE.Group()
  g.add(box(2.4, 1.6, 0.25, mat(COLORS.concrete, { metalness: 0 })))
  g.add(box(2.2, 1.4, 1.8, mat(0x4f7d6a), 0, 0, 0.25))
  g.add(vcyl(0.28, 0.9, mat(COLORS.steel), 0.7, 0, 2.05))
  g.add(hcylY(0.22, 1.2, mat(COLORS.steel), -0.6, 0.9, 1.4))
  for (let i = 0; i < 5; i++) g.add(box(0.06, 1.42, 1.2, mat(0x3c5f50), -0.9 + i * 0.25, 0, 0.5))
  g.userData.anim = { spin: [], axis: 'z' }
  return g
}

function valve(dn: number, electric = true) {
  const g = new THREE.Group()
  const r = Math.max(0.25, dn / 2000 + 0.12)
  g.add(hcylX(r * 1.05, 0.28, mat(COLORS.pump), 0, 0, 0))
  g.add(hcylX(r * 1.25, 0.06, mat(COLORS.steel), -0.17, 0, 0))
  g.add(hcylX(r * 1.25, 0.06, mat(COLORS.steel), 0.17, 0, 0))
  g.add(vcyl(0.06, r + 0.25, mat(COLORS.steel), 0, 0, r * 0.6))
  if (electric) {
    g.add(box(0.45, 0.38, 0.5, mat(COLORS.yellow), 0, 0, r + 0.25))
    g.add(box(0.2, 0.42, 0.22, mat(COLORS.dark), 0.25, 0, r + 0.4))
  } else {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.03, 8, 24), mat(COLORS.orange))
    w.position.z = r + 0.35
    g.add(w)
  }
  g.userData.anim = { spin: [], axis: 'z' }
  return g
}

function mixer(span: number) {
  const g = new THREE.Group()
  g.add(box(span, 0.5, 0.3, mat(COLORS.steel), 0, 0, 0))
  g.add(vcyl(0.3, 0.8, mat(COLORS.motor), 0, 0, 0.3))
  g.add(box(0.5, 0.5, 0.35, mat(COLORS.pump), 0, 0, 1.1))
  const shaft = new THREE.Group()
  shaft.add(vcyl(0.06, 4.0, mat(COLORS.steel), 0, 0, -4.0))
  for (let i = 0; i < 3; i++) {
    const b = box(1.2, 0.12, 0.05, mat(COLORS.steel), 0, 0, -3.8)
    b.rotation.z = (i * Math.PI) / 3 + 0.3
    shaft.add(b)
  }
  g.add(shaft)
  g.userData.anim = { spin: [shaft], axis: 'z' }
  return g
}

/** a row of 4 paddle flocculators on one bridge (cells spaced `pitch` m along x) */
function flocculator(pitch: number, depth: number) {
  const g = new THREE.Group()
  const shafts: THREE.Object3D[] = []
  g.add(box(pitch * 4, 0.6, 0.25, mat(COLORS.steel), 0, 0, 0))
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * pitch
    g.add(vcyl(0.22, 0.55, mat(COLORS.motor), x, 0, 0.25))
    g.add(box(0.36, 0.36, 0.28, mat(COLORS.pump), x, 0, 0.8))
    const s = new THREE.Group()
    s.position.set(x, 0, 0)
    s.add(vcyl(0.05, depth, mat(COLORS.steel), 0, 0, -depth))
    for (const zz of [-depth * 0.3, -depth * 0.6, -depth * 0.88]) {
      const arm = box(2.6, 0.08, 0.08, mat(COLORS.steel), 0, 0, zz)
      s.add(arm)
      for (const sx of [-1.15, 1.15]) s.add(box(0.12, 0.08, depth * 0.22, mat(0x6d8fa3), sx, 0, zz - depth * 0.11))
    }
    g.add(s)
    shafts.push(s)
  }
  g.userData.anim = { spin: shafts, axis: 'z' }
  return g
}

function dosing() {
  const g = new THREE.Group()
  g.add(box(1.0, 0.7, 0.15, mat(COLORS.steel)))
  g.add(hcylX(0.16, 0.5, mat(COLORS.motor), 0.15, 0, 0.42))
  g.add(vcyl(0.2, 0.18, mat(0x3b6fa8), -0.25, 0, 0.3))
  g.add(box(0.3, 0.2, 0.3, mat(COLORS.dark), -0.3, 0.25, 0.15))
  g.userData.anim = { spin: [], axis: 'z' }
  return g
}

function tank(r: number, h: number, color = COLORS.white) {
  const g = new THREE.Group()
  g.add(vcyl(r, h, mat(color, { metalness: 0, roughness: 0.7 }), 0, 0, 0, 28))
  g.add(vcyl(0.18, 0.5, mat(COLORS.motor), 0, 0, h))
  g.add(box(r * 2.2, 0.15, 0.1, mat(COLORS.steel), 0, 0, h))
  g.userData.anim = { spin: [], axis: 'z' }
  return g
}

function cylinders() {
  const g = new THREE.Group()
  for (let i = 0; i < 10; i++) {
    const row = i < 5 ? 0 : 1
    const c = hcylX(0.39, 2.0, mat(COLORS.yellow, { metalness: 0.4 }), 0, (i % 5) * 1.0 - 2, 0.5 + row * 0.9, 20)
    c.rotation.z = 0
    c.rotation.x = 0
    c.rotation.y = 0
    c.rotation.z = Math.PI / 2
    const o = new THREE.Group()
    o.add(c)
    o.position.x = row * 2.6 - 1.3
    o.position.z = 0
    g.add(o)
  }
  g.add(box(6, 0.15, 0.15, mat(COLORS.steel), 0, -2.6, 3.6))
  g.add(box(0.2, 0.2, 3.6, mat(COLORS.steel), -2.8, -2.6, 0))
  g.add(box(0.2, 0.2, 3.6, mat(COLORS.steel), 2.8, -2.6, 0))
  g.userData.anim = { spin: [], axis: 'z' }
  return g
}

function chlorinator() {
  const g = new THREE.Group()
  g.add(box(0.8, 0.3, 1.1, mat(COLORS.white)))
  g.add(box(0.5, 0.05, 0.35, mat(0x1f6fbf, { emissive: 0x0a2a55 }), 0, -0.17, 0.6))
  g.add(vcyl(0.04, 0.7, mat(COLORS.steel), 0.25, -0.1, 1.1))
  g.userData.anim = { spin: [], axis: 'z' }
  return g
}

function scrubber() {
  const g = new THREE.Group()
  g.add(vcyl(0.9, 6.5, mat(0x9cb6c2, { metalness: 0.1 })))
  g.add(vcyl(0.5, 0.8, mat(COLORS.dark), 0, 0, 6.5))
  g.add(box(1.2, 1.0, 1.0, mat(0x6f7f86), 1.5, 0, 0))
  g.userData.anim = { spin: [], axis: 'z' }
  return g
}

function transformer() {
  const g = new THREE.Group()
  g.add(box(3.4, 2.6, 0.4, mat(COLORS.concrete, { metalness: 0 })))
  g.add(box(2.4, 1.6, 2.1, mat(0x5d7066), 0, 0, 0.4))
  for (let i = 0; i < 8; i++) g.add(box(0.06, 2.0, 1.6, mat(0x50625a), -1.0 + i * 0.28, 0, 0.6))
  for (let i = 0; i < 3; i++) g.add(vcyl(0.09, 0.8, mat(0xc9b38a, { metalness: 0 }), -0.6 + i * 0.6, 0.4, 2.5))
  g.userData.anim = { spin: [], axis: 'z' }
  return g
}

function instrument(kind: Equipment['kind']) {
  const g = new THREE.Group()
  switch (kind) {
    case 'level':
      g.add(box(0.12, 0.12, 1.4, mat(COLORS.steel)))
      g.add(box(0.9, 0.1, 0.1, mat(COLORS.steel), 0.4, 0, 1.4))
      g.add(mesh(new THREE.ConeGeometry(0.16, 0.3, 16), mat(COLORS.white), 0.85, 0, 1.3))
      break
    case 'analyzer':
      g.add(box(0.8, 0.4, 1.5, mat(COLORS.white)))
      g.add(box(0.5, 0.05, 0.3, mat(0x1f6fbf, { emissive: 0x0a2a55 }), 0, -0.22, 1.05))
      break
    case 'flowmeter':
      g.add(hcylX(0.62, 1.6, mat(0x3b6fa8)))
      g.children[0]!.position.z = 0.62
      g.add(box(0.36, 0.3, 0.42, mat(COLORS.white), 0, 0, 1.25))
      break
    case 'pressure': {
      g.add(vcyl(0.04, 0.4, mat(COLORS.steel)))
      const d = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 24), mat(COLORS.white), 0, 0, 0.55)
      g.add(d)
      break
    }
    case 'leak':
      g.add(box(0.3, 0.15, 0.35, mat(COLORS.yellow)))
      break
    case 'scada':
      for (let i = 0; i < 3; i++) {
        g.add(box(1.6, 0.8, 0.75, mat(0x8b8f88), (i - 1) * 1.9, 0, 0))
        g.add(box(1.2, 0.06, 0.6, mat(0x1d2a33, { emissive: 0x13354f }), (i - 1) * 1.9, 0.2, 0.95))
      }
      g.add(box(5.6, 0.06, 1.8, mat(0x10161a, { emissive: 0x0d3a5c }), 0, 2.6, 1.0))
      break
    default:
      g.add(box(0.4, 0.4, 0.4, mat(COLORS.steel)))
  }
  g.userData.anim = { spin: [], axis: 'z' }
  return g
}

/** The 3D model of one equipment item, tagged for picking. */
export function equipmentModel(e: Equipment, ctx: { flocPitch?: number }): THREE.Group {
  let g: THREE.Group
  let ring = 0
  switch (e.kind) {
    case 'pump':
      g = pump(e.unit === 'S07' ? 1.15 : e.unit === 'TB1' ? 1.3 : e.unit === 'S07B' ? 1.0 : 0.95, e.unit === 'S03' || e.unit === 'TB1')
      ring = e.unit === 'S07' ? 1.9 : 1.6
      break
    case 'subpump':
      g = subpump()
      ring = 0.9
      break
    case 'blower':
      g = blower()
      ring = 1.6
      break
    case 'valve':
      g = valve(e.tag === 'MV-701' ? 1000 : 600)
      ring = 0
      break
    case 'mixer':
      g = mixer(3.2)
      ring = 0
      break
    case 'flocculator':
      g = flocculator(ctx.flocPitch ?? 4.45, 4.4)
      break
    case 'dosing':
      g = dosing()
      ring = 0.8
      break
    case 'tank':
      g = tank(e.tag.includes('POL') ? 0.8 : 1.15, 2.3)
      break
    case 'chlorinator':
      g = chlorinator()
      break
    case 'cylinders':
      g = cylinders()
      break
    case 'scrubber':
      g = scrubber()
      break
    case 'transformer':
      g = transformer()
      break
    case 'lamella':
    case 'filter':
      // the basin itself is drawn by the plant builder; an invisible hit box makes it pickable
      g = new THREE.Group()
      g.userData.anim = { spin: [], axis: 'z' }
      break
    default:
      g = instrument(e.kind)
  }
  if (ring) {
    const r = statusRing(ring)
    g.add(r)
    g.userData.ring = r
  }
  g.position.set(e.pos[0], e.pos[1], e.z ?? 0)
  g.rotation.z = e.rot ?? 0
  g.userData.tag = e.tag
  g.traverse(o => {
    o.userData.tag = e.tag
  })
  return g
}

/** Glow every material of an equipment group (hover / selection). */
export function setHighlight(g: THREE.Object3D, level: 0 | 1 | 2) {
  g.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if (!m || !(m instanceof THREE.MeshStandardMaterial)) return
    if (m.userData.baseEmissive === undefined) m.userData.baseEmissive = m.emissive.getHex()
    m.emissive.setHex(level === 0 ? m.userData.baseEmissive : level === 1 ? 0x1d4f8f : 0x2a72d0)
    m.emissiveIntensity = level === 2 ? 0.75 : 0.55
  })
}
