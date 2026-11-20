/**
 * The plant's own 3D view (entered by clicking the plant on the map): the CAD-derived site at full detail with
 * every equipment item modelled, roofs removable, live state from the simulation (spinning motors, status rings,
 * water levels, filter backwash, flow particles in the process pipes, chlorine leak cloud) and picking.
 * TB1 (the river intake, 5 km away) is a second site in the same view.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { EQUIPMENT, EQUIPMENT_BY_TAG, PLANT, R, rectOf, STRUCTURE_BY_ID, type Rect } from '../data/plant-model'
import { equipmentStatus } from '../sim/plant-sim'
import { setModelStatus } from '../three/catalog-mesh'
import { setHighlight } from '../three/equipment'
import { buildIntake } from '../three/intake-builder'
import { buildPlant, FLUID_COLOR, PROCESS_PIPES, type PlantModel, type ProcessPipe } from '../three/plant-builder'
import type { PlantSim } from '../sim/plant-sim'

export type Site = 'plant' | 'tb1'
const RING = { run: 0x19b85a, stop: 0x8a948f, fault: 0xe0443c, man: 0xf0a20a }
const TB1_OFFSET = new THREE.Vector3(0, -900, 0)

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
    this.mesh.frustumCulled = false
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

  constructor(
    private container: HTMLElement,
    private sim: PlantSim,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
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

    const bg = getComputedStyle(document.documentElement).getPropertyValue('--scene-bg').trim() || '#dfe5e2'
    this.scene.background = new THREE.Color(bg)
    this.scene.fog = new THREE.Fog(new THREE.Color(bg), 700, 1900)
    const hemi = new THREE.HemisphereLight(0xf2f6ff, 0x5d604f, 1.25)
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

    // ground around both sites
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x9fae8a, roughness: 1 }))
    ground.position.set(0, -400, -0.02)
    ground.receiveShadow = true
    this.scene.add(ground)

    this.plant = buildPlant('factory')
    this.scene.add(this.plant.group)
    for (const [k, g] of this.plant.equipment) this.equipment.set(k, g)
    this.tb1 = buildIntake('factory')
    this.tb1.group.position.copy(TB1_OFFSET)
    this.scene.add(this.tb1.group)
    for (const [k, g] of this.tb1.equipment) this.equipment.set(k, g)
    // river at TB1
    const river = new THREE.Mesh(new THREE.PlaneGeometry(400, 260), new THREE.MeshStandardMaterial({ color: 0x6b8fa3, roughness: 0.2, metalness: 0.1 }))
    river.position.set(TB1_OFFSET.x + 175, TB1_OFFSET.y, 0.05)
    this.scene.add(river)

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
      el.textContent = `${s.no}. ${s.name}`
      const o = new CSS2DObject(el)
      o.position.set(r.cx, r.cy, s.height + (s.kind === 'pond' ? 2 : 3.5))
      this.plant.group.add(o)
      this.unitLabels.push(o)
    }
    {
      const el = document.createElement('div')
      el.className = 'tw-unit-label'
      el.textContent = 'TB1 · Công trình thu & trạm bơm nước thô'
      const o = new CSS2DObject(el)
      o.position.set(0, 0, 14)
      this.tb1.group.add(o)
      this.unitLabels.push(o)
    }

    // equipment labels
    for (const e of EQUIPMENT) {
      const g = this.equipment.get(e.tag)
      if (!g) continue
      const el = document.createElement('div')
      el.className = 'tw-tag'
      el.innerHTML = `<b>${e.tag}</b><span></span>`
      const o = new CSS2DObject(el)
      const box = new THREE.Box3().setFromObject(g)
      o.position.set(0, 0, Math.max(1.6, box.max.z - (e.z ?? 0) + 0.6))
      g.add(o)
      this.labels.set(e.tag, { obj: o, el })
    }

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

    this.setRoofs(false)
    this.#ro = new ResizeObserver(() => this.#resize())
    this.#ro.observe(container)
    this.#resize()
    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this.#onDown)
    el.addEventListener('pointerup', this.#onUp)
    el.addEventListener('pointermove', this.#onMove)
    this.#raf = requestAnimationFrame(this.#frame)
  }

  dispose() {
    this.#disposed = true
    cancelAnimationFrame(this.#raf)
    this.#ro.disconnect()
    this.controls.dispose()
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
    for (const r of [...this.plant.roofs, ...this.tb1.roofs]) r.visible = on
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
  /** intro: from the map's bird's-eye down into the plant */
  intro() {
    this.camera.position.set(60, -520, 640)
    this.controls.target.set(-20, 0, 0)
    this.#flyTo(new THREE.Vector3(70, -250, 170), new THREE.Vector3(-30, 5, 0), 2.2)
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
    const d = big ? 20 : e.kind === 'cylinders' || e.kind === 'scada' ? 13 : 11
    // look down over the building's walls (roofs are hidden by default)
    const wallTop = e.unit === 'TB1' ? 10.3 : (STRUCTURE_BY_ID[e.unit]?.height ?? 0)
    const up = Math.max(d * 0.85, wallTop - (e.z ?? 0) + 4)
    const off = new THREE.Vector3(d * 0.35, -d * 0.7, up).applyAxisAngle(new THREE.Vector3(0, 0, 1), this.plant.group.rotation.z)
    this.#flyTo(wp.clone().add(off), wp.clone().add(new THREE.Vector3(0, 0, 0.8)))
  }

  // ───────────── picking ─────────────
  #hit(ev: PointerEvent): { tag: string | null; unit: string | null } {
    const r = this.renderer.domElement.getBoundingClientRect()
    const nd = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
    this.#ray.setFromCamera(nd, this.camera)
    const targets: THREE.Object3D[] = [...this.equipment.values()]
    const hits = this.#ray.intersectObjects(targets, true)
    for (const h of hits) {
      if ((h.object as THREE.Mesh).userData.ring) continue
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
    if (!this.#down || Math.hypot(ev.clientX - this.#down.x, ev.clientY - this.#down.y) > 5) return
    const { tag, unit } = this.#hit(ev)
    this.select(tag)
    this.onPick(tag, unit)
  }
  #onMove = (ev: PointerEvent) => {
    if (ev.buttons) return
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
  #frame = () => {
    if (this.#disposed) return
    this.#raf = requestAnimationFrame(this.#frame)
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.#last) / 1000)
    this.#last = now
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
    this.#animate(dt, now / 1000)
    this.renderer.render(this.scene, this.camera)
    this.labelRenderer.render(this.scene, this.camera)
  }

  #labelTick = 0
  #statusTick = 0
  #animate(dt: number, t: number) {
    const sim = this.sim
    for (const [tag, g] of this.equipment) {
      const d = sim.dev[tag]
      if (!d) continue
      const e = EQUIPMENT_BY_TAG[tag]
      const linked = e?.link ? sim.dev[e.link] : undefined
      const on = linked ? linked.run && !linked.fault : d.run && !d.fault
      // the catalog models' rotors (impellers, paddles, fans) spin about their local +Y
      const anim = g.userData.anim as { spin: THREE.Object3D[] } | undefined
      if (anim && on) {
        const speed = e?.kind === 'pump' ? 12 : (d.sp || 50) / 50 * 2.2
        for (const s of anim.spin) s.rotation.y += dt * speed
      }
      // catalog status parts (LEDs, rings on sensors and panels)
      if ((this.#statusTick ?? 0) === 0) {
        const s = equipmentStatus(sim, tag)
        for (const m of (g.userData.models as THREE.Object3D[] | undefined) ?? []) setModelStatus(m, s)
      }
      const ring = g.userData.ring as THREE.Mesh | undefined
      if (ring) {
        const m = ring.material as THREE.MeshBasicMaterial
        m.color.setHex(d.fault ? RING.fault : on ? (d.mode === 'man' ? RING.man : RING.run) : RING.stop)
        m.opacity = d.fault ? 0.55 + 0.4 * Math.sin(t * 8) : 0.85
      }
    }
    this.#statusTick = ((this.#statusTick ?? 0) + 1) % 10
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
      mm.color.setHex(f.phase === 'airwater' || f.phase === 'air' ? 0x9cc7e0 : f.phase === 'rinse' ? 0x7aa9a0 : 0x4f9fd8)
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
    for (const f of this.flows) f.update(dt, this.showFlow ? Math.min(1.6, rate[f.pipe.flow]) * 3.5 : 0)
    // equipment value chips (4 Hz) — label LoD: tags only near the camera, unit names only from afar
    if ((this.#labelTick += dt) > 0.25 && this.showLabels) {
      this.#labelTick = 0
      const cam = this.camera.position
      const wp = new THREE.Vector3()
      for (const u of this.unitLabels) {
        u.getWorldPosition(wp)
        u.visible = wp.distanceTo(cam) > 55
      }
      for (const [tag, { obj }] of this.labels) {
        obj.getWorldPosition(wp)
        obj.visible = tag === this.selected || tag === this.hovered || wp.distanceTo(cam) < 75
      }
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
