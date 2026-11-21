import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { EquipmentLod, FULL_PX, levelFor, mergedGeometry, PROXY_PX, screenRadius } from './equipment-lod'

const camera = (x: number, y: number, z: number) => {
  const c = new THREE.PerspectiveCamera(42, 1.6, 0.5, 6000)
  c.position.set(x, y, z)
  c.updateMatrixWorld()
  return c
}

/** an equipment group like `equipmentModel` makes: catalog wraps listed in userData.models */
function item(tag: string, at: [number, number, number]) {
  const g = new THREE.Group()
  const wrap = new THREE.Group()
  wrap.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: 0x3366cc })))
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 3), new THREE.MeshStandardMaterial({ color: 0x999999 }))
  pipe.position.x = 1.5
  wrap.add(pipe)
  g.add(wrap)
  g.position.set(...at)
  g.userData = { tag, models: [wrap] }
  return g
}

describe('levelFor', () => {
  it('picks full, proxy or off by size on screen', () => {
    expect(levelFor(FULL_PX + 1, 'proxy')).toBe('full')
    expect(levelFor(FULL_PX - 1, 'proxy')).toBe('proxy')
    expect(levelFor(PROXY_PX - 0.5, 'proxy')).toBe('off')
  })
  it('keeps the current level inside the margin, so items do not flicker', () => {
    expect(levelFor(FULL_PX * 0.9, 'full')).toBe('full')
    expect(levelFor(FULL_PX * 0.9, 'proxy')).toBe('proxy')
    expect(levelFor(PROXY_PX * 0.9, 'proxy')).toBe('proxy')
    expect(levelFor(PROXY_PX * 0.9, 'off')).toBe('off')
  })
  it('shrinks with distance', () => {
    expect(screenRadius(1, 10, 42, 950)).toBeCloseTo(2 * screenRadius(1, 20, 42, 950))
  })
})

describe('mergedGeometry', () => {
  it('merges every part into one coloured mesh in the item frame', () => {
    const g = item('P-1', [10, 20, 0])
    const geo = mergedGeometry(g.userData.models as THREE.Object3D[], g)!
    expect(geo.getAttribute('color').count).toBe(geo.getAttribute('position').count)
    geo.computeBoundingBox()
    // the box spans x −1..1 and the pipe 1.3..1.7, in the group's own frame (not the world)
    expect(geo.boundingBox!.min.x).toBeCloseTo(-1)
    expect(geo.boundingBox!.max.x).toBeCloseTo(1.7)
  })
})

describe('EquipmentLod', () => {
  const scene = new THREE.Scene()
  const near = item('NEAR', [0, 0, 0])
  const inside = item('INSIDE', [100, 0, 0])
  const roof = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 0.3), new THREE.MeshStandardMaterial())
  roof.position.set(100, 0, 8)
  scene.add(near, inside, roof)
  scene.updateMatrixWorld(true)
  const equipment = new Map([
    ['NEAR', near],
    ['INSIDE', inside],
  ])
  const lod = new EquipmentLod(equipment, [{ roof, box: new THREE.Box3().setFromObject(roof) }])
  const none = () => false

  it('draws the full model close up and the proxy from afar', () => {
    lod.update(camera(0, -10, 5), 950, none)
    expect(lod.level('NEAR')).toBe('full')
    lod.update(camera(0, -400, 200), 950, none)
    expect(lod.level('NEAR')).toBe('proxy')
    expect(near.children.find(o => o.name === 'lod-proxy')!.visible).toBe(true)
  })
  it('hides what is under a closed roof unless the roof is off or the camera is inside', () => {
    lod.update(camera(100, -15, 20), 950, none)
    expect(lod.level('INSIDE')).toBe('off')
    expect(lod.covered('INSIDE')).toBe(true)
    roof.visible = false
    lod.update(camera(100, -15, 20), 950, none)
    expect(lod.level('INSIDE')).toBe('full')
    roof.visible = true
    lod.update(camera(100, -5, 3), 950, none)
    expect(lod.covered('INSIDE')).toBe(false)
  })
  it('keeps a selected item at full detail and only offers drawn items for picking', () => {
    lod.update(camera(100, -15, 20), 950, t => t === 'INSIDE')
    expect(lod.level('INSIDE')).toBe('full')
    lod.update(camera(100, -15, 20), 950, none)
    expect(lod.pickTargets().map(o => o.userData.tag)).not.toContain('INSIDE')
  })
})
