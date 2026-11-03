import type { FeatureStyle, StyleSpec } from '@wn/map-runtime';
import type { FeatureStyle3D } from '../port/map-engine-3d-port.js';

/** Kind → colour used when no StyleSpec is registered (mirrors the 2D engine). */
export const KIND_COLORS: Record<string, string> = {
  pipe: '#0284c7',
  node: '#16a34a',
  facility: '#d97706',
  component: '#7c3aed',
};
const HIGHLIGHT = '#ef4444';

/** The built-in kind style: same colours, widths and radii as the 2D engine. */
export function styleForKind(kind: string, selected: boolean, draft: boolean): FeatureStyle {
  const color = selected ? HIGHLIGHT : (KIND_COLORS[kind] ?? '#64748b');
  return {
    stroke: { color, width: selected ? 5 : 3, dash: draft ? [6, 6] : undefined },
    fill: `${color}${draft ? '22' : '33'}`,
    image: {
      shape: 'circle',
      radius: selected ? 7 : 5,
      color,
      stroke: draft ? '#f59e0b' : '#ffffff',
      strokeWidth: draft ? 2 : 1,
    },
  };
}

/** Resolve the style for one feature, exactly like the 2D adapter's `#applyLayerStyle`. */
export function resolveFeatureStyle(
  spec: StyleSpec | undefined,
  properties: Record<string, unknown>,
  selected: boolean,
  isDraft: boolean,
): FeatureStyle3D {
  const kind = String(properties['kind'] ?? 'component');
  if (!spec) return styleForKind(kind, selected, isDraft);
  const resolved = spec({ ...properties, __selected: selected });
  return (resolved ?? styleForKind(kind, selected, isDraft)) as FeatureStyle3D;
}
