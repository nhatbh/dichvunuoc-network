/**
 * Operations API (`/api/ops/*`) types. The schemas live in `@wn/contracts/ops` (contract-first:
 * the BFF, the demo MSW handlers and the screens share them); this module re-exports the types
 * under the names the app uses.
 */
export type {
  MarkerAction,
  MarkerKind,
  MarkerState,
  OpsAlarm,
  OpsDmaBalance,
  OpsEvent,
  OpsMarker,
  OpsNetworkDay,
  OpsPlanHour,
  OpsProduction,
  OpsSensor,
  OpsSeries,
  OpsStatus,
  SensorKind,
} from '@wn/contracts/ops'
export { SLOTS_PER_DAY } from '@wn/contracts/ops'
import { SLOTS_PER_DAY } from '@wn/contracts/ops'

export const slotLabel = (slot: number): string => {
  const m = Math.max(0, Math.min(SLOTS_PER_DAY, slot)) * 15
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
