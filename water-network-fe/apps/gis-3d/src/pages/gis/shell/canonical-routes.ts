import type { OpsSource } from '@/shared/config/runtime-config'
import { OPS_ROUTES } from './nav'

/** The screens that run on the live (canonical) network; the rest show a placeholder. */
export function canonicalRoutes(opsSource: OpsSource): ReadonlySet<string> {
  return new Set([
    'dashboard',
    'map',
    'layers',
    'query',
    'assets',
    'import',
    // the SYSTEM 3D editor and the review of its design revisions (design-be, BFF /editor/*)
    'editor',
    'versions',
    // trace and valve isolation from topology-rs (BFF /topology/*, decision 0029)
    'trace',
    // the operations screens run on the canonical network once /ops is live
    ...(opsSource === 'live' ? OPS_ROUTES : []),
  ])
}
