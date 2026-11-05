import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CATALOG, createComponentView, ComponentView, PipeView, updateViews, symbolSVG, getPorts, triangleCount, CatalogEntry, MaterialCode, Status, DisplayMode } from '../src/index.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- three setup ----------
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxDistance = 5000;

const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f96, 1.4); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; scene.add(sun); scene.add(sun.target);
const fill = new THREE.DirectionalLight(0xdfe8ff, 0.6); fill.position.set(-3, 2, -4); scene.add(fill);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.18 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
let grid: THREE.GridHelper | null = null;

const root = new THREE.Group(); scene.add(root);
const portLayer = new THREE.Group(); scene.add(portLayer);
const labels = $('labels');

// ---------- state ----------
const state = {
  code: 'GateValve', dn: 150, dn2: 0, material: 'DuctileIron' as MaterialCode, angle: 90,
  status: 'normal' as Status, ports: true, gallery: false, lod: 20, handwheel: true, mode: 'auto' as DisplayMode,
};
try { const s = JSON.parse(localStorage.getItem('wc-preview') || '{}'); if (s.code && CATALOG.some((c) => c.code === s.code)) Object.assign(state, { code: s.code }); } catch { /* storage unavailable */ }
const save = () => { try { localStorage.setItem('wc-preview', JSON.stringify({ code: state.code })); } catch { /* ignore */ } };

const entry = () => CATALOG.find((c) => c.code === state.code)!;
const DN_STEPS = [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1200];
const stepsFor = (e: CatalogEntry) => DN_STEPS.filter((d) => d >= e.dnRange[0] && d <= e.dnRange[1]);

// ---------- list ----------
const list = $('list');
const cats = [...new Set(CATALOG.map((c) => c.category))];
function renderList(filter = '') {
  const f = filter.trim().toLowerCase();
  list.innerHTML = '';
  for (const cat of cats) {
    const items = CATALOG.filter((c) => c.category === cat && (!f || `${c.code} ${c.name} ${c.vi}`.toLowerCase().includes(f)));
    if (!items.length) continue;
    const h = document.createElement('h3'); h.textContent = cat; h.innerHTML += ` <span>${items.length}</span>`; list.appendChild(h);
    for (const c of items) {
      const b = document.createElement('button');
      b.className = 'item'; b.dataset.code = c.code; b.type = 'button';
      b.setAttribute('aria-pressed', String(c.code === state.code && !state.gallery));
      b.innerHTML = `<span class="name">${c.name}</span><span class="vi">${c.vi}</span><code>${c.code}</code>`;
      b.onclick = () => { state.code = c.code; state.gallery = false; state.dn = c.defaultDN; state.dn2 = 0; save(); syncControls(); rebuild(true); };
      list.appendChild(b);
    }
  }
}
$<HTMLInputElement>('search').addEventListener('input', (ev) => renderList((ev.target as HTMLInputElement).value));

// ---------- controls ----------
const dnInput = $<HTMLInputElement>('dn'), dnOut = $('dn-out');
const dn2Input = $<HTMLInputElement>('dn2'), dn2Out = $('dn2-out');
function syncControls() {
  const e = entry(), steps = stepsFor(e);
  $('title').textContent = state.gallery ? 'All components' : e.name;
  $('vi').textContent = state.gallery ? `${CATALOG.length} models, default sizes` : e.vi;
  $('code').textContent = state.gallery ? 'gallery' : e.code;
  $('role').textContent = state.gallery ? '—' : ({ line: 'Line', node: 'Node (fitting)', inline: 'In-line device', nodeDevice: 'Node device', facility: 'Facility' } as const)[e.role];
  $('portspec').textContent = state.gallery ? '—' : e.variablePorts ? 'any number' : `${e.ports.length}: ${e.ports.join(', ')}`;
  $('dnrange').textContent = state.gallery ? '—' : `DN ${e.dnRange[0]}–${e.dnRange[1]}`;
  const idx = Math.max(0, steps.findIndex((d) => d >= state.dn));
  dnInput.max = String(steps.length - 1); dnInput.value = String(idx); state.dn = steps[idx];
  dnOut.textContent = `DN ${state.dn}`;
  dnInput.disabled = state.gallery || steps.length < 2;
  const small = steps.filter((d) => d < state.dn);
  $('row-dn2').hidden = state.gallery || !e.usesDN2 || !small.length;
  if (small.length) {
    if (!state.dn2 || state.dn2 >= state.dn) state.dn2 = small[Math.max(0, small.length - 2)];
    dn2Input.max = String(small.length - 1); dn2Input.value = String(Math.max(0, small.indexOf(state.dn2)));
    dn2Out.textContent = `DN ${state.dn2}`;
  }
  $('row-mat').hidden = state.gallery || !e.usesMaterial;
  $('row-angle').hidden = state.gallery || !e.usesAngle;
  $('row-status').hidden = !state.gallery && !e.hasStatus;
  $('row-hw').hidden = state.gallery || e.code !== 'GateValve';
  $<HTMLButtonElement>('gallery').setAttribute('aria-pressed', String(state.gallery));
  list.querySelectorAll<HTMLButtonElement>('.item').forEach((b) => b.setAttribute('aria-pressed', String(!state.gallery && b.dataset.code === state.code)));
}
dnInput.addEventListener('input', () => { state.dn = stepsFor(entry())[+dnInput.value]; syncControls(); rebuild(false); });
dn2Input.addEventListener('input', () => { state.dn2 = stepsFor(entry()).filter((d) => d < state.dn)[+dn2Input.value]; dn2Out.textContent = `DN ${state.dn2}`; rebuild(false); });
$<HTMLSelectElement>('material').addEventListener('change', (ev) => { state.material = (ev.target as HTMLSelectElement).value as MaterialCode; rebuild(false); });
$<HTMLSelectElement>('angle').addEventListener('change', (ev) => { state.angle = +(ev.target as HTMLSelectElement).value; rebuild(false); });
$<HTMLSelectElement>('status').addEventListener('change', (ev) => { state.status = (ev.target as HTMLSelectElement).value as Status; views.forEach((v) => v.setStatus(state.status)); renderSymbol(); });
$<HTMLInputElement>('showports').addEventListener('change', (ev) => { state.ports = (ev.target as HTMLInputElement).checked; portLayer.visible = state.ports; labels.hidden = !state.ports && !state.gallery; });
$<HTMLInputElement>('handwheel').addEventListener('change', (ev) => { state.handwheel = (ev.target as HTMLInputElement).checked; rebuild(false); });
$<HTMLSelectElement>('lod').addEventListener('change', (ev) => { state.lod = +(ev.target as HTMLSelectElement).value; rebuild(false); });
$('gallery').addEventListener('click', () => { state.gallery = !state.gallery; syncControls(); rebuild(true); });
$('reset').addEventListener('click', () => fit(true));
$('plan').addEventListener('click', () => fit(true, true));
document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => b.addEventListener('click', () => {
  state.mode = b.dataset.mode as DisplayMode;
  document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  allViews().forEach((v) => v.setMode(state.mode));
}));
$('copysvg').addEventListener('click', async () => {
  const svg = symbolSVG(state.code, { status: entry().hasStatus ? state.status : undefined, size: 32 });
  const btn = $('copysvg');
  try { await navigator.clipboard.writeText(svg); btn.textContent = 'Copied'; }
  catch { const ta = $<HTMLTextAreaElement>('svgtext'); ta.hidden = false; ta.value = svg; ta.select(); btn.textContent = 'Select and copy'; }
  setTimeout(() => { btn.textContent = 'Copy SVG'; }, 1600);
});
function renderSymbol() {
  const e = entry();
  $('symbol').innerHTML = state.gallery ? '' : symbolSVG(e.code, { status: e.hasStatus ? state.status : undefined, size: 56 });
  $('symbolrow').hidden = state.gallery;
}

// ---------- build ----------
type Label = { el: HTMLElement; p: THREE.Vector3 };
let labelList: Label[] = [];
let views: ComponentView[] = [];
let pipes: PipeView[] = [];
const allViews = () => [...views, ...pipes];
function clear() {
  root.clear(); portLayer.clear(); labels.innerHTML = ''; labelList = []; views = []; pipes = [];
}
function addLabel(text: string, p: THREE.Vector3, cls: string) {
  const el = document.createElement('div'); el.className = cls; el.textContent = text; labels.appendChild(el);
  labelList.push({ el, p });
}
function addPorts(obj: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()).length();
  const len = THREE.MathUtils.clamp(size * 0.16, 0.05, 3);
  const col = new THREE.Color(css('--port') || '#e07a2e');
  for (const p of getPorts(obj)) {
    const wp = p.position.clone().applyMatrix4(obj.matrixWorld);
    const a = new THREE.ArrowHelper(p.direction, wp, len, col, len * 0.35, len * 0.2);
    portLayer.add(a);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(len * 0.07, 12, 8), new THREE.MeshBasicMaterial({ color: col }));
    dot.position.copy(wp); portLayer.add(dot);
    addLabel(`${p.id} · DN${p.dn}`, wp.clone().addScaledVector(p.direction, len * 1.25), 'tag port');
  }
}
function build(e: CatalogEntry, single: boolean) {
  const v = createComponentView(e.code, single ? {
    dn: state.dn, dn2: e.usesDN2 ? state.dn2 : undefined, material: e.usesMaterial ? state.material : undefined,
    angle: state.angle, segments: state.lod, handwheel: state.handwheel,
    status: state.status, mode: state.mode,
  } : { segments: state.lod, status: state.status, mode: state.mode });
  views.push(v); return v;
}
function liftToGround(obj: THREE.Object3D) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  obj.position.y -= b.min.y; obj.updateMatrixWorld(true);
}
function rebuild(refit: boolean) {
  clear();
  if (state.gallery) {
    // small parts first, then sites; facilities get their own row
    const small = CATALOG.filter((c) => c.role !== 'facility' && c.code !== 'Tank' && c.code !== 'Source');
    const big = CATALOG.filter((c) => !small.includes(c));
    const cols = 7, pitch = 2.3;
    small.forEach((c, i) => {
      const o = build(c, false);
      const x = (i % cols - (cols - 1) / 2) * pitch, z = Math.floor(i / cols) * pitch;
      const b = new THREE.Box3().setFromObject(o), s = b.getSize(new THREE.Vector3());
      const k = Math.min(1.2, 1.25 / Math.max(s.x, s.z, s.y * 0.8));
      o.scale.setScalar(k); o.position.set(x, 0, z); liftToGround(o); o.userData.galleryCode = c.code; root.add(o);
      addLabel(c.code, V3(x, 0, z + 0.8), 'tag');
    });
    const z0 = Math.ceil(small.length / cols) * pitch + 2.6, fcols = 3, fp = 4.7;
    big.forEach((c, i) => {
      const o = build(c, false);
      const b = new THREE.Box3().setFromObject(o), s = b.getSize(new THREE.Vector3());
      const k = 3.2 / Math.max(s.x, s.z, s.y);
      const x = (i % fcols - (fcols - 1) / 2) * fp, z = z0 + Math.floor(i / fcols) * fp;
      o.scale.setScalar(k); o.position.set(x, 0, z); liftToGround(o); o.userData.galleryCode = c.code; root.add(o);
      addLabel(c.code, V3(x, 0, z + 2.1), 'tag');
    });
    $('tris').textContent = views.reduce((n, v) => n + triangleCount(v.near), 0).toLocaleString('en-US');
    $('size').textContent = 'scaled to fit';
  } else {
    const e = entry(), o = build(e, true);
    root.add(o); liftToGround(o);
    const s = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
    // context pipes on the horizontal ports, so the flat mode shows symbol and pipe together
    const pmat = (e.usesMaterial ? state.material : 'DuctileIron') as MaterialCode;
    for (const p of getPorts(o)) {
      if (Math.abs(p.direction.y) > 0.5 || e.role === 'line') continue;
      const a = p.position.clone().applyMatrix4(o.matrixWorld);
      const len = Math.max(1.2, o.radius * 2.5);
      const pv = new PipeView(a, a.clone().addScaledVector(p.direction, len), { dn: p.dn, material: e.code === 'Transition' && p.id === 'A' ? 'HDPE' : pmat, mode: state.mode });
      pv.near.traverse((m) => { const mm = m as THREE.Mesh; if (mm.isMesh) { mm.material = (mm.material as THREE.Material).clone(); (mm.material as THREE.Material).transparent = true; (mm.material as THREE.MeshStandardMaterial).opacity = 0.35; } });
      pipes.push(pv); root.add(pv);
    }
    if (state.ports) addPorts(o);
    $('tris').textContent = triangleCount(o.near).toLocaleString('en-US');
    $('size').textContent = `${fmt(s.x)} × ${fmt(s.z)} × ${fmt(s.y)} m`;
  }
  portLayer.visible = state.ports || state.gallery;
  labels.hidden = !state.ports && !state.gallery; $('pickhint').hidden = !state.gallery;
  renderSymbol();
  fit(refit);
}
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const fmt = (v: number) => (v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : v.toFixed(0));

let lastRadius = 1;
function fit(force: boolean, plan = false) {
  const box = new THREE.Box3();
  for (const v of views) box.expandByObject(v.near);
  if (box.isEmpty()) box.setFromObject(root);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = Math.max(sphere.radius, 0.05);
  const grow = r / lastRadius;
  if (force || plan || grow > 1.4 || grow < 0.6) {
    const dist = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * (state.gallery ? 0.95 : 1.05);
    const dir = plan ? V3(0, 1, 0.001).normalize() : state.gallery ? V3(0, 1.5, 1).normalize() : V3(1.1, 0.75, 1.3).normalize();
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(dir, dist);
    lastRadius = r;
  }
  camera.near = r / 100; camera.far = r * 400; camera.updateProjectionMatrix();
  const gsize = Math.max(r * 6, 1);
  ground.scale.set(gsize, gsize, 1); ground.position.set(sphere.center.x, 0, sphere.center.z);
  sun.position.copy(sphere.center).add(V3(r * 2, r * 4, r * 2.5)); sun.target.position.copy(sphere.center);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -r * 1.6; sc.right = sc.top = r * 1.6; sc.near = 0.01; sc.far = r * 12; sc.updateProjectionMatrix();
  if (grid) scene.remove(grid);
  const step = Math.pow(10, Math.floor(Math.log10(r * 0.6)));
  const div = Math.max(4, Math.round(gsize / step));
  grid = new THREE.GridHelper(div * step, div, new THREE.Color(css('--grid-strong')), new THREE.Color(css('--grid')));
  grid.position.set(sphere.center.x, 0.0005, sphere.center.z);
  scene.add(grid);
  $('gridstep').textContent = step >= 1 ? `${step} m` : `${Math.round(step * 1000)} mm`;
}

// ---------- pick in gallery ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let downAt: [number, number] | null = null;
renderer.domElement.addEventListener('pointerdown', (ev) => { downAt = [ev.clientX, ev.clientY]; });
renderer.domElement.addEventListener('pointerup', (ev) => {
  if (!state.gallery || !downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 4) return;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(root.children, true)[0];
  let o: THREE.Object3D | null = hit?.object ?? null;
  while (o && !o.userData.galleryCode) o = o.parent;
  if (!o) return;
  const e = CATALOG.find((c) => c.code === o!.userData.galleryCode)!;
  state.code = e.code; state.gallery = false; state.dn = e.defaultDN; state.dn2 = 0; save(); syncControls(); rebuild(true);
});

// ---------- theme ----------
function applyTheme() {
  scene.background = new THREE.Color(css('--stage'));
  (ground.material as THREE.ShadowMaterial).opacity = document.documentElement.matches('[data-theme="dark"]') || (matchMedia('(prefers-color-scheme: dark)').matches && !document.documentElement.matches('[data-theme="light"]')) ? 0.35 : 0.18;
  hemi.groundColor = new THREE.Color(css('--stage'));
  if (root.children.length) fit(false);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ---------- loop ----------
function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
const tmp = new THREE.Vector3();
function tick() {
  controls.update();
  const h0 = view.clientHeight || 1;
  updateViews(root, camera, h0);
  if (!state.gallery && views[0]) {
    const v = views[0], r = v.update(camera, h0);
    const txt = r.level === 'flat' ? 'Flat symbol' : r.level === 'low' ? '3D model, low detail' : '3D model';
    $('level').textContent = txt; $('levelpx').textContent = `${Math.round(r.px)} px on screen`;
    portLayer.visible = state.ports && r.level !== 'flat';
    labels.hidden = !(state.ports && r.level !== 'flat');
  } else { $('level').textContent = 'Per model'; $('levelpx').textContent = ''; }
  renderer.render(scene, camera);
  const w = view.clientWidth, h = view.clientHeight;
  for (const l of labelList) {
    tmp.copy(l.p).project(camera);
    const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
    l.el.style.display = vis ? '' : 'none';
    if (vis) l.el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
  }
  requestAnimationFrame(tick);
}

(window as unknown as { __wcPreview: unknown }).__wcPreview = { camera, controls };
renderList(); syncControls(); applyTheme(); resize(); rebuild(true); tick();
