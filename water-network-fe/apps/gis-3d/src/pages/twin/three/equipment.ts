/**
 * The plant's equipment in the factory view: every item is its component-catalog model (@wn/component-models,
 * `Equipment.code`), turned Z-up, placed and tagged for picking. Items made of several units (a row of 4
 * flocculators, a rack of 10 chlorine containers) are laid out here. Basins drawn by the plant builder
 * (lamella settlers, filter cells) only get an invisible hit box.
 * Each model owns its materials (hover / selection glow) and status material; spinning parts are the catalog's
 * 'rotor' groups.
 */
import * as THREE from 'three'
import { catalogModel } from './catalog-mesh'
import type { Equipment } from '../data/plant-model'

/** status ring drawn on the floor under running machines */
export function statusRing(radius: number) {
  const m = new THREE.MeshBasicMaterial({ color: 0x8a948f, transparent: true, opacity: 0.85, depthWrite: false })
  const r = new THREE.Mesh(new THREE.RingGeometry(radius * 0.86, radius, 40), m)
  r.position.z = 0.04
  r.renderOrder = 2
  r.userData.ring = true
  return r
}

const RING: Partial<Record<Equipment['kind'], number>> = { pump: 1.9, subpump: 0.9, blower: 1.7, dosing: 0.8 }

/** The 3D model of one equipment item (catalog model), tagged for picking. */
export function equipmentModel(e: Equipment, ctx: { flocPitch?: number }): THREE.Group {
  const g = new THREE.Group()
  if (e.kind !== 'lamella' && e.kind !== 'filter') {
    const n = e.count ?? 1
    for (let i = 0; i < n; i++) {
      const m = catalogModel(e.code, { dn: e.dn })
      if (e.kind === 'flocculator') m.position.x = (i - (n - 1) / 2) * (ctx.flocPitch ?? 4.45)
      if (e.kind === 'cylinders') {
        // two racks of five, containers lying along x
        m.position.set((Math.floor(i / 5) - 0.5) * 2.9, (i % 5) * 1.05 - 2.1, 0)
      }
      g.add(m)
    }
  }
  const rotors: THREE.Object3D[] = []
  const models: THREE.Object3D[] = []
  g.traverse(o => {
    const c = o.userData.catalog as { rotors: THREE.Object3D[] } | undefined
    if (c) {
      models.push(o)
      rotors.push(...c.rotors)
    }
  })
  g.userData.anim = { spin: rotors, axis: 'y' }
  g.userData.models = models
  const ring = RING[e.kind]
  if (ring) {
    const r = statusRing(e.kind === 'pump' && e.code === 'VerticalTurbinePump' ? 1.5 : ring)
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

/** Glow every material of an equipment group (hover / selection). Materials are per model, so only it lights up. */
export function setHighlight(g: THREE.Object3D, level: 0 | 1 | 2) {
  g.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if (!m || !(m instanceof THREE.MeshStandardMaterial) || o.userData.part === 'status') return
    if (m.userData.baseEmissive === undefined) {
      m.userData.baseEmissive = m.emissive.getHex()
      m.userData.baseIntensity = m.emissiveIntensity
    }
    m.emissive.setHex(level === 0 ? m.userData.baseEmissive : level === 1 ? 0x1d4f8f : 0x2a72d0)
    m.emissiveIntensity = level === 0 ? m.userData.baseIntensity : level === 2 ? 0.75 : 0.55
  })
}
