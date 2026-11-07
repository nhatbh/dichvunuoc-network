/**
 * Typed client for the operations API (`/api/ops/*`). Every response is checked against the
 * `@wn/contracts/ops` schemas, so a server (or mock) that drifts from the contract fails loudly
 * at the boundary instead of somewhere inside a chart. The large per-day bodies (readings,
 * network state) are checked in development and tests only.
 */
import {
  CreateMarkerRequest,
  OPS_ROUTES,
  OpsAlarmsResponse,
  OpsDmaBalanceResponse,
  OpsEventsResponse,
  OpsMarker,
  OpsMarkersResponse,
  OpsNetworkDay,
  OpsProduction,
  OpsReadingsResponse,
  OpsSensorsResponse,
  SavePlanRequest,
  UpdateMarkerRequest,
} from '@wn/contracts/ops'
import { httpClient } from './http-client'
import type { z } from 'zod'

const DEV = import.meta.env.DEV || import.meta.env.MODE === 'test'

const check = <S extends z.ZodTypeAny>(schema: S, body: unknown, route: string): z.infer<S> => {
  const r = schema.safeParse(body)
  if (!r.success) throw new Error(`${route}: response does not match the contract — ${r.error.issues[0]?.path.join('.')}: ${r.error.issues[0]?.message}`)
  return r.data as z.infer<S>
}
/** Large bodies: checked in development and tests, trusted in production builds. */
const checkDev = <S extends z.ZodTypeAny>(schema: S, body: unknown, route: string): z.infer<S> =>
  DEV ? check(schema, body, route) : (body as z.infer<S>)

export const opsApi = {
  sensors: async () => check(OpsSensorsResponse, await httpClient.get(OPS_ROUTES.sensors), OPS_ROUTES.sensors),
  readings: async () => checkDev(OpsReadingsResponse, await httpClient.get(OPS_ROUTES.readings), OPS_ROUTES.readings),
  events: async () => check(OpsEventsResponse, await httpClient.get(OPS_ROUTES.events), OPS_ROUTES.events).events,
  alarms: async () => check(OpsAlarmsResponse, await httpClient.get(OPS_ROUTES.alarms), OPS_ROUTES.alarms).alarms,
  markers: async () => check(OpsMarkersResponse, await httpClient.get(OPS_ROUTES.markers), OPS_ROUTES.markers).markers,
  dmaBalance: async () => check(OpsDmaBalanceResponse, await httpClient.get(OPS_ROUTES.dmaBalance), OPS_ROUTES.dmaBalance).dmas,
  production: async () => check(OpsProduction, await httpClient.get(OPS_ROUTES.production), OPS_ROUTES.production),
  networkState: async () => checkDev(OpsNetworkDay, await httpClient.get(OPS_ROUTES.networkState), OPS_ROUTES.networkState),
  createMarker: async (req: CreateMarkerRequest) =>
    check(OpsMarker, await httpClient.post(OPS_ROUTES.markers, CreateMarkerRequest.parse(req)), OPS_ROUTES.markers),
  updateMarker: async (id: string, req: UpdateMarkerRequest) =>
    check(OpsMarker, await httpClient.patch(OPS_ROUTES.marker(id), UpdateMarkerRequest.parse(req)), OPS_ROUTES.marker(id)),
  savePlan: async (req: SavePlanRequest) => httpClient.put<unknown>(OPS_ROUTES.productionPlan, SavePlanRequest.parse(req)),
}
