import type { Coordinate, ImageSpec } from '@wn/map-runtime';
import { parseColor } from './color.js';
import type { PreparedLayer } from '../layers/prepare-layer.js';
import type { InteractionContext } from './interaction.js';

export const parseHex = (c: string): [number, number, number, number] => parseColor(c);

/** Add a screen-sized marker (e.g. a handle or sketch vertex) to an overlay. */
export function pushDot(ctx: Pick<InteractionContext, 'atlas'>, out: PreparedLayer, c: Coordinate, im: ImageSpec, z = 0): void {
  const { key, entry } = ctx.atlas.get(im, 1);
  out.points.push({ fid: '', position: [c.lon, c.lat, z], iconKey: key, iconSize: entry.size });
}
