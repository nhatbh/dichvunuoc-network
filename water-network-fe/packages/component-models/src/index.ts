// Water network component models: public API.
//
//   const obj = createComponent('GateValve', { dn: 200 });
//   scene.add(obj);
//   getPorts(obj)            -> [{ id:'A', position, direction, dn }, ...]
//   setStatus(obj, 'warning')  // recolours status parts (sensors, hydrants, meters)
//   placeOnPipe(obj, a, b)     // orient an in-line device along a pipe segment
//   toInstancedParts(obj)      // merged geometry per material, for InstancedMesh at city scale
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { statusMaterial } from './core.js';
import type { BuildOptions, ComponentData, Port, Status } from './core.js';
import * as F from './fittings.js';
import * as Vv from './valves.js';
import * as D from './devices.js';
import * as Fa from './facilities.js';
import { CATALOG_ITEMS } from './catalog.js';
import type { CatalogItem } from './catalog.js';

import { registerBuilder, ComponentView } from './views.js';
import type { ViewOptions } from './views.js';

export * from './core.js';
export * from './types.js';
export * from './catalog.js';
export * from './codes.js';
export * from './symbols.js';
export * from './views.js';

export interface CatalogEntry extends CatalogItem {
  build: (o: BuildOptions) => THREE.Group;
}

const BUILDERS: Record<string, (o: BuildOptions) => THREE.Group> = {
  Pipe: F.pipe, Junction: F.junction, Tee: F.tee, ReducingTee: F.reducingTee, Cross: F.cross, Bend: F.bend,
  Reducer: F.reducer, Cap: F.cap, Coupling: F.coupling, Transition: F.transition, DismantlingJoint: F.dismantlingJoint,
  ExpansionJoint: F.expansionJoint, TappingSaddle: F.tappingSaddle, RepairClamp: F.repairClamp,
  GateValve: Vv.gateValve, ButterflyValve: Vv.butterflyValve, BallValve: Vv.ballValve, CheckValve: Vv.checkValve,
  PRV: Vv.prv, PSV: Vv.psv, FCV: Vv.fcv, AltitudeValve: Vv.altitudeValve, AirValve: Vv.airValve, Washout: Vv.washout,
  BackflowPreventer: Vv.backflowPreventer, Strainer: Vv.strainer,
  Hydrant: D.hydrant, ServiceConnection: D.serviceConnection, ServiceValve: D.serviceValve, CustomerMeter: D.customerMeter,
  SamplingPoint: D.samplingPoint, BulkMeter: D.bulkMeter, PressureSensor: D.pressureSensor, LevelSensor: D.levelSensor,
  QualitySensor: D.qualitySensor, AcousticLogger: D.acousticLogger, RTU: D.rtu, ChlorinationPoint: D.chlorinationPoint,
  Pump: Fa.pump, BoosterStation: Fa.boosterStation, PRVStation: Fa.prvStation, PumpStation: Fa.pumpStation,
  Reservoir: Fa.reservoir, Tank: Fa.tank, Source: Fa.source,
};

export const CATALOG: CatalogEntry[] = CATALOG_ITEMS.map((item) => {
  const build = BUILDERS[item.code];
  if (!build) throw new Error(`No 3D builder for catalog code ${item.code}`);
  return { ...item, build };
});
const BY_CODE = new Map(CATALOG.map((c) => [c.code, c]));
export const getEntry = (code: string) => BY_CODE.get(code);

export function createComponent(code: string, opts: BuildOptions = {}): THREE.Group {
  const entry = BY_CODE.get(code);
  if (!entry) throw new Error(`Unknown component code "${code}". Known: ${CATALOG.map((c) => c.code).join(', ')}`);
  const dn = THREE.MathUtils.clamp(opts.dn ?? entry.defaultDN, entry.dnRange[0], entry.dnRange[1]);
  const g = entry.build({ ...opts, dn });
  (g.userData as ComponentData).code = code;
  return g;
}

registerBuilder(createComponent);

/** A component with both display modes: flat symbol far away (or in 2D), 3D model up close. */
export const createComponentView = (code: string, opts: ViewOptions = {}) => new ComponentView(code, opts);

export const getPorts =(obj: THREE.Object3D): Port[] => (obj.userData as ComponentData).ports ?? [];

/** Port positions in world space (call after the object is placed). */
export function getWorldPorts(obj: THREE.Object3D): Port[] {
  obj.updateWorldMatrix(true, false);
  const q = obj.getWorldQuaternion(new THREE.Quaternion());
  return getPorts(obj).map((p) => ({ ...p, position: p.position.clone().applyMatrix4(obj.matrixWorld), direction: p.direction.clone().applyQuaternion(q) }));
}

export function setStatus(obj: THREE.Object3D, status: Status) {
  const m = statusMaterial(status);
  obj.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.userData.part === 'status') (o as THREE.Mesh).material = m; });
}

/** Orient an in-line device so port A faces `from` and port B faces `to`, centred on the segment midpoint. */
export function placeOnPipe(obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, up = new THREE.Vector3(0, 1, 0)) {
  const x = to.clone().sub(from).normalize();
  let z = new THREE.Vector3().crossVectors(x, up);
  if (z.lengthSq() < 1e-8) z = new THREE.Vector3().crossVectors(x, new THREE.Vector3(1, 0, 0));
  z.normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  obj.position.copy(from).add(to).multiplyScalar(0.5);
}

/** Merge a built component into one geometry per material, for THREE.InstancedMesh. */
export function toInstancedParts(obj: THREE.Object3D): { geometry: THREE.BufferGeometry; material: THREE.Material; status: boolean }[] {
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const groups = new Map<string, { geos: THREE.BufferGeometry[]; material: THREE.Material; status: boolean }>();
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const status = mesh.userData.part === 'status';
    const mat = mesh.material as THREE.Material;
    const key = status ? 'status' : mat.uuid;
    const geo = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(nonIndexed.attributes)) if (!['position', 'normal', 'uv'].includes(k)) nonIndexed.deleteAttribute(k);
    if (!nonIndexed.attributes.uv) nonIndexed.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(nonIndexed.attributes.position!.count * 2), 2));
    const gEntry = groups.get(key) ?? { geos: [], material: mat, status };
    gEntry.geos.push(nonIndexed); groups.set(key, gEntry);
  });
  return [...groups.values()].map((v) => ({ geometry: mergeGeometries(v.geos, false)!, material: v.material, status: v.status }));
}

/** Total triangle count, for LOD budgeting. */
export function triangleCount(obj: THREE.Object3D) {
  let n = 0;
  obj.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g) n += (g.index ? g.index.count : g.attributes.position!.count) / 3; });
  return Math.round(n);
}
