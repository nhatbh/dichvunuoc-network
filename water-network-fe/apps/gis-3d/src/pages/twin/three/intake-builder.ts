/**
 * River intake + raw-water pump station TB1 ("00- Tram bom 1", block CTT of the survey Xref), z-up metres.
 * Local frame: +x points from the station to the river (towards the drawn water edge).
 * Levels: 1 massing · 2 structure, pump house, intake channel · 3 + windows, crane rail, pipes, transformer.
 */
import * as THREE from 'three'
import { equipmentModel } from './equipment'
import { Batch, solidMaterial, waterMaterial } from './plant-builder'
import { dist, type XY } from '../data/geo'
import { EQUIPMENT, INTAKE } from '../data/plant-model'

/** heading (rad) of the local +x axis in the map frame: towards the nearest drawn water edge point */
export const INTAKE_HEADING = (() => {
  let best: XY | null = null
  let bd = Infinity
  for (const l of INTAKE.waterEdge)
    for (const p of l) {
      const d = dist(p, INTAKE.origin)
      if (d < bd) [bd, best] = [d, p]
    }
  return best ? Math.atan2(best[1] - INTAKE.origin[1], best[0] - INTAKE.origin[0]) : Math.PI
})()
export const INTAKE_REACH = (() => {
  let bd = 30
  for (const l of INTAKE.waterEdge) for (const p of l) bd = Math.min(bd, dist(p, INTAKE.origin))
  return Math.max(14, bd + 6)
})()

export function buildIntake(level: 1 | 2 | 3 | 'factory') {
  const group = new THREE.Group()
  const b = new Batch()
  const roof = new Batch()
  const factory = level === 'factory'
  if (level === 1) {
    b.box(14, 10, 8, 0, 0, 0, 0xd2cbbb)
  } else {
    // intake well (top +15.10 over ground +10.0) and pump house on it
    b.box(14, 11, 5.1, 0, 0, 0, 0xb9b6ad)
    if (factory) {
      for (const [w, d, x, y] of [
        [14, 0.3, 0, -5.5],
        [14, 0.3, 0, 5.5],
        [0.3, 11, -7, 0],
        [0.3, 11, 7, 0],
      ] as const)
        b.box(w, d, 5.2, x, y, 5.1, 0xe2dccd)
      roof.box(14.4, 11.4, 0.35, 0, 0, 10.3, 0x9aa7ad)
    } else {
      b.box(14, 11, 5.2, 0, 0, 5.1, 0xe2dccd)
      b.box(14.4, 11.4, 0.35, 0, 0, 10.3, 0x9aa7ad)
    }
    // intake channel (mương dẫn) towards the river with trash racks
    const L = INTAKE_REACH
    b.box(L, 0.5, 4, 7 + L / 2, -3, -1, 0xa9a69c)
    b.box(L, 0.5, 4, 7 + L / 2, 3, -1, 0xa9a69c)
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(L, 5.4), waterMaterial(0x6f8a74, 0.9))
    wm.position.set(7 + L / 2, 0, 0.4)
    group.add(wm)
    // revetment (rọ đá / thảm đá)
    b.box(L + 10, 26, 0.3, 7 + L / 2, 0, -0.3, 0x8c8573)
    if (level !== 2) {
      for (let i = 0; i < 6; i++) b.box(0.08, 5.2, 3.2, 8 + i * 0.5, 0, 0.6, 0x6f777a)
      for (const s of [-1, 1]) b.box(13, 0.05, 1.0, 0, s * 5.52, 7.6, 0x3a4d5a)
      b.box(0.25, 10, 0.3, 0, 0, 9.6, 0x6f777a)
      b.box(2.6, 2, 2.2, -10, 6, 0, 0x5d7066)
      // D600 discharge leaving inland
      const pipe = new THREE.CylinderGeometry(0.32, 0.32, 14, 12)
      pipe.rotateZ(Math.PI / 2)
      pipe.translate(-14, -2, 0.9)
      b.add(pipe, 0x9aa3a8)
    }
  }
  const m = b.mesh(solidMaterial())
  if (m) group.add(m)
  const roofs: THREE.Object3D[] = []
  const rm = roof.mesh(solidMaterial())
  if (rm) {
    roofs.push(rm)
    group.add(rm)
  }
  const equipment = new Map<string, THREE.Group>()
  if (factory)
    for (const e of EQUIPMENT.filter(x => x.unit === 'TB1')) {
      const g = equipmentModel({ ...e, z: 5.1 }, {})
      group.add(g)
      equipment.set(e.tag, g)
    }
  const hitbox = new THREE.Mesh(new THREE.BoxGeometry(30, 24, 14), new THREE.MeshBasicMaterial({ visible: false }))
  hitbox.position.set(4, 0, 6)
  hitbox.userData.pick = 'intake'
  group.add(hitbox)
  return { group, roofs, equipment, hitbox }
}
