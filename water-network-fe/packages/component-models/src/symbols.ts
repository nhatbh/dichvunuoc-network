// Flat symbols (no three.js dependency): one vector definition per catalog code, rendered either as SVG (2D map
// icons, legends) or onto a canvas texture (flat mode in the 3D scene). Drawn on a
// 32 x 32 grid with the pipe axis running left to right, so line-aligned symbols can be
// rotated to the pipe bearing.
import type { Status } from './types.js';
export type { Status } from './types.js';

type Paint = 'ink' | 'accent' | 'paper' | 'none' | `#${string}`;
type Prim =
  | { d: string; f?: Paint; s?: Paint; w?: number }
  | { t: string; x: number; y: number; size: number; f?: Paint };

export type SymbolShape = 'none' | 'circle' | 'square';
export type SymbolAlign = 'pipe' | 'point';
export interface SymbolDef { shape: SymbolShape; align: SymbolAlign; accent: string; prims: Prim[] }

const C = { fitting: '#3a434b', valve: '#2f5d9e', hydrant: '#c8312b', service: '#6b4fa8', meter: '#13867b', plant: '#3a6e5c' };
const INK = '#1c2228', PAPER = '#ffffff';
export const STATUS_HEX: Record<Status, string> = { normal: '#2fb36b', warning: '#e5a00d', critical: '#e0453a', offline: '#7d838a' };

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const BOWTIE = 'M7 10L16 16L7 22Z M25 10L16 16L25 22Z';
const BOWTIE_LOW = 'M7 15L16 20L7 25Z M25 15L16 20L25 25Z';
const RUN = 'M3 13.5H29V18.5H3Z';

const fit = (prims: Prim[]): SymbolDef => ({ shape: 'none', align: 'pipe', accent: C.fitting, prims });
const dev = (accent: string, prims: Prim[], align: SymbolAlign = 'point', shape: SymbolShape = 'circle'): SymbolDef => ({ shape, align, accent, prims });
const controlValve = (label: string): SymbolDef => dev(C.valve, [{ d: BOWTIE_LOW, f: 'ink' }, { t: label, x: 16, y: 11.5, size: 8 }], 'pipe');

export const SYMBOLS: Record<string, SymbolDef> = {
  Pipe: fit([{ d: RUN, f: 'ink' }]),
  Junction: fit([{ d: circle(16, 16, 4.5), f: 'ink' }]),
  Tee: fit([{ d: RUN, f: 'ink' }, { d: 'M13.5 18H18.5V29H13.5Z', f: 'ink' }]),
  ReducingTee: fit([{ d: 'M3 12.5H29V19.5H3Z', f: 'ink' }, { d: 'M14.5 19H17.5V29H14.5Z', f: 'ink' }]),
  Cross: fit([{ d: RUN, f: 'ink' }, { d: 'M13.5 3H18.5V29H13.5Z', f: 'ink' }]),
  Bend: fit([{ d: 'M3 16H9A9 9 0 0 1 18 25V29', s: 'ink', w: 5, f: 'none' }]),
  Reducer: fit([{ d: 'M3 11H9L22 14H29V18H22L9 21H3Z', f: 'ink' }]),
  Cap: fit([{ d: 'M3 13.5H19V18.5H3Z', f: 'ink' }, { d: 'M19 8H24.5V24H19Z', f: 'ink' }]),
  Coupling: fit([{ d: RUN, f: 'ink' }, { d: 'M10 10H22V22H10Z', f: 'paper', s: 'ink', w: 2.5 }]),
  Transition: fit([{ d: 'M3 13.5H16V18.5H3Z', f: 'ink' }, { d: 'M16 11H29V21H16Z', f: '#2f5d9e' }, { d: 'M16 8V24', s: 'ink', w: 2 }]),
  DismantlingJoint: fit([{ d: RUN, f: 'ink' }, { d: 'M8.5 8H12V24H8.5Z M20 8H23.5V24H20Z', f: 'ink' }, { d: 'M12 10H20M12 22H20', s: 'ink', w: 1.5 }]),
  ExpansionJoint: fit([{ d: 'M3 13.5H9V18.5H3Z M23 13.5H29V18.5H23Z', f: 'ink' }, { d: 'M9 16L11 9L14 23L17 9L20 23L23 16', s: 'ink', w: 2.5, f: 'none' }]),
  TappingSaddle: fit([{ d: 'M3 17H29V22H3Z', f: 'ink' }, { d: 'M8 17A8 8 0 0 1 24 17', s: 'ink', w: 2.5, f: 'none' }, { d: 'M14.5 4H17.5V10H14.5Z', f: 'ink' }]),
  RepairClamp: fit([{ d: RUN, f: 'ink' }, { d: 'M10 9H22V23H10Z', f: '#9aa3ab', s: 'ink', w: 1.5 }, { d: 'M13 9V23M16 9V23M19 9V23', s: 'ink', w: 1 }]),

  GateValve: dev(C.valve, [{ d: BOWTIE, f: 'ink' }], 'pipe'),
  ButterflyValve: dev(C.valve, [{ d: BOWTIE, f: 'none', s: 'ink', w: 2 }, { d: 'M16 7V25', s: 'ink', w: 2.5 }], 'pipe'),
  BallValve: dev(C.valve, [{ d: BOWTIE, f: 'none', s: 'ink', w: 2 }, { d: circle(16, 16, 3.5), f: 'ink' }], 'pipe'),
  CheckValve: dev(C.valve, [{ d: 'M8 10L20 16L8 22Z', f: 'ink' }, { d: 'M22.5 9V23', s: 'ink', w: 3 }], 'pipe'),
  PRV: controlValve('PR'),
  PSV: controlValve('PS'),
  FCV: controlValve('FC'),
  AltitudeValve: controlValve('AL'),
  AirValve: dev(C.valve, [{ d: 'M9 19L16 7L23 19Z', f: 'none', s: 'ink', w: 2 }, { d: 'M16 19V26', s: 'ink', w: 2.5 }, { t: 'A', x: 16, y: 17.5, size: 7 }], 'pipe'),
  Washout: dev(C.valve, [{ d: 'M16 6V18', s: 'ink', w: 2.5 }, { d: 'M10 16.5L16 25.5L22 16.5Z', f: 'ink' }], 'pipe'),
  BackflowPreventer: dev(C.valve, [{ d: 'M5 11L13 16L5 21Z M17 11L25 16L17 21Z', f: 'ink' }, { d: 'M14.5 10V22M26.5 10V22', s: 'ink', w: 2.5 }], 'pipe'),

  Hydrant: dev(C.hydrant, [{ d: 'M12 13H20V24H12Z M11 13A5 5 0 0 1 21 13Z M8 16H12V19.5H8Z M20 16H24V19.5H20Z M10 24H22V26.5H10Z', f: '#c8312b' }]),
  ServiceConnection: dev(C.service, [{ d: 'M8 16L16 9L24 16V24H8Z', f: 'none', s: 'ink', w: 2 }, { d: 'M14 18H18V24H14Z', f: 'ink' }]),
  ServiceValve: dev(C.service, [{ d: 'M8 13L16 17.5L8 22Z M24 13L16 17.5L24 22Z', f: 'ink' }, { d: 'M16 17V8M12 8H20', s: 'ink', w: 2 }], 'pipe'),
  CustomerMeter: dev(C.service, [{ d: circle(16, 16, 7.5), f: 'none', s: 'ink', w: 2 }, { t: 'm', x: 16, y: 19, size: 10 }]),
  SamplingPoint: dev(C.service, [{ d: 'M13 7H19V22A3 3 0 0 1 13 22Z', f: 'none', s: 'ink', w: 2 }, { d: 'M13 16H19V22A3 3 0 0 1 13 22Z', f: 'accent' }]),

  BulkMeter: dev(C.meter, [{ d: circle(16, 16, 8.5), f: 'none', s: 'ink', w: 2 }, { t: 'FM', x: 16, y: 18.6, size: 7.5 }], 'pipe'),
  PressureSensor: dev(C.meter, [{ d: 'M8 20.5A8.5 8.5 0 1 1 24 20.5', s: 'ink', w: 2, f: 'none' }, { d: 'M16 18L21 11', s: 'ink', w: 2.5 }, { d: circle(16, 18.5, 2.2), f: 'ink' }]),
  LevelSensor: dev(C.meter, [{ d: 'M7 22Q11.5 19 16 22T25 22', s: 'ink', w: 2, f: 'none' }, { d: 'M11 9H21L16 17Z', f: 'ink' }]),
  QualitySensor: dev(C.meter, [{ d: 'M16 6C16 6 9 14 9 19A7 7 0 0 0 23 19C23 14 16 6 16 6Z', f: 'none', s: 'ink', w: 2 }, { t: 'Cl', x: 16, y: 21.5, size: 7 }]),
  AcousticLogger: dev(C.meter, [{ d: circle(16, 16, 3), f: 'ink' }, { d: 'M11 11A7 7 0 0 0 11 21M21 11A7 7 0 0 1 21 21M8 8A11.5 11.5 0 0 0 8 24M24 8A11.5 11.5 0 0 1 24 24', s: 'ink', w: 2, f: 'none' }]),
  RTU: dev(C.meter, [{ d: 'M16 13V26M11 26H21', s: 'ink', w: 2.5 }, { d: 'M12.5 10A5 5 0 0 1 19.5 10M9.5 7A9 9 0 0 1 22.5 7', s: 'ink', w: 2, f: 'none' }, { d: circle(16, 13, 2), f: 'ink' }]),

  Pump: dev(C.plant, [{ d: circle(16, 16, 8.5), f: 'none', s: 'ink', w: 2 }, { d: 'M13 10.5L22.5 16L13 21.5Z', f: 'ink' }], 'pipe'),
  BoosterStation: dev(C.plant, [{ d: circle(14, 17, 7), f: 'none', s: 'ink', w: 2 }, { d: 'M11.5 12.5L19 17L11.5 21.5Z', f: 'ink' }, { d: 'M24 13V5M21 8L24 5L27 8', s: 'ink', w: 2, f: 'none' }], 'point', 'square'),
  PRVStation: dev(C.plant, [{ d: BOWTIE_LOW, f: 'ink' }, { t: 'PR', x: 16, y: 11.5, size: 8 }], 'pipe', 'square'),
  ChlorinationPoint: dev(C.plant, [{ d: 'M16 6L26 16L16 26L6 16Z', f: 'none', s: 'ink', w: 2 }, { t: 'Cl', x: 16, y: 18.6, size: 7.5 }]),
  Strainer: dev(C.plant, [{ d: 'M4 12.5H28V17H4Z', f: 'ink' }, { d: 'M14 17L20 25', s: 'ink', w: 3 }, { d: 'M17.5 27H24', s: 'ink', w: 2 }], 'pipe'),
  PumpStation: dev(C.plant, [{ d: 'M7 14L16 8L25 14V25H7Z', f: 'none', s: 'ink', w: 2 }, { d: circle(16, 19, 4), f: 'none', s: 'ink', w: 1.8 }, { d: 'M14.6 16.8L19 19L14.6 21.2Z', f: 'ink' }], 'point', 'square'),
  Reservoir: dev(C.plant, [{ d: 'M6 10H26V25H6Z', f: 'none', s: 'ink', w: 2 }, { d: 'M9 16Q12.5 14 16 16T23 16M9 20.5Q12.5 18.5 16 20.5T23 20.5', s: 'accent', w: 2, f: 'none' }], 'point', 'square'),
  Tank: dev(C.plant, [{ d: 'M10 12a6 5 0 1 0 12 0a6 5 0 1 0 -12 0', f: 'none', s: 'ink', w: 2 }, { d: 'M12.5 16.5L10 27M19.5 16.5L22 27M16 17V27', s: 'ink', w: 2 }], 'point', 'square'),
  Source: dev(C.plant, [{ d: 'M6 26V15L11 12V15L16 12V15L21 12V26Z', f: 'none', s: 'ink', w: 2 }, { d: 'M22 26H26V8H22', s: 'ink', w: 2, f: 'none' }], 'point', 'square'),

  // plant monitoring and control (ISA-style bubbles: letters name the measured variable)
  TurbidityMeter: dev(C.meter, [{ d: circle(16, 16, 9), f: 'none', s: 'ink', w: 2 }, { t: 'NTU', x: 16, y: 18.5, size: 7 }]),
  ChlorineAnalyser: dev(C.meter, [{ d: circle(16, 16, 9), f: 'none', s: 'ink', w: 2 }, { t: 'Cl₂', x: 16, y: 19, size: 8 }]),
  PHAnalyser: dev(C.meter, [{ d: circle(16, 16, 9), f: 'none', s: 'ink', w: 2 }, { t: 'pH', x: 16, y: 19, size: 9 }]),
  DPTransmitter: dev(C.meter, [{ d: circle(16, 16, 9), f: 'none', s: 'ink', w: 2 }, { t: 'ΔP', x: 16, y: 19, size: 9 }]),
  GasDetector: dev(C.hydrant, [{ d: 'M16 6L27 25H5Z', f: 'none', s: 'ink', w: 2 }, { t: 'Cl', x: 16, y: 22, size: 7.5 }]),
  CCTVCamera: dev(C.meter, [{ d: 'M6 12H20V21H6Z', f: 'ink' }, { d: 'M20 14.5L26 11V22L20 18.5Z', f: 'ink' }]),
  MotorisedValve: dev(C.valve, [{ d: BOWTIE_LOW, f: 'ink' }, { d: 'M16 20V10', s: 'ink', w: 2 }, { d: circle(16, 7, 4), f: 'none', s: 'ink', w: 2 }, { t: 'M', x: 16, y: 9.3, size: 5.5 }], 'pipe'),
  VerticalTurbinePump: dev(C.plant, [{ d: circle(16, 19, 7), f: 'none', s: 'ink', w: 2 }, { d: 'M13 15L20.5 19L13 23Z', f: 'ink' }, { d: 'M12 4H20V12H12Z', f: 'ink' }], 'pipe'),
  SubmersiblePump: dev(C.plant, [{ d: 'M5 9Q10.5 6 16 9T27 9', s: 'ink', w: 2, f: 'none' }, { d: circle(16, 19, 6.5), f: 'none', s: 'ink', w: 2 }, { d: 'M13.5 15.5L20 19L13.5 22.5Z', f: 'ink' }]),
  Blower: dev(C.plant, [{ d: circle(16, 16, 8.5), f: 'none', s: 'ink', w: 2 }, { d: 'M16 16L16 8.5M16 16L22.5 20M16 16L9.5 20', s: 'ink', w: 2.2 }]),
  Mixer: dev(C.plant, [{ d: 'M16 4V24', s: 'ink', w: 2 }, { d: 'M9 24H23', s: 'ink', w: 3 }, { d: 'M11 4H21V8H11Z', f: 'ink' }]),
  Flocculator: dev(C.plant, [{ d: 'M16 4V27', s: 'ink', w: 2 }, { d: 'M8 13H24M8 21H24', s: 'ink', w: 2.2 }, { d: 'M8 11V15M24 11V15M8 19V23M24 19V23', s: 'ink', w: 2.2 }]),
  LamellaSettler: dev(C.plant, [{ d: 'M5 7H27V26H5Z', f: 'none', s: 'ink', w: 2 }, { d: 'M8 22L14 12M13 22L19 12M18 22L24 12', s: 'ink', w: 1.8 }], 'point', 'square'),
  RapidSandFilter: dev(C.plant, [{ d: 'M5 7H27V26H5Z', f: 'none', s: 'ink', w: 2 }, { d: 'M7 18H25V24H7Z', f: 'accent' }, { d: 'M8 13Q12 11 16 13T24 13', s: 'ink', w: 1.8, f: 'none' }], 'point', 'square'),
  DosingPump: dev(C.plant, [{ d: circle(16, 16, 7.5), f: 'none', s: 'ink', w: 2 }, { d: 'M13 11.5L21 16L13 20.5Z', f: 'ink' }, { t: 'D', x: 16, y: 7.5, size: 6 }], 'pipe'),
  ChemicalTank: dev(C.plant, [{ d: 'M9 9H23V25H9Z', f: 'none', s: 'ink', w: 2 }, { d: 'M16 4V20M12 20H20', s: 'ink', w: 2 }, { d: 'M9 17H23V25H9Z', f: 'accent' }], 'point', 'square'),
  Chlorinator: dev(C.plant, [{ d: 'M8 6H24V26H8Z', f: 'none', s: 'ink', w: 2 }, { t: 'Cl₂', x: 16, y: 15, size: 7 }, { d: 'M12 19H20', s: 'ink', w: 2 }]),
  ChlorineContainer: dev(C.plant, [{ d: 'M8 11H24A5 5 0 0 1 24 21H8A5 5 0 0 1 8 11Z', f: '#e0b021', s: 'ink', w: 1.8 }, { t: 'Cl₂', x: 16, y: 19, size: 7 }]),
  Scrubber: dev(C.plant, [{ d: 'M11 5H21V27H11Z', f: 'none', s: 'ink', w: 2 }, { d: 'M11 12H21M11 19H21', s: 'ink', w: 1.5 }, { d: 'M14 8L18 10M14 15L18 17', s: 'ink', w: 1.2 }]),
  VFDPanel: dev(C.service, [{ d: 'M8 5H24V27H8Z', f: 'none', s: 'ink', w: 2 }, { d: 'M11 13Q13.5 9 16 13T21 13', s: 'ink', w: 1.8, f: 'none' }, { t: 'Hz', x: 16, y: 23, size: 7 }], 'point', 'square'),
  MCC: dev(C.service, [{ d: 'M5 6H27V26H5Z', f: 'none', s: 'ink', w: 2 }, { d: 'M12 6V26M20 6V26M5 13H27M5 20H27', s: 'ink', w: 1.4 }], 'point', 'square'),
  PLCPanel: dev(C.service, [{ d: 'M6 8H26V24H6Z', f: 'none', s: 'ink', w: 2 }, { d: 'M9 12H12V20H9ZM14 12H17V20H14ZM19 12H22V20H19Z', f: 'ink' }], 'point', 'square'),
  HMIPanel: dev(C.service, [{ d: 'M5 7H27V21H5Z', f: 'none', s: 'ink', w: 2 }, { d: 'M8 17L12 13L15 15L20 10L24 13', s: 'ink', w: 1.6, f: 'none' }, { d: 'M14 21V26H18V21', f: 'ink' }], 'point', 'square'),
  SCADAWorkstation: dev(C.service, [{ d: 'M3 8H15V18H3ZM17 8H29V18H17Z', f: 'none', s: 'ink', w: 1.8 }, { d: 'M6 24H26', s: 'ink', w: 2.4 }, { d: 'M9 18V24M23 18V24', s: 'ink', w: 1.6 }], 'point', 'square'),
  Transformer: dev(C.service, [{ d: circle(12, 16, 6.5), f: 'none', s: 'ink', w: 2 }, { d: circle(20, 16, 6.5), f: 'none', s: 'ink', w: 2 }]),
};

const FALLBACK = SYMBOLS.Junction as SymbolDef;
export const getSymbol = (code: string): SymbolDef => SYMBOLS[code] ?? FALLBACK;

const paint = (p: Paint | undefined, accent: string, fallback: string) =>
  p === undefined ? fallback : p === 'ink' ? INK : p === 'accent' ? accent : p === 'paper' ? PAPER : p;

// ---------- SVG (2D map icons, legends) ----------
export function symbolSVG(code: string, opts: { status?: Status; size?: number } = {}): string {
  const s = getSymbol(code), size = opts.size ?? 32, a = s.accent;
  const out: string[] = [];
  const ring = opts.status ? STATUS_HEX[opts.status] : null;
  if (s.shape === 'circle') {
    if (ring) out.push(`<circle cx="16" cy="16" r="15.2" fill="${ring}"/>`);
    out.push(`<circle cx="16" cy="16" r="${ring ? 13 : 14.6}" fill="${PAPER}" stroke="${a}" stroke-width="2"/>`);
  } else if (s.shape === 'square') {
    if (ring) out.push(`<rect x="0.8" y="0.8" width="30.4" height="30.4" rx="7" fill="${ring}"/>`);
    out.push(`<rect x="${ring ? 3 : 1.4}" y="${ring ? 3 : 1.4}" width="${ring ? 26 : 29.2}" height="${ring ? 26 : 29.2}" rx="6" fill="${PAPER}" stroke="${a}" stroke-width="2"/>`);
  }
  const halo = s.shape === 'none';
  for (const p of s.prims) {
    if ('t' in p) { out.push(`<text x="${p.x}" y="${p.y}" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${p.size}" text-anchor="middle" fill="${paint(p.f, a, INK)}">${p.t}</text>`); continue; }
    const fill = paint(p.f, a, 'none'), stroke = paint(p.s, a, 'none'), w = p.w ?? 0;
    if (halo) out.push(`<path d="${p.d}" fill="${fill === 'none' ? 'none' : PAPER}" stroke="${PAPER}" stroke-width="${w + 3.5}" stroke-linejoin="round" stroke-linecap="round"/>`);
    out.push(`<path d="${p.d}" fill="${fill}" stroke="${stroke}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">${out.join('')}</svg>`;
}

// ---------- canvas (flat mode textures, MapLibre addImage) ----------
export function drawSymbol(ctx: CanvasRenderingContext2D, code: string, px: number, status?: Status) {
  const s = getSymbol(code), a = s.accent, k = px / 32;
  ctx.save(); ctx.scale(k, k); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const ring = status ? STATUS_HEX[status] : null;
  const shape = (inset: number, r: number) => {
    const p = new Path2D();
    if (s.shape === 'circle') p.arc(16, 16, 16 - inset, 0, Math.PI * 2);
    else p.roundRect(inset, inset, 32 - 2 * inset, 32 - 2 * inset, r);
    return p;
  };
  if (s.shape !== 'none') {
    if (ring) { ctx.fillStyle = ring; ctx.fill(shape(0.8, 7)); }
    const b = shape(ring ? 3 : 1.4, 6);
    ctx.fillStyle = PAPER; ctx.fill(b); ctx.strokeStyle = a; ctx.lineWidth = 2; ctx.stroke(b);
  }
  const halo = s.shape === 'none';
  for (const p of s.prims) {
    if ('t' in p) {
      ctx.fillStyle = paint(p.f, a, INK); ctx.font = `700 ${p.size}px Arial, Helvetica, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText(p.t, p.x, p.y); continue;
    }
    const path = new Path2D(p.d), fill = paint(p.f, a, 'none'), stroke = paint(p.s, a, 'none'), w = p.w ?? 0;
    if (halo) {
      ctx.strokeStyle = PAPER; ctx.lineWidth = w + 3.5; ctx.stroke(path);
      if (fill !== 'none') { ctx.fillStyle = PAPER; ctx.fill(path); }
    }
    if (fill !== 'none') { ctx.fillStyle = fill; ctx.fill(path); }
    if (stroke !== 'none' && w > 0) { ctx.strokeStyle = stroke; ctx.lineWidth = w; ctx.stroke(path); }
  }
  ctx.restore();
}

/** RGBA pixels, e.g. for maplibre `map.addImage(code, symbolImageData(code))`. */
export function symbolImageData(code: string, px = 64, status?: Status): ImageData {
  const cv = document.createElement('canvas'); cv.width = cv.height = px;
  const ctx = cv.getContext('2d')!; drawSymbol(ctx, code, px, status);
  return ctx.getImageData(0, 0, px, px);
}

// ---------- map symbols: drawn into the network, not as round icons ----------
// In-line parts (valves, meters, reducers, couplings…) are glyphs ON the pipe: a light body with a dark
// casing, turned to the pipe, sized to the pipe width, so the line runs into them like a schematic. A
// closed or alarmed part fills with its state colour. Point assets (sensors, hydrants, facilities) are
// compact solid badges in their family colour with a white glyph and a status ring.

/** How a code is drawn on the map. */
export type MapSymbolKind = 'inline' | 'badge';
export const mapSymbolKind = (code: string): MapSymbolKind => (getSymbol(code).align === 'pipe' ? 'inline' : 'badge');

const CASE = '#0c1319';
const BODY = '#f4f7fa';
const BOWTIE_S = 'M10 12L16 16L10 20Z M22 12L16 16L22 20Z';
/** Inline glyphs on the 32-grid, pipe axis at y = 16. f/s 'ink' = the body colour, 'paper' = the casing colour. */
const INLINE: Record<string, Prim[]> = {
  GateValve: [{ d: BOWTIE, f: 'ink' }],
  ButterflyValve: [{ d: BOWTIE, f: 'ink' }, { d: 'M16 8.5V23.5', s: 'paper', w: 2.2 }],
  BallValve: [{ d: BOWTIE, f: 'ink' }, { d: circle(16, 16, 3.4), f: 'paper' }],
  CheckValve: [{ d: 'M8 10L21 16L8 22Z', f: 'ink' }, { d: 'M23 9.5V22.5', s: 'ink', w: 2.6 }],
  PRV: [{ d: BOWTIE, f: 'ink' }, { d: 'M16 16V9', s: 'ink', w: 2 }, { d: 'M12.5 3.5H19.5V9.5H12.5Z', f: 'ink' }],
  PSV: [{ d: BOWTIE, f: 'ink' }, { d: 'M16 16V9', s: 'ink', w: 2 }, { d: circle(16, 6.2, 3.4), f: 'ink' }],
  FCV: [{ d: BOWTIE, f: 'ink' }, { d: 'M16 16V9', s: 'ink', w: 2 }, { d: 'M16 2.4L20 6.4L16 10.4L12 6.4Z', f: 'ink' }],
  AltitudeValve: [{ d: BOWTIE, f: 'ink' }, { d: 'M16 16V9.5', s: 'ink', w: 2 }, { d: 'M12 9.5L16 2.5L20 9.5Z', f: 'ink' }],
  BackflowPreventer: [{ d: 'M5 11L13 16L5 21Z M17 11L25 16L17 21Z', f: 'ink' }, { d: 'M14.5 10V22M26.5 10V22', s: 'ink', w: 2.4 }],
  ServiceValve: [{ d: BOWTIE_S, f: 'ink' }],
  AirValve: [{ d: 'M16 16V10', s: 'ink', w: 2.2 }, { d: circle(16, 7, 4.2), f: 'ink' }, { d: 'M14.2 7.6L16 4.6L17.8 7.6', s: 'paper', w: 1.4, f: 'none' }],
  Washout: [{ d: 'M16 16V22', s: 'ink', w: 2.2 }, { d: 'M11 21L16 28L21 21Z', f: 'ink' }],
  BulkMeter: [{ d: 'M8 10.5H24V21.5H8Z', f: 'ink' }, { d: 'M11 16H20M17.5 13.2L21 16L17.5 18.8', s: 'paper', w: 1.8, f: 'none' }],
  Strainer: [{ d: 'M9 12.5H23V19.5H9Z', f: 'ink' }, { d: 'M17 19.5L22 26', s: 'ink', w: 2.6 }, { d: 'M12 14.5L14 17.5M15 14.5L17 17.5M18 14.5L20 17.5', s: 'paper', w: 1.1, f: 'none' }],
  Pump: [{ d: circle(16, 16, 7.5), f: 'ink' }, { d: 'M13.2 11.8L21 16L13.2 20.2Z', f: 'paper' }],
  PRVStation: [{ d: 'M6.5 6.5H25.5V25.5H6.5Z', f: 'paper', s: 'ink', w: 1.8 }, { d: BOWTIE_S, f: 'ink' }],
  Reducer: [{ d: 'M6 10.5L26 13.5V18.5L6 21.5Z', f: 'ink' }],
  Cap: [{ d: 'M17.5 8.5H22.5V23.5H17.5Z', f: 'ink' }],
  Coupling: [{ d: 'M11.5 11H20.5V21H11.5Z', f: 'ink' }],
  DismantlingJoint: [{ d: 'M9 9.5H12.5V22.5H9Z M19.5 9.5H23V22.5H19.5Z', f: 'ink' }, { d: 'M12.5 12H19.5M12.5 20H19.5', s: 'ink', w: 1.6 }],
  Transition: [{ d: 'M9 11.5H16V20.5H9Z', f: 'ink' }, { d: 'M16 10H23V22H16Z', f: 'paper', s: 'ink', w: 1.6 }],
  ExpansionJoint: [{ d: 'M8 16L10.5 10.5L14 21.5L17.5 10.5L21 21.5L24 16', s: 'ink', w: 2.4, f: 'none' }],
  RepairClamp: [{ d: 'M10.5 10H21.5V22H10.5Z', f: 'ink' }, { d: 'M14 10V22M18 10V22', s: 'paper', w: 1.2 }],
  TappingSaddle: [{ d: 'M9 18A7 7 0 0 1 23 18', s: 'ink', w: 2.4, f: 'none' }, { d: 'M14.5 5H17.5V12H14.5Z', f: 'ink' }],
  Tee: [{ d: circle(16, 16, 3), f: 'ink' }],
  ReducingTee: [{ d: circle(16, 16, 3), f: 'ink' }],
  Cross: [{ d: circle(16, 16, 3), f: 'ink' }],
  Bend: [{ d: circle(16, 16, 2.6), f: 'ink' }],
  Junction: [{ d: circle(16, 16, 3), f: 'ink' }],
  Pipe: [],
};

/** Map symbol SVG: in-line glyph on the pipe, or a solid badge for point assets. */
export function mapSymbolSVG(code: string, opts: { status?: Status; size?: number } = {}): string {
  const s = getSymbol(code), size = opts.size ?? 32;
  const out: string[] = [];
  const state = opts.status && opts.status !== 'normal' ? STATUS_HEX[opts.status] : null;
  if (mapSymbolKind(code) === 'inline') {
    const prims = (INLINE[code] ?? s.prims).filter((p): p is Exclude<Prim, { t: string }> => !('t' in p));
    const body = state ?? BODY;
    const col = (p: Paint | undefined) => (p === undefined || p === 'none' ? 'none' : p === 'paper' ? CASE : body);
    // casing first (all parts), then the bodies, so touching parts read as one glyph
    for (const p of prims) {
      const w = p.w ?? 0;
      const filled = p.f !== undefined && p.f !== 'none';
      out.push(`<path d="${p.d}" fill="${filled ? CASE : 'none'}" stroke="${CASE}" stroke-width="${w + 3.2}" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
    for (const p of prims) {
      out.push(`<path d="${p.d}" fill="${col(p.f)}" stroke="${col(p.s)}" stroke-width="${p.w ?? 0}" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
  } else {
    const a = s.accent;
    const ring = opts.status ? STATUS_HEX[opts.status] : null;
    const square = s.shape === 'square';
    const shapeAt = (inset: number, fill: string, stroke = 'none', sw = 0) =>
      square
        ? `<rect x="${inset}" y="${inset}" width="${32 - 2 * inset}" height="${32 - 2 * inset}" rx="${7 - inset / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
        : `<circle cx="16" cy="16" r="${16 - inset}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    out.push(shapeAt(0.6, CASE));
    if (ring) out.push(shapeAt(1.6, ring));
    out.push(shapeAt(ring ? 4 : 2, a, BODY, 1.6));
    // glyph in white, shrunk a little to sit inside the badge
    out.push('<g transform="translate(16 16) scale(0.74) translate(-16 -16)">');
    const light = (p: Paint | undefined, fallback: string) => (p === undefined ? fallback : p === 'none' ? 'none' : p === 'paper' ? a : BODY);
    for (const p of s.prims) {
      if ('t' in p) {
        out.push(`<text x="${p.x}" y="${p.y}" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${p.size}" text-anchor="middle" fill="${BODY}">${p.t}</text>`);
        continue;
      }
      out.push(`<path d="${p.d}" fill="${light(p.f, 'none')}" stroke="${light(p.s, 'none')}" stroke-width="${(p.w ?? 0) * 1.15}" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
    out.push('</g>');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">${out.join('')}</svg>`;
}
