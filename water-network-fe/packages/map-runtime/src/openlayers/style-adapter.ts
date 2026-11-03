import { Style, Fill, Stroke, Circle as CircleStyle, RegularShape, Text } from 'ol/style';
import type { NetworkFeatureKind } from '@wn/contracts/map-features';
import type { FeatureStyle } from '../port/types.js';

export const KIND_COLORS: Record<NetworkFeatureKind, string> = {
  pipe: '#0284c7',
  node: '#16a34a',
  facility: '#d97706',
  component: '#7c3aed',
};

const HIGHLIGHT = '#ef4444';

export function styleForKind(kind: NetworkFeatureKind, selected: boolean, draft = false): Style {
  const color = selected ? HIGHLIGHT : (KIND_COLORS[kind] ?? '#64748b');
  const width = selected ? 5 : 3;
  return new Style({
    stroke: new Stroke({ color, width, lineDash: draft ? [6, 6] : undefined }),
    fill: new Fill({ color: `${color}${draft ? '22' : '33'}` }),
    image: new CircleStyle({
      radius: selected ? 7 : 5,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: draft ? '#f59e0b' : '#ffffff', width: draft ? 2 : 1 }),
    }),
  });
}

/** Apply an alpha multiplier to a hex/rgb(a) color → rgba() string. */
function withOpacity(color: string, alpha: number): string {
  if (alpha >= 1) return color;
  const a = Math.max(0, Math.min(1, alpha));
  if (color.startsWith('#')) {
    const h = color.slice(1);
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full.slice(0, 6), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const m = color.match(/^rgba?\(([^)]+)\)/);
  if (m && m[1]) {
    const parts = m[1].split(',').map((s) => s.trim());
    const [r, g, b] = parts;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return color;
}

/**
 * Translate a PLAIN {@link FeatureStyle} (no `ol`) into one or more `ol/style`
 * Style objects. A `halo` becomes an extra Style drawn UNDER the main one.
 * Diamonds = a 4-point RegularShape (square) rotated 45°.
 */
export function buildStyle(spec: FeatureStyle): Style[] {
  const op = spec.opacity ?? 1;
  const out: Style[] = [];

  if (spec.halo) {
    out.push(
      new Style({
        stroke: new Stroke({
          color: withOpacity(spec.halo.color, op),
          width: spec.halo.width ?? 2,
          lineDash: spec.halo.dash,
        }),
        zIndex: -1,
      }),
    );
  }

  const main = new Style();
  if (spec.stroke) {
    main.setStroke(
      new Stroke({
        color: withOpacity(spec.stroke.color, op),
        width: spec.stroke.width ?? 2,
        lineDash: spec.stroke.dash,
        lineCap: 'round',
        lineJoin: 'round',
      }),
    );
  }
  if (spec.fill) main.setFill(new Fill({ color: withOpacity(spec.fill, op) }));
  if (spec.image) {
    const im = spec.image;
    const fill = new Fill({ color: withOpacity(im.color, op) });
    const stroke = new Stroke({
      color: withOpacity(im.stroke ?? '#ffffff', op),
      width: im.strokeWidth ?? 1,
    });
    if (im.shape === 'circle') {
      main.setImage(new CircleStyle({ radius: im.radius, fill, stroke }));
    } else if (im.shape === 'square') {
      main.setImage(new RegularShape({ points: 4, radius: im.radius, angle: 0, fill, stroke }));
    } else {
      // diamond = square rotated 45°
      main.setImage(
        new RegularShape({ points: 4, radius: im.radius, angle: Math.PI / 4, fill, stroke }),
      );
    }
  }
  if (spec.text) {
    const text = spec.text;
    main.setText(new Text({
      text: text.value,
      font: text.font ?? '12px sans-serif',
      offsetY: text.offsetY ?? 0,
      textAlign: 'center',
      textBaseline: 'middle',
      fill: new Fill({ color: withOpacity(text.color ?? '#0f172a', op) }),
      stroke: text.stroke
        ? new Stroke({ color: withOpacity(text.stroke, op), width: text.strokeWidth ?? 2 })
        : undefined,
    }));
  }
  out.push(main);
  return out;
}
