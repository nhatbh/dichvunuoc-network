export type RGBA = [number, number, number, number];

const NAMED: Record<string, RGBA> = {
  white: [255, 255, 255, 255],
  black: [0, 0, 0, 255],
  red: [255, 0, 0, 255],
  transparent: [0, 0, 0, 0],
};

const cache = new Map<string, RGBA>();

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/**
 * Parse a CSS colour string (#rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl(),
 * hsla(), a few names) into a deck.gl [r,g,b,a] 0–255 tuple. Unknown input yields
 * opaque slate so a bad colour is visible rather than invisible.
 */
export function parseColor(input: string | undefined | null, opacity = 1): RGBA {
  const key = `${input ?? ''}|${opacity}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const base = parseBase(input);
  const out: RGBA = [base[0], base[1], base[2], Math.round(clamp(base[3] * clamp(opacity, 0, 1), 0, 255))];
  if (cache.size > 2000) cache.clear();
  cache.set(key, out);
  return out;
}

function parseBase(input: string | undefined | null): RGBA {
  if (!input) return [100, 116, 139, 255];
  const s = input.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s]!;
  if (s.startsWith('#')) {
    const h = s.slice(1);
    const full = h.length === 3 || h.length === 4 ? h.split('').map((c) => c + c).join('') : h;
    if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(full)) {
      const n = parseInt(full.slice(0, 6), 16);
      const a = full.length === 8 ? parseInt(full.slice(6, 8), 16) : 255;
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
    }
  }
  const m = s.match(/^(rgba?|hsla?)\(([^)]+)\)$/);
  if (m) {
    const parts = m[2]!.split(/[\s,/]+/).filter(Boolean);
    const num = (v: string | undefined, scale = 1): number => {
      if (v === undefined) return NaN;
      return v.endsWith('%') ? (parseFloat(v) / 100) * scale : parseFloat(v);
    };
    const alpha = parts[3] === undefined ? 1 : clamp(num(parts[3], 1), 0, 1);
    if (m[1]!.startsWith('rgb')) {
      const [r, g, b] = [num(parts[0], 255), num(parts[1], 255), num(parts[2], 255)];
      if ([r, g, b].every(Number.isFinite)) return [clamp(Math.round(r), 0, 255), clamp(Math.round(g), 0, 255), clamp(Math.round(b), 0, 255), Math.round(alpha * 255)];
    } else {
      const h = parseFloat(parts[0] ?? '');
      const sat = num(parts[1], 1) / (parts[1]?.endsWith('%') ? 1 : 100);
      const lig = num(parts[2], 1) / (parts[2]?.endsWith('%') ? 1 : 100);
      if ([h, sat, lig].every(Number.isFinite)) {
        const [r, g, b] = hslToRgb(((h % 360) + 360) % 360, clamp(sat, 0, 1), clamp(lig, 0, 1));
        return [r, g, b, Math.round(alpha * 255)];
      }
    }
  }
  return [100, 116, 139, 255];
}
