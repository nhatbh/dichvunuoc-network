/* GIS — Biên tập: pure mapping from a ContextMenuEvent to an ActionTarget.
   Extracted for testability — no side effects, no imports from SolidJS or OL. */
import type { Hit, Pt } from './model';
import type { ActionTarget } from './actions';

export interface ContextMenuEventLike {
  featureId: string | null;
}

/**
 * Maps a right-click event to an ActionTarget, given the current hit resolver and multiSel.
 * Pure function — safe to unit-test without DOM or map runtime.
 *
 * Rules (in priority order):
 *  1. featureId present → resolve hit (a member of a multi-selection → { kind:'multi' }):
 *     - hit is a pipe (draft kind=pipe or base type=pipe) → { kind:'pipe', hit }
 *     - otherwise                                         → { kind:'point', hit }
 *     - hit not found                                     → { kind:'empty', pt: clickPt }
 *  2. featureId absent + multiSel.length > 0             → { kind:'multi', ids: multiSel }
 *  3. otherwise                                           → { kind:'empty', pt: clickPt }
 */
export function buildContextTarget(
  ev: ContextMenuEventLike,
  clickPt: Pt,
  multiSel: string[],
  hitFor: (id: string) => Hit | null,
): ActionTarget {
  if (ev.featureId) {
    const hit = hitFor(ev.featureId);
    // right-click on a member of the current multi-selection acts on the whole selection
    if (hit && multiSel.length > 1 && multiSel.includes(hit.kind === 'draft' ? hit.f.id : 'base:' + hit.base.id)) {
      return { kind: 'multi', ids: multiSel };
    }
    if (hit) {
      const isPipe =
        hit.kind === 'draft' ? hit.f.kind === 'pipe' : hit.base.type === 'pipe';
      return isPipe ? { kind: 'pipe', hit } : { kind: 'point', hit };
    }
    return { kind: 'empty', pt: clickPt };
  }
  if (multiSel.length > 0) return { kind: 'multi', ids: multiSel };
  return { kind: 'empty', pt: clickPt };
}
