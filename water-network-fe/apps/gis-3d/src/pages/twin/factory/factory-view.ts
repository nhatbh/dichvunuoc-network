/**
 * The plant's own 3D view (entered by clicking the plant on the map): the CAD-derived site at full detail with
 * every equipment item modelled, roofs removable, live state from the simulation (spinning motors, status rings,
 * water levels, filter backwash, flow particles in the process pipes, chlorine leak cloud) and picking.
 * TB1 (the river intake, 5 km away) is a second site in the same view. The ground is the map's own basemap.
 *
 * Frame cost is kept down by: equipment levels of detail and culling under closed roofs (`EquipmentLod`), a
 * shadow map redrawn only when something that casts changes, labels in their own small scene, flow particles
 * culled by frustum and distance, and hover picking at most every 60 ms against one proxy mesh per item.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { EquipmentLod, type Cover } from './equipment-lod'
import { MapGround } from './map-ground'
import { EQUIPMENT, EQUIPMENT_BY_TAG, INTAKE, PLANT, plantToMap, R, rectOf, STRUCTURE_BY_ID, type Rect } from '../data/plant-model'
import { equipmentStatus } from '../sim/plant-sim'
import { setModelStatus } from '../three/catalog-mesh'
import { setHighlight } from '../three/equipment'
import { buildIntake, INTAKE_ANIM, INTAKE_HEADING } from '../three/intake-builder'
import { buildPlant, FLUID_COLOR, PROCESS_PIPES, STAGE_WATER, type PlantModel, type ProcessPipe } from '../three/plant-builder'
import { SHORT } from '../ui/areas'
import type { PlantSim } from '../sim/plant-sim'
import type { Raster } from '../ui/basemap'

export type Site = 'plant' | 'tb1'
const RING = { run: 0x19b85a, stop: 0x8a948f, fault: 0xe0443c, man: 0xf0a20a }
/** where TB1 sits in this view: far enough that its patch of map does not overlap the plant's */
const TB1_OFFSET = new THREE.Vector3(0, -1300, 0)
/** flow particles are dots of a few cm: not worth drawing from further than this (m) */
const FLOW_DIST = 420

class FlowParticles {
  readonly mesh: THREE.InstancedMesh
  readonly pts: THREE.Vector3[]
  readonly cum: number[] = [0]
  readonly len: number
  offset = 0
  readonly n: number
  readonly tmp = new THREE.Object3D()
  constructor(
    public pipe: ProcessPipe,
    offset: THREE.Vector3,
  ) {
    this.pts = pipe.path.map(p => new THREE.Vector3(p[0], p[1], p[2]).add(offset))
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1]! + this.pts[i]!.distanceTo(this.pts[i - 1]!))
    this.len = this.cum[this.cum.length - 1]!
    this.n = Math.max(2, Math.floor(this.len / 1.6))
    const r = Math.max(0.09, pipe.dn / 2000 + 0.04)
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial({ color: FLUID_COLOR[pipe.fluid] }), this.n)
    // the particles stay on the pipe: its path bounds them, so the pipe can be frustum-culled like any mesh
    this.mesh.boundingSphere = new THREE.Sphere().setFromPoints(this.pts)
    this.mesh.boundingSphere.radius += r
  }
  /** distance from the camera to the nearest part of the pipe's bounds */
  distanceTo(p: THREE.Vector3) {
    const s = this.mesh.boundingSphere!
    return Math.max(0, s.center.distanceTo(p) - s.radius)
  }
  at(d: number, out: THREE.Vector3) {
    let i = 1
    while (i < this.cum.length - 1 && this.cum[i]! < d) i++
    const a = this.pts[i - 1]!
    const b = this.pts[i]!
    const seg = this.cum[i]! - this.cum[i - 1]!
    return out.copy(a).lerp(b, seg > 0 ? (d - this.cum[i - 1]!) / seg : 0)
  }
  update(dt: number, speed: number) {
    this.mesh.visible = speed > 0.01
    if (!this.mesh.visible) return
    this.offset = (this.offset + speed * dt) % 1.6
    for (let k = 0; k < this.n; k++) {
      const d = (k * 1.6 + this.offset) % this.len
      this.at(d, this.tmp.position)
      this.tmp.updateMatrix()
      this.mesh.setMatrixAt(k, this.tmp.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }
}

export class FactoryView {
  readonly renderer: THREE.WebGLRenderer
  readonly labelRenderer: CSS2DRenderer
  readonly scene = new THREE.Scene()
  /** the CSS labels live in their own scene: the label renderer walks ~130 objects a frame, not the whole plant */
  readonly labelScene = new THREE.Scene()
  readonly ground: MapGround
  readonly lod: EquipmentLod
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  readonly plant: PlantModel
  readonly tb1: ReturnType<typeof buildIntake>
  readonly equipment = new Map<string, THREE.Group>()
  readonly labels = new Map<string, { obj: CSS2DObject; el: HTMLElement }>()
  readonly unitLabels: CSS2DObject[] = []
  readonly flows: FlowParticles[] = []
  readonly bubbles: THREE.InstancedMesh
  readonly leakCloud: THREE.Mesh
  site: Site = 'plant'
  showLabels = true
  showFlow = true
  hovered: string | null = null
  selected: string | null = null
  onPick: (tag: string | null, unit: string | null) => void = () => {}
  onHover: (tag: string | null) => void = () => {}
  #raf = 0
  #last = performance.now()
  #tween: { t: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3 } | null = null
  #ro: ResizeObserver
  #ray = new THREE.Raycaster()
  #down: { x: number; y: number } | null = null
  #unitBoxes: THREE.Mesh[] = []
  #disposed = false
  #roofsOn = true
  #cutaway: string | null = null
  /** last measured label sizes (px), for decluttering hidden ones */
  #labelSize = new Map<HTMLElement, [number, number]>()
  /** the sun never moves: the shadow map is redrawn only when what casts shadows changes */
  #shadowDirty = true
  #shadowAt = 0
  /** latest pointer position not yet hover-picked, and when the last hover pick ran */
  #hoverEv: PointerEvent | null = null
  #hoverAt = 0
  /**
   * Adaptive resolution: when frames take too long (a weak GPU on a full-screen close-up), the drawing buffer
   * shrinks in steps of 10 % down to 70 %; it grows back once frames are fast again. A step back up that turns
   * out too slow pins the lower step for a minute, so the picture does not pump between two sizes.
   */
  #basePixelRatio = 1
  resolutionScale = 1
  #frameMs = 16.7
  #slowFor = 0
  #fastFor = 0
  #raisedAt = -1e9
  #changedAt = 0
  #ceiling = 1
  #ceilingUntil = 0

  constructor(
    private container: HTMLElement,
    private sim: PlantSim,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    // past 1.5 device pixels per CSS pixel, the GPU shades up to 1.8× the pixels for an edge hardly sharper
    this.#basePixelRatio = Math.min(window.devicePixelRatio, 1.5)
    this.renderer.setPixelRatio(this.#basePixelRatio)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    container.prepend(this.renderer.domElement)
    this.labelRenderer = new CSS2DRenderer()
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none', isolation: 'isolate' })
    container.appendChild(this.labelRenderer.domElement)

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 6000)
    this.camera.up.set(0, 0, 1)
    this.camera.position.set(-40, -330, 260)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.maxPolarAngle = Math.PI * 0.48
    this.controls.minDistance = 6
    this.controls.maxDistance = 900
    this.controls.target.set(-20, 0, 0)

    this.scene.fog = new THREE.Fog(0xdfe5e2, 700, 1900)
    this.#applyTheme()
    window.addEventListener('tw-theme', this.#applyTheme)
    // soft image-based light (a neutral studio room) so materials read as concrete, steel and water, not flat colour
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.3
    pmrem.dispose()
    const hemi = new THREE.HemisphereLight(0xf2f6ff, 0x5d604f, 1.15)
    hemi.position.set(0, 0, 1)
    const sun = new THREE.DirectionalLight(0xffffff, 2.1)
    sun.position.set(-160, -220, 320)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const sc = sun.shadow.camera as THREE.OrthographicCamera
    sc.left = -170
    sc.right = 170
    sc.top = 170
    sc.bottom = -170
    sc.near = 10
    sc.far = 900
    sun.shadow.bias = -0.0004
    this.scene.add(hemi, sun, sun.target)

    // ground: the map's basemap around each site (this view's frame is the plant's drawing frame; TB1 is moved
    // next to it and keeps its own heading), plain basemap colour beyond
    const site = rectOf(PLANT.boundary)
    this.ground = new MapGround(
      [
        { centre: plantToMap([site.cx, site.cy]), at: new THREE.Vector3(site.cx, site.cy, -0.05), rotation: -PLANT.rotation, radius: 820, zoom: 17 },
        // TB1 is mostly seen up close: half-metre pixels (≈ 30 tiles for this small patch)
        { centre: INTAKE.origin, at: TB1_OFFSET.clone().setZ(-0.05), rotation: -INTAKE_HEADING, radius: 380, zoom: 18 },
      ],
      this.renderer.capabilities.getMaxAnisotropy(),
      9000,
      new THREE.Vector3(0, -650, -0.08),
    )
    this.scene.add(this.ground.group)
    // building shadows falling outside the site pad
    const shadows = new THREE.Mesh(new THREE.PlaneGeometry(site.w + 160, site.h + 160), new THREE.ShadowMaterial({ opacity: 0.22, depthWrite: false }))
    shadows.position.set(site.cx, site.cy, 0)
    shadows.receiveShadow = true
    this.scene.add(shadows)

    this.plant = buildPlant('factory')
    this.scene.add(this.plant.group)
    for (const [k, g] of this.plant.equipment) this.equipment.set(k, g)
    this.tb1 = buildIntake('factory')
    this.tb1.group.position.copy(TB1_OFFSET)
    this.scene.add(this.tb1.group)
    for (const [k, g] of this.tb1.equipment) this.equipment.set(k, g)
    this.scene.updateMatrixWorld(true)
    // The static batches (site, buildings, basins, roofs) are matte concrete and paint. Close-ups are bound by
    // shading those big surfaces, and a Lambert material shades them at about 3/4 of the physically based one's
    // cost with no visible difference at roughness 0.8; the hemisphere light makes up for the environment light
    // Lambert does not take. Equipment, water and glass keep their own materials.
    const matte = new THREE.MeshLambertMaterial({ vertexColors: true })
    for (const root of [this.plant.group, this.tb1.group])
      root.traverse(o => {
        const m = o as THREE.Mesh
        const mat = m.material as THREE.MeshStandardMaterial | undefined
        if (!m.isMesh || o.userData.tag || !mat?.isMeshStandardMaterial || !mat.vertexColors || mat.transparent) return
        mat.dispose()
        m.material = matte
      })

    // structure hit boxes (unit picking) + unit labels
    for (const s of PLANT.structures) {
      const r = rectOf(s.poly)
      const hb = new THREE.Mesh(new THREE.BoxGeometry(r.w, r.h, Math.max(1, s.height)), new THREE.MeshBasicMaterial({ visible: false }))
      hb.position.set(r.cx, r.cy, Math.max(1, s.height) / 2)
      hb.userData.unit = s.id
      this.plant.group.add(hb)
      this.#unitBoxes.push(hb)
      if (s.kind === 'parking' || s.kind === 'guard') continue
      const el = document.createElement('div')
      el.className = 'tw-unit-label'
      el.innerHTML = '<i></i><span></span>'
      el.firstElementChild!.textContent = String(s.no)
      el.lastElementChild!.textContent = SHORT[s.id] ?? s.name
      el.dataset.area = String(r.w * r.h)
      const o = new CSS2DObject(el)
      o.position.copy(this.plant.group.localToWorld(new THREE.Vector3(r.cx, r.cy, s.height + (s.kind === 'pond' ? 2 : 3.5))))
      this.labelScene.add(o)
      this.unitLabels.push(o)
    }
    {
      const el = document.createElement('div')
      el.className = 'tw-unit-label'
      el.innerHTML = '<i>TB1</i><span>Trạm bơm nước thô</span>'
      el.dataset.area = '9999'
      const o = new CSS2DObject(el)
      o.position.copy(this.tb1.group.localToWorld(new THREE.Vector3(0, 0, 14)))
      this.labelScene.add(o)
      this.unitLabels.push(o)
    }

    // equipment labels, just above each item (the items never move)
    for (const e of EQUIPMENT) {
      const g = this.equipment.get(e.tag)
      if (!g) continue
      const el = document.createElement('div')
      el.className = 'tw-tag'
      el.innerHTML = `<b>${e.tag}</b><span></span>`
      const o = new CSS2DObject(el)
      const box = new THREE.Box3().setFromObject(g)
      o.position.copy(g.localToWorld(new THREE.Vector3(0, 0, Math.max(1.6, box.max.z - g.getWorldPosition(new THREE.Vector3()).z + 0.6))))
      this.labelScene.add(o)
      this.labels.set(e.tag, { obj: o, el })
    }

    // closed buildings (walls and a roof) hide their equipment while the roof is on
    const covers: Cover[] = []
    for (const r of this.plant.roofs) {
      const kind = STRUCTURE_BY_ID[r.userData.unit as string]?.kind
      if (kind && kind !== 'parking') covers.push({ roof: r, box: new THREE.Box3().setFromObject(r) })
    }
    for (const r of this.tb1.roofs) covers.push({ roof: r, box: new THREE.Box3().setFromObject(r) })
    this.lod = new EquipmentLod(this.equipment, covers)

    // process flow particles
    for (const pp of PROCESS_PIPES) {
      const f = new FlowParticles(pp, new THREE.Vector3())
      this.flows.push(f)
      this.plant.group.add(f.mesh)
    }
    // backwash bubbles
    this.bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }), 260)
    this.bubbles.frustumCulled = false
    this.bubbles.visible = false
    this.plant.group.add(this.bubbles)
    this.leakCloud = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xc6e86a, transparent: true, opacity: 0.0, depthWrite: false }))
    const s9 = R('S09')
    this.leakCloud.position.set(s9.cx, s9.cy, 2)
    this.plant.group.add(this.leakCloud)

    this.#applyRoofs()
    this.#ro = new ResizeObserver(() => this.#resize())
    this.#ro.observe(container)
    this.#resize()
    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this.#onDown)
    el.addEventListener('pointerup', this.#onUp)
    el.addEventListener('pointermove', this.#onMove)
    this.#raf = requestAnimationFrame(this.#frame)
  }

  #applyTheme = () => {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--scene-bg').trim() || '#dfe5e2'
    this.scene.background = new THREE.Color(bg)
    ;(this.scene.fog as THREE.Fog).color.set(bg)
  }

  /** draw the ground from this basemap's tiles */
  setBasemap(r: Raster) {
    void this.ground.show(r)
  }

  dispose() {
    this.#disposed = true
    window.removeEventListener('tw-theme', this.#applyTheme)
    cancelAnimationFrame(this.#raf)
    this.#ro.disconnect()
    this.controls.dispose()
    this.ground.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.labelRenderer.domElement.remove()
  }

  #resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.labelRenderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  setRoofs(on: boolean) {
    this.#roofsOn = on
    this.#applyRoofs()
  }
  /** open up one building (its roof hidden) so what is inside stays visible while the rest keep their roofs */
  setCutaway(unit: string | null) {
    this.#cutaway = unit
    this.#applyRoofs()
  }
  #applyRoofs() {
    for (const r of this.plant.roofs) r.visible = this.#roofsOn && r.userData.unit !== this.#cutaway
    for (const r of this.tb1.roofs) r.visible = this.#roofsOn && this.#cutaway !== 'TB1'
    // roofs cast shadows: redraw the shadow map now, not after the usual throttle
    this.#shadowDirty = true
    this.#shadowAt = 0
  }
  setLabels(on: boolean) {
    this.showLabels = on
    for (const { obj } of this.labels.values()) obj.visible = on
    for (const u of this.unitLabels) u.visible = on
  }

  // ───────────── camera ─────────────
  #flyTo(pos: THREE.Vector3, target: THREE.Vector3, dur = 1.1) {
    this.#tween = { t: 0, dur, p0: this.camera.position.clone(), p1: pos, t0: this.controls.target.clone(), t1: target }
  }
  /** intro: from high above (out of the map's cloud) down onto the plant or TB1, over `dur` s */
  intro(site: Site = 'plant', dur = 2.2) {
    this.site = site
    if (site === 'tb1') {
      const t = TB1_OFFSET.clone().add(new THREE.Vector3(2, 0, 5))
      this.camera.position.copy(TB1_OFFSET).add(new THREE.Vector3(-260, -300, 520))
      this.controls.target.copy(t)
      this.#flyTo(TB1_OFFSET.clone().add(new THREE.Vector3(-34, -38, 30)), t, dur)
      return
    }
    this.camera.position.set(140, -980, 1250)
    this.controls.target.set(-20, 0, 0)
    this.#flyTo(new THREE.Vector3(70, -250, 170), new THREE.Vector3(-30, 5, 0), dur)
  }
  overview() {
    if (this.site === 'tb1') return this.focusSite('tb1')
    this.#flyTo(new THREE.Vector3(70, -250, 170), new THREE.Vector3(-30, 5, 0))
  }
  focusSite(site: Site) {
    this.site = site
    if (site === 'tb1') this.#flyTo(TB1_OFFSET.clone().add(new THREE.Vector3(-34, -38, 30)), TB1_OFFSET.clone().add(new THREE.Vector3(2, 0, 5)))
    else this.overview()
  }
  focusRect(r: Rect, z = 0) {
    const size = Math.max(r.w, r.h)
    const t = this.plant.group.localToWorld(new THREE.Vector3(r.cx, r.cy, z))
    this.#flyTo(t.clone().add(new THREE.Vector3(size * 0.55 + 6, -size * 1.0 - 10, size * 0.75 + 10)), t)
  }
  focusUnit(id: string) {
    if (id === 'TB1') return this.focusSite('tb1')
    this.site = 'plant'
    const s = STRUCTURE_BY_ID[id]
    if (s) this.focusRect(rectOf(s.poly), s.height * 0.5)
  }
  focusTag(tag: string) {
    const g = this.equipment.get(tag)
    const e = EQUIPMENT_BY_TAG[tag]
    if (!g || !e) return
    this.site = e.unit === 'TB1' ? 'tb1' : 'plant'
    const wp = new THREE.Vector3()
    g.getWorldPosition(wp)
    const big = e.kind === 'lamella' || e.kind === 'filter' || e.kind === 'flocculator'
    const d = big ? 22 : e.kind === 'cylinders' || e.kind === 'scada' ? 15 : 14
    // look down over the building's walls (roofs are hidden by default)
    const wallTop = e.unit === 'TB1' ? 10.3 : (STRUCTURE_BY_ID[e.unit]?.height ?? 0)
    // steep enough to look over the building's walls into the hall
    const up = Math.max(d * 1.15, wallTop - (e.z ?? 0) + 9)
    const off = new THREE.Vector3(d * 0.25, -d * 0.55, up).applyAxisAngle(new THREE.Vector3(0, 0, 1), this.plant.group.rotation.z)
    this.#flyTo(wp.clone().add(off), wp.clone().add(new THREE.Vector3(0, 0, 0.8)))
  }

  // ───────────── picking ─────────────
  #hit(ev: PointerEvent): { tag: string | null; unit: string | null } {
    const r = this.renderer.domElement.getBoundingClientRect()
    const nd = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
    this.#ray.setFromCamera(nd, this.camera)
    // one merged proxy per drawn item (items culled under a roof cannot be hit: the click goes to the building)
    const hits = this.#ray.intersectObjects(this.lod.pickTargets(), false)
    for (const h of hits) {
      const tag = h.object.userData.tag as string | undefined
      if (tag) return { tag, unit: EQUIPMENT_BY_TAG[tag]?.unit ?? null }
    }
    const u = this.#ray.intersectObjects(this.#unitBoxes, false)[0]
    if (u) return { tag: null, unit: u.object.userData.unit as string }
    const t = this.#ray.intersectObject(this.tb1.hitbox, false)[0]
    if (t) return { tag: null, unit: 'TB1' }
    return { tag: null, unit: null }
  }
  #onDown = (ev: PointerEvent) => {
    this.#down = { x: ev.clientX, y: ev.clientY }
  }
  #onUp = (ev: PointerEvent) => {
    if (this.#tour) return
    if (!this.#down || Math.hypot(ev.clientX - this.#down.x, ev.clientY - this.#down.y) > 5) return
    const { tag, unit } = this.#hit(ev)
    this.select(tag)
    this.onPick(tag, unit)
  }
  #onMove = (ev: PointerEvent) => {
    // picked in the frame loop, at most every 60 ms (a mouse sends up to 1000 moves a second)
    this.#hoverEv = ev.buttons ? null : ev
  }
  #hover(ev: PointerEvent) {
    const { tag } = this.#hit(ev)
    if (tag !== this.hovered) {
      if (this.hovered && this.hovered !== this.selected) setHighlight(this.equipment.get(this.hovered)!, 0)
      this.hovered = tag
      if (tag && tag !== this.selected) setHighlight(this.equipment.get(tag)!, 1)
      this.renderer.domElement.style.cursor = tag ? 'pointer' : ''
      this.onHover(tag)
    }
  }
  select(tag: string | null) {
    if (this.selected) setHighlight(this.equipment.get(this.selected)!, 0)
    this.selected = tag
    if (tag && this.equipment.get(tag)) setHighlight(this.equipment.get(tag)!, 2)
  }

  // ───────────── frame ─────────────
  /**
   * Drawn on screen. The view is built in the background while the page opens and stays built between visits; while
   * inactive it draws nothing (after a few warm-up frames, which compile its shaders so the first visit is smooth).
   */
  active = true
  #warm = 3
  #tour = false
  /** Live Demo: the tour moves the camera (the user cannot), turning slowly round the view once it arrives */
  setTourMode(on: boolean) {
    this.#tour = on
    this.controls.enabled = !on
    this.controls.autoRotate = on
    this.controls.autoRotateSpeed = 0.35
  }
  #frame = () => {
    if (this.#disposed) return
    this.#raf = requestAnimationFrame(this.#frame)
    const now = performance.now()
    if (!this.active) {
      if (this.#warm <= 0) {
        this.#last = now
        return
      }
      this.#warm--
    }
    const raw = now - this.#last
    const dt = Math.min(0.1, raw / 1000)
    this.#last = now
    this.#adaptResolution(raw, now)
    if (this.#tween) {
      const tw = this.#tween
      tw.t += dt
      const k = Math.min(1, tw.t / tw.dur)
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
      this.camera.position.lerpVectors(tw.p0, tw.p1, e)
      this.controls.target.lerpVectors(tw.t0, tw.t1, e)
      if (k >= 1) this.#tween = null
    }
    this.controls.update()
    if (this.#hoverEv && now - this.#hoverAt > 60) {
      this.#hoverAt = now
      this.#hover(this.#hoverEv)
      this.#hoverEv = null
    }
    const pinned = (tag: string) => tag === this.selected || tag === this.hovered
    if (this.lod.update(this.camera, this.renderer.domElement.clientHeight, pinned)) this.#shadowDirty = true
    this.#animate(dt, now / 1000)
    // equipment switching level changes what casts shadows; redraw the map at most every 400 ms while moving
    if (this.#shadowDirty && now - this.#shadowAt > 400) {
      this.renderer.shadowMap.needsUpdate = true
      this.#shadowDirty = false
      this.#shadowAt = now
    }
    this.renderer.render(this.scene, this.camera)
    this.labelRenderer.render(this.labelScene, this.camera)
  }

  #adaptResolution(ms: number, now: number) {
    // a pause (hidden tab, a stalled frame while loading) says nothing about the GPU
    if (ms > 250) return
    this.#frameMs += (ms - this.#frameMs) * 0.1
    const s = ms / 1000
    const MIN = 0.7
    if (this.#frameMs > 26 && this.resolutionScale > MIN) {
      this.#fastFor = 0
      if ((this.#slowFor += s) < 1) return
      // too slow right after growing: stay at the lower step for a minute
      if (now - this.#raisedAt < 3000) {
        this.#ceiling = this.resolutionScale - 0.1
        this.#ceilingUntil = now + 60000
      }
      this.#setScale(Math.max(MIN, this.resolutionScale - 0.1), now)
    } else if (this.#frameMs < 19 && this.resolutionScale < 1) {
      this.#slowFor = 0
      const cap = now < this.#ceilingUntil ? this.#ceiling : 1
      if ((this.#fastFor += s) < 3 || now - this.#changedAt < 4000 || this.resolutionScale >= cap - 0.001) return
      this.#raisedAt = now
      this.#setScale(Math.min(cap, this.resolutionScale + 0.1), now)
    } else {
      this.#slowFor = 0
      this.#fastFor = 0
    }
  }
  #setScale(scale: number, now: number) {
    this.resolutionScale = Math.round(scale * 100) / 100
    this.#changedAt = now
    this.#slowFor = 0
    this.#fastFor = 0
    this.renderer.setPixelRatio(this.#basePixelRatio * this.resolutionScale)
  }

  /**
   * Label LoD + declutter: equipment tags only near the camera, area names only from further away, and a label
   * that would overlap one already placed (higher priority first: selected, hovered, faults, areas by size,
   * then tags nearest first) is hidden.
   */
  #declutter() {
    const cam = this.camera.position
    const W = this.renderer.domElement.clientWidth
    const H = this.renderer.domElement.clientHeight
    const wp = new THREE.Vector3()
    type C = { obj: CSS2DObject; el: HTMLElement; pri: number; x: number; y: number }
    const cands: C[] = []
    const consider = (obj: CSS2DObject, el: HTMLElement, pri: number) => {
      obj.getWorldPosition(wp)
      const p = wp.project(this.camera)
      if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) {
        obj.visible = false
        return
      }
      cands.push({ obj, el, pri, x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H })
    }
    for (const u of this.unitLabels) {
      u.getWorldPosition(wp)
      const d = wp.distanceTo(cam)
      if (d <= 55) u.visible = false
      else consider(u, u.element, 2 + Math.min(1, Number(u.element.dataset.area ?? 0) / 4000))
    }
    for (const [tag, { obj, el }] of this.labels) {
      obj.getWorldPosition(wp)
      const d = wp.distanceTo(cam)
      const pinned = tag === this.selected || tag === this.hovered
      // items hidden under a roof keep their labels hidden too: the building's own label stands for them
      if (!pinned && (d >= 75 || this.lod.covered(tag))) {
        obj.visible = false
        continue
      }
      consider(obj, el, pinned ? 10 : this.sim.dev[tag]?.fault ? 5 : 1 - d / 100)
    }
    cands.sort((a, b) => b.pri - a.pri)
    const placed: Array<[number, number, number, number]> = []
    for (const c of cands) {
      let sz = this.#labelSize.get(c.el)
      if (c.obj.visible && c.el.offsetWidth) {
        sz = [c.el.offsetWidth, c.el.offsetHeight]
        this.#labelSize.set(c.el, sz)
      }
      const [w, h] = sz ?? [Math.max(40, (c.el.textContent?.length ?? 8) * 6.4 + 16), 20]
      const r: [number, number, number, number] = [c.x - w / 2 - 2, c.y - h / 2 - 2, w + 4, h + 4]
      const hit = c.pri < 10 && placed.some(q => r[0] < q[0] + q[2] && r[0] + r[2] > q[0] && r[1] < q[1] + q[3] && r[1] + r[3] > q[1])
      c.obj.visible = !hit
      if (!hit) placed.push(r)
    }
  }

  #labelTick = 0
  #statusTick = 0
  #animate(dt: number, t: number) {
    const sim = this.sim
    INTAKE_ANIM.uTime.value = t
    INTAKE_ANIM.uFlow.value = Math.min(1.5, sim.qRaw / 1450)
    for (const [tag, g] of this.equipment) {
      const d = sim.dev[tag]
      if (!d) continue
      const level = this.lod.level(tag)
      if (level === 'off') continue
      const e = EQUIPMENT_BY_TAG[tag]
      const linked = e?.link ? sim.dev[e.link] : undefined
      const on = linked ? linked.run && !linked.fault : d.run && !d.fault
      // rotors and status LEDs only exist on the full model
      if (level === 'full') {
        // the catalog models' rotors (impellers, paddles, fans) spin about their local +Y
        const anim = g.userData.anim as { spin: THREE.Object3D[] } | undefined
        if (anim && on) {
          const speed = e?.kind === 'pump' ? 12 : ((d.sp || 50) / 50) * 2.2
          for (const s of anim.spin) s.rotation.y += dt * speed
        }
        // catalog status parts (LEDs, rings on sensors and panels)
        if (this.#statusTick === 0) {
          const s = equipmentStatus(sim, tag)
          for (const m of (g.userData.models as THREE.Object3D[] | undefined) ?? []) setModelStatus(m, s)
        }
      }
      const ring = g.userData.ring as THREE.Mesh | undefined
      if (ring) {
        const m = ring.material as THREE.MeshBasicMaterial
        m.color.setHex(d.fault ? RING.fault : on ? (d.mode === 'man' ? RING.man : RING.run) : RING.stop)
        m.opacity = d.fault ? 0.55 + 0.4 * Math.sin(t * 8) : 0.85
      }
    }
    this.#statusTick = (this.#statusTick + 1) % 10
    // water levels
    const w = this.plant.water
    if (w.reservoir) w.reservoir.position.z = 0.1 + (sim.reservoirLevel / 5.3) * 1.35
    if (w.pond) w.pond.position.z = 0.05 + (sim.pondLevel / 4.6) * 0.6
    const s5h = STRUCTURE_BY_ID.S05!.height
    let washing: number | null = null
    w.filters.forEach((m, i) => {
      const f = sim.dev[`F-50${i + 1}`]!
      const full = s5h - 0.6
      const target = f.phase === 'filter' ? full : f.phase === 'drain' ? 2.1 : f.phase === 'air' ? 2.0 : f.phase === 'airwater' ? 2.8 : f.phase === 'rinse' ? 3.4 : f.phase === 'refill' ? 2.2 + (f.phaseT / 240) * (full - 2.2) : full
      m.position.z += (target - m.position.z) * Math.min(1, dt * 1.5)
      const mm = m.material as THREE.MeshStandardMaterial
      mm.color.setHex(f.phase === 'airwater' || f.phase === 'air' ? 0x9cc7e0 : f.phase === 'rinse' ? 0x7aa9a0 : STAGE_WATER.filtered)
      if (f.phase === 'air' || f.phase === 'airwater') washing = i
    })
    if (washing !== null) {
      const cell = rectOf(PLANT.parts.S05.cells[washing]!)
      const zf = w.filters[washing]!.position.z
      const o = new THREE.Object3D()
      for (let k = 0; k < this.bubbles.count; k++) {
        const ph = (t * 0.9 + k * 0.137) % 1
        o.position.set(cell.x0 + 0.5 + ((k * 0.618) % 1) * (cell.w - 1), cell.y0 + 0.5 + ((k * 0.382 + t * 0.05) % 1) * (cell.h - 1), zf - 0.5 + ph * 0.7)
        o.scale.setScalar(0.6 + ph)
        o.updateMatrix()
        this.bubbles.setMatrixAt(k, o.matrix)
      }
      this.bubbles.instanceMatrix.needsUpdate = true
      this.bubbles.visible = true
    } else this.bubbles.visible = false
    // chlorine leak
    const lc = this.leakCloud.material as THREE.MeshBasicMaterial
    lc.opacity = Math.min(0.45, sim.leak * 0.08)
    this.leakCloud.scale.setScalar(2 + sim.leak * 2.4 + Math.sin(t * 2) * 0.3)
    this.leakCloud.visible = sim.leak > 0.05
    // flow particles
    const rate: Record<ProcessPipe['flow'], number> = {
      raw: sim.qRaw / 1450,
      transfer: sim.qTransfer / 1500,
      filtered: sim.qFiltered / 1400,
      out: sim.qOut / 1300,
      backwash: sim.qBackwash / 1050,
      air: sim.dev['B-701']!.run || sim.dev['B-702']!.run ? 1.2 : 0,
      pac: sim.pacDose > 0 ? 0.5 : 0,
      cl: sim.dev['CL-902']!.q > 0 ? 0.5 : 0,
      waste: sim.qBackwash > 0 ? 0.8 : 0.15,
    }
    const cam = this.camera.position
    for (const f of this.flows) f.update(dt, this.showFlow && f.distanceTo(cam) < FLOW_DIST ? Math.min(1.6, rate[f.pipe.flow]) * 3.5 : 0)
    // equipment value chips (4 Hz) — label LoD: tags only near the camera, unit names only from afar
    if ((this.#labelTick += dt) > 0.25 && this.showLabels) {
      this.#labelTick = 0
      this.#declutter()
      for (const [tag, { el, obj }] of this.labels) {
        if (!obj.visible) continue
        const d = sim.dev[tag]
        const span = el.lastElementChild as HTMLElement
        const r = sim.readings(tag)[0]
        span.textContent = r ? `${r.v}${r.u ? ' ' + r.u : ''}` : ''
        const e = EQUIPMENT_BY_TAG[tag]
        el.dataset.state = !d || !e
          ? 'na'
          : d.fault
            ? 'fault'
            : e.kind === 'filter'
              ? d.phase === 'filter' ? 'run' : 'man'
              : e.kind === 'valve'
                ? d.open > 0.5 ? 'run' : 'stop'
                : !e.control
                  ? 'na'
                  : d.run ? (d.mode === 'man' ? 'man' : 'run') : 'stop'
        el.classList.toggle('sel', tag === this.selected)
      }
    }
  }
}
