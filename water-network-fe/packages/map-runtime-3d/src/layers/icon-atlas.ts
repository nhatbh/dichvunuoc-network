import type { ImageSpec } from '@wn/map-runtime';
import { parseColor, type RGBA } from '../core/color.js';

export interface IconEntry {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rendered size in CSS px (what `getSize` should be). */
  size: number;
}

const SCALE = 2; // atlas cells are drawn at 2× for crisp icons on hi-dpi screens
const PAD = 2;

export const iconKey = (im: ImageSpec, opacity: number): string =>
  [im.shape, im.radius, im.color, im.stroke ?? '#ffffff', im.strokeWidth ?? 1, opacity].join('|');

const css = (c: RGBA): string => `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;

/** Draw one marker (circle / square / diamond) centred in a `px`×`px` cell at SCALE×. */
export function drawMarker(ctx: CanvasRenderingContext2D, im: ImageSpec, opacity: number, ox: number, oy: number, px: number): void {
  const c = (px * SCALE) / 2;
  const r = im.radius * SCALE;
  const sw = (im.strokeWidth ?? 1) * SCALE;
  ctx.save();
  ctx.translate(ox * SCALE + c, oy * SCALE + c);
  ctx.beginPath();
  if (im.shape === 'circle') {
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  } else if (im.shape === 'diamond') {
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r, 0);
    ctx.closePath();
  } else {
    const h = r / Math.SQRT2;
    ctx.rect(-h, -h, h * 2, h * 2);
  }
  ctx.fillStyle = css(parseColor(im.color, opacity));
  ctx.fill();
  if (sw > 0) {
    ctx.lineWidth = sw;
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = css(parseColor(im.stroke ?? '#ffffff', opacity));
    ctx.stroke();
  }
  ctx.restore();
}

export interface AtlasSnapshot {
  /** A new object every time the atlas changes (deck re-uploads the texture on identity change). */
  canvas: HTMLCanvasElement | null;
  mapping: Record<string, { x: number; y: number; width: number; height: number; mask: boolean }>;
  version: number;
}

/**
 * Dynamic shelf-packed icon atlas keyed by marker style. Marker count is small
 * (tens of unique shape/colour combinations) so the whole canvas is rebuilt when a
 * new style appears. Without a 2D canvas (jsdom) it returns mappings but no pixels.
 */
export class IconAtlas {
  #entries = new Map<string, { im: ImageSpec; opacity: number; entry: IconEntry }>();
  #snapshot: AtlasSnapshot = { canvas: null, mapping: {}, version: 0 };
  #dirty = false;

  /** Register (or fetch) the icon for a marker style. */
  get(im: ImageSpec, opacity: number): { key: string; entry: IconEntry } {
    const key = iconKey(im, opacity);
    let rec = this.#entries.get(key);
    if (!rec) {
      const size = Math.ceil(2 * (im.radius + (im.strokeWidth ?? 1) / 2)) + PAD * 2;
      rec = { im, opacity, entry: { x: 0, y: 0, width: size * SCALE, height: size * SCALE, size } };
      this.#entries.set(key, rec);
      this.#dirty = true;
    }
    return { key, entry: rec.entry };
  }

  snapshot(): AtlasSnapshot {
    if (!this.#dirty) return this.#snapshot;
    this.#dirty = false;
    const recs = [...this.#entries.entries()];
    // shelf packing, widest atlas 2048 device px
    const maxW = 2048;
    let x = 0;
    let y = 0;
    let shelf = 0;
    for (const [, r] of recs) {
      if (x + r.entry.width > maxW) {
        x = 0;
        y += shelf;
        shelf = 0;
      }
      r.entry.x = x;
      r.entry.y = y;
      x += r.entry.width;
      shelf = Math.max(shelf, r.entry.height);
    }
    const height = y + shelf;
    const width = Math.min(maxW, Math.max(1, recs.reduce((m, [, r]) => Math.max(m, r.entry.x + r.entry.width), 1)));
    const mapping: AtlasSnapshot['mapping'] = {};
    for (const [key, r] of recs) mapping[key] = { x: r.entry.x, y: r.entry.y, width: r.entry.width, height: r.entry.height, mask: false };
    let canvas: HTMLCanvasElement | null = null;
    if (typeof document !== 'undefined') {
      const cv = document.createElement('canvas');
      cv.width = width;
      cv.height = Math.max(1, height);
      const ctx = cv.getContext('2d');
      if (ctx) {
        for (const [, r] of recs) drawMarker(ctx, r.im, r.opacity, r.entry.x / SCALE, r.entry.y / SCALE, r.entry.size);
        canvas = cv;
      }
    }
    this.#snapshot = { canvas, mapping, version: this.#snapshot.version + 1 };
    return this.#snapshot;
  }
}
