/**
 * River intake + raw-water pump station TB1 ("00- Tram bom 1", block CTT of the survey Xref), z-up metres.
 * Local frame: +x points from the station to the river (towards the drawn water edge).
 *
 * Every level shows what an intake is: the pump house on its intake well, the intake channel running out to the river
 * with its inlet head, and the water being drawn in.
 *  - L1 (from afar): pump house with its roof, the channel walls, the inlet head;
 *  - L2: + revetment, roof band, the D600 rising main leaving inland, trash rack frame;
 *  - L3 / factory: + trash rack bars, crane rail, windows, transformer.
 * The water is animated on every level (INTAKE_ANIM): ripples run down the channel towards the well, and rings close
 * in on the inlet head in the river, both at a pace that follows the raw-water flow. The map layer and the factory
 * view advance `uTime` and set `uFlow` (0 = pumps stopped, 1 = design flow).
 */
import * as THREE from 'three'
import { equipmentModel } from './equipment'
import { Batch, solidMaterial } from './plant-builder'
import { dist } from '../data/geo'
import { INTAKE_HEADING_MAP } from '../data/network-model'
import { EQUIPMENT, INTAKE } from '../data/plant-model'

/** heading (rad) of the local +x axis in the map frame: towards the nearest drawn water edge point */
export const INTAKE_HEADING = INTAKE_HEADING_MAP
export const INTAKE_REACH = (() => {
  let bd = 30
  for (const l of INTAKE.waterEdge) for (const p of l) bd = Math.min(bd, dist(p, INTAKE.origin))
  return Math.max(14, bd + 6)
})()

/** shared by every intake model: the time (s) and the flow (0..~1.5, 1 = design flow) the water animates with */
export const INTAKE_ANIM = { uTime: { value: 0 }, uFlow: { value: 1 } }

const RAW = new THREE.Color(0x6f8a74)
const CREST = new THREE.Color(0xc9d6c4)

/** channel water: ripples running from the river (+x) towards the well (−x) */
function channelWater(len: number, width: number) {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...INTAKE_ANIM, uBase: { value: RAW }, uCrest: { value: CREST }, uLen: { value: len } },
    transparent: true,
    depthWrite: false,
    vertexShader: `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
uniform float uTime; uniform float uFlow; uniform vec3 uBase; uniform vec3 uCrest; uniform float uLen;
varying vec2 vP;
void main() {
  float x = vP.x + uTime * 2.2 * uFlow;
  float wave = 0.5 + 0.5 * sin(x * 1.9 + sin(vP.y * 1.6 + x * 0.35) * 0.9);
  float crest = smoothstep(0.72, 0.98, wave) * (0.35 + 0.65 * uFlow);
  // churn where the water drops into the well
  float churn = smoothstep(-uLen * 0.5 + 3.0, -uLen * 0.5, vP.x) * (0.5 + 0.5 * sin(uTime * 7.0 + vP.y * 3.0)) * uFlow;
  gl_FragColor = vec4(mix(uBase, uCrest, clamp(crest + churn * 0.6, 0.0, 1.0)), 0.92);
}`,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, width), m)
  mesh.renderOrder = 2
  return mesh
}

/** rings closing in on the inlet head, on the river side only */
function suctionRings(radius: number) {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...INTAKE_ANIM, uR: { value: radius } },
    transparent: true,
    depthWrite: false,
    vertexShader: `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
uniform float uTime; uniform float uFlow; uniform float uR;
varying vec2 vP;
void main() {
  float r = length(vP);
  float phase = fract(r / (uR * 0.2) + uTime * 0.55 * max(uFlow, 0.15));
  float ring = smoothstep(0.0, 0.08, phase) * (1.0 - smoothstep(0.08, 0.3, phase));
  float fade = (1.0 - smoothstep(uR * 0.35, uR, r)) * smoothstep(-2.0, 2.0, vP.x);
  float a = ring * fade * 0.7 * clamp(uFlow * 1.5, 0.0, 1.0);
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.93, 0.97, 1.0, a);
}`,
  })
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), m)
  mesh.renderOrder = 3
  return mesh
}

/**
 * `reach` is the channel's length to the river; on the map, where the whole station is drawn INTAKE_MAP_SCALE times
 * its size, it is shortened by that factor so the inlet head still stands at the water's edge.
 */
export function buildIntake(level: 1 | 2 | 3 | 'factory', reach = INTAKE_REACH) {
  const group = new THREE.Group()
  const b = new Batch()
  const roof = new Batch()
  const factory = level === 'factory'
  const detail = level === 3 || factory
  const L = reach
  const mouth = 7 + L // the inlet head, at the river end of the channel

  // intake well (top +15.10 over ground +10.0) and the pump house on it
  b.box(14, 11, 5.1, 0, 0, 0, 0xb9b6ad)
  if (factory) {
    for (const [w, d, x, y] of [
      [14, 0.3, 0, -5.5],
      [14, 0.3, 0, 5.5],
      [0.3, 11, -7, 0],
      [0.3, 11, 7, 0],
    ] as const)
      b.box(w, d, 5.2, x, y, 5.1, 0xe2dccd)
    roof.box(14.8, 11.8, 0.4, 0, 0, 10.3, 0x5f7480)
  } else {
    b.box(14, 11, 5.2, 0, 0, 5.1, 0xe2dccd)
    b.box(14.8, 11.8, 0.4, 0, 0, 10.3, 0x5f7480) // roof with eaves, darker so the house reads from afar
    b.box(9, 6, 0.9, -1, 0, 10.7, 0x6d828d) // roof monitor over the crane bay
  }
  // intake channel (mương dẫn) to the river, and the inlet head standing in the water
  b.box(L, 0.6, 4.4, 7 + L / 2, -3, -1, 0xa9a69c)
  b.box(L, 0.6, 4.4, 7 + L / 2, 3, -1, 0xa9a69c)
  b.box(1.2, 7.2, 4.6, mouth, 0, -1, 0x9d9a90)
  const water = channelWater(L, 5.4)
  water.position.set(7 + L / 2, 0, 0.45)
  group.add(water)
  const rings = suctionRings(Math.max(12, L * 0.7))
  rings.position.set(mouth + 0.8, 0, 0.5)
  group.add(rings)

  if (level !== 1) {
    // revetment (rọ đá / thảm đá) along the bank
    b.box(L + 10, 26, 0.3, 7 + L / 2, 0, -0.3, 0x8c8573)
    b.box(14.2, 0.2, 0.5, 0, -5.6, 9.2, 0x8e9aa1) // band under the eaves
    b.box(14.2, 0.2, 0.5, 0, 5.6, 9.2, 0x8e9aa1)
    // trash rack frame at the inlet head
    b.box(0.3, 6.2, 0.3, mouth - 0.7, 0, 3.4, 0x55606a)
    // the D600 rising main leaving inland (on the map the network draws it: RW-01 starts inside the house)
    if (factory) {
      const pipe = new THREE.CylinderGeometry(0.32, 0.32, 14, 12)
      pipe.rotateZ(Math.PI / 2)
      pipe.translate(-14, -2, 0.9)
      b.add(pipe, 0x9aa3a8)
    }
  }
  if (detail) {
    for (let i = 0; i < 9; i++) b.box(0.08, 0.08, 3.4, mouth - 0.7, -2.6 + i * 0.65, 0.2, 0x6f777a)
    for (const s of [-1, 1]) b.box(13, 0.05, 1.0, 0, s * 5.52, 7.6, 0x3a4d5a) // window bands
    b.box(0.25, 10, 0.3, 0, 0, 9.6, 0x6f777a) // crane rail
    b.box(2.6, 2, 2.2, -10, 6, 0, 0x5d7066) // transformer
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
