import { z } from 'zod';

/**
 * Operations API (`<api base>/ops/*` on the platform BFF): sensors, readings, alarms, leak and
 * maintenance markers, DMA balance and production planning.
 *
 * Contract-first: these schemas are the source of truth for the BFF routes, the demo MSW
 * handlers and the gis-3d screens. Times inside a day are 15-minute slots (0 = 00:00,
 * 95 = 23:45); hours are 0–23. Positions are GIS plane coordinates, like every other asset.
 */

export const SLOTS_PER_DAY = 96;
export const SLOT_MINUTES = 15;

const Slot = z.number().int().min(0).max(SLOTS_PER_DAY - 1);
const Hourly = z.array(z.number()).length(24);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Iso = z.string().min(1);

export const OpsStatus = z.enum(['normal', 'warning', 'critical', 'offline']);
export type OpsStatus = z.infer<typeof OpsStatus>;

export const SensorKind = z.enum(['pressure', 'flow', 'level']);
export type SensorKind = z.infer<typeof SensorKind>;

/**
 * Where a reading comes from (decision 3 of the integration plan): our own loggers and plant
 * SCADA, a customer's meters, or a third party. Readings from untrusted sources never raise a
 * critical alarm on their own.
 */
export const DataSourceKind = z.enum(['own', 'customer', 'third_party']);
export type DataSourceKind = z.infer<typeof DataSourceKind>;

export const OpsSensor = z.object({
  id: z.string(),
  name: z.string(),
  kind: SensorKind,
  /** Catalog code of the device (PressureSensor, BulkMeter, LevelSensor). */
  deviceType: z.string(),
  dma: z.string().optional(),
  unit: z.string(),
  x: z.number(),
  y: z.number(),
  hostPipeId: z.string().optional(),
  hostNodeId: z.string().optional(),
  /** Service minimum / pipe maximum (pressure, level). */
  low: z.number().optional(),
  high: z.number().optional(),
  /** DMA inlet meter; `main` = the DMA's metered main inlet. */
  inlet: z.boolean().optional(),
  main: z.boolean().optional(),
  /** Plant outlet meter / logger. */
  plant: z.boolean().optional(),
  /** Critical-point logger (high point, end of line). */
  critical: z.boolean().optional(),
  /** Data source; absent = own. */
  source: DataSourceKind.optional(),
});
export type OpsSensor = z.infer<typeof OpsSensor>;

export const OpsSeries = z.object({
  sensorId: z.string(),
  unit: z.string(),
  intervalMin: z.number().int().positive(),
  /** ISO time of slot 0. */
  start: Iso,
  /** Readings; shorter than 96 when the sensor stopped reporting. */
  values: z.array(z.number()).max(SLOTS_PER_DAY),
  /** Baseline band per slot (p50 = the expected reading). Absent while no baseline exists. */
  p10: z.array(z.number()).optional(),
  p50: z.array(z.number()).optional(),
  p90: z.array(z.number()).optional(),
  yesterday: z.array(z.number()).optional(),
  low: z.number().optional(),
  high: z.number().optional(),
});
export type OpsSeries = z.infer<typeof OpsSeries>;

export const OpsEvent = z.object({
  id: z.string(),
  kind: z.enum(['burst', 'background']),
  dma: z.string(),
  /** Node where the water is lost. */
  nodeId: z.string(),
  x: z.number(),
  y: z.number(),
  lps: z.number(),
  fromSlot: Slot,
  /** Sensors whose readings show it, with how strongly. */
  seenBy: z.array(z.object({ sensorId: z.string(), level: z.enum(['warning', 'critical']) })),
});
export type OpsEvent = z.infer<typeof OpsEvent>;

export const OpsAlarm = z.object({
  id: z.string(),
  sensorId: z.string(),
  rule: z.enum(['limit', 'baseline', 'leak', 'no_data']),
  severity: z.enum(['warning', 'critical']),
  startSlot: Slot,
  /** Last slot of the alarm; absent while it is still active. */
  endSlot: Slot.optional(),
  message: z.string(),
});
export type OpsAlarm = z.infer<typeof OpsAlarm>;

export const MarkerKind = z.enum(['suspected_leak', 'confirmed_leak', 'maintenance', 'sensor_fault']);
export type MarkerKind = z.infer<typeof MarkerKind>;
export const MarkerState = z.enum(['suspected', 'under_review', 'rejected', 'work_ordered', 'repaired', 'closed']);
export type MarkerState = z.infer<typeof MarkerState>;
export const MarkerAction = z.enum(['review', 'confirm', 'reject', 'repaired', 'verify', 'rework']);
export type MarkerAction = z.infer<typeof MarkerAction>;

/** Marker lifecycle: which action each state allows and where it leads. */
export const MARKER_TRANSITIONS: Readonly<Record<MarkerState, Partial<Record<MarkerAction, MarkerState>>>> = {
  suspected: { review: 'under_review', reject: 'rejected' },
  under_review: { confirm: 'work_ordered', reject: 'rejected' },
  rejected: {},
  work_ordered: { repaired: 'repaired' },
  repaired: { verify: 'closed', rework: 'work_ordered' },
  closed: {},
};

export const OpsMarker = z.object({
  id: z.string(),
  kind: MarkerKind,
  title: z.string(),
  dma: z.string().optional(),
  x: z.number(),
  y: z.number(),
  /** Asset it sits on or near. */
  gisRef: z.string().optional(),
  sensorId: z.string().optional(),
  origin: z.enum(['auto', 'manual']),
  state: MarkerState,
  severity: z.enum(['low', 'medium', 'high']),
  /** Estimated water lost (m³/day). */
  lossM3d: z.number().optional(),
  /** Readings that raised it: a sensor and a slot window. */
  evidence: z.object({ sensorId: z.string(), fromSlot: Slot, toSlot: Slot }).optional(),
  assignee: z.string().optional(),
  /** Work order in water-fsm, set when the marker is confirmed. */
  workOrderRef: z.string().optional(),
  createdAt: Iso,
  history: z.array(z.object({ state: MarkerState, at: Iso, by: z.string(), note: z.string().optional() })),
});
export type OpsMarker = z.infer<typeof OpsMarker>;

/** `POST /api/ops/markers` — a marker placed by hand. */
export const CreateMarkerRequest = z.object({
  kind: MarkerKind,
  title: z.string().min(1),
  x: z.number(),
  y: z.number(),
  dma: z.string().optional(),
  gisRef: z.string().optional(),
  sensorId: z.string().optional(),
  severity: z.enum(['low', 'medium', 'high']).optional(),
  /** Readings that made the operator place it. */
  evidence: z.object({ sensorId: z.string(), fromSlot: Slot, toSlot: Slot }).optional(),
  note: z.string().optional(),
});
export type CreateMarkerRequest = z.infer<typeof CreateMarkerRequest>;

/** `PATCH /api/ops/markers/{id}` — a lifecycle move, or an edit of the free fields. */
export const UpdateMarkerRequest = z.object({
  action: MarkerAction.optional(),
  note: z.string().optional(),
  assignee: z.string().optional(),
  severity: z.enum(['low', 'medium', 'high']).optional(),
  lossM3d: z.number().optional(),
});
export type UpdateMarkerRequest = z.infer<typeof UpdateMarkerRequest>;

export const OpsDmaBalance = z.object({
  id: z.string(),
  /** Hourly means (L/s). inflow = use + storage. */
  inflowLps: Hourly,
  useLps: Hourly,
  storageLps: Hourly,
  /** Minimum night flow (02:00–04:00) and its baseline (L/s). */
  mnfLps: z.number(),
  mnfBaselineLps: z.number(),
  inflowM3d: z.number(),
  useM3d: z.number(),
  storageM3d: z.number(),
  minPressureM: z.number(),
});
export type OpsDmaBalance = z.infer<typeof OpsDmaBalance>;

export const OpsPlanHour = z.object({
  hour: z.number().int().min(0).max(23),
  flowM3h: z.number().nonnegative(),
  setpointBar: z.number().nonnegative(),
  pumpsOn: z.number().int().nonnegative(),
  reservoir: z.enum(['fill', 'hold', 'supply']),
  /** Lowest critical-point pressure expected at this setpoint (bar). */
  criticalMinBar: z.number(),
});
export type OpsPlanHour = z.infer<typeof OpsPlanHour>;

export const OpsProduction = z.object({
  /** The day the readings are from, and the day being planned. */
  date: IsoDate,
  planDate: IsoDate,
  serviceMinBar: z.number(),
  /** Spare kept above the service minimum when lowering the setpoint (bar). */
  marginBar: z.number(),
  pumpRatedM3h: z.number().positive(),
  demandM3h: Hourly,
  forecastM3h: Hourly,
  forecastLoM3h: Hourly,
  forecastHiM3h: Hourly,
  history: z.array(z.object({ label: z.string(), m3h: Hourly })),
  /** Forecast error of recent days (mean absolute percentage error). */
  mapePct: z.number(),
  plan: z.array(OpsPlanHour).length(24),
  today: z.object({
    plannedFlowM3h: Hourly,
    actualFlowM3h: Hourly,
    plannedSetpointBar: Hourly,
    outletBar: Hourly,
    criticalMinBar: Hourly,
  }),
  kpis: z.object({
    productionM3d: z.number(),
    consumptionM3d: z.number(),
    leakageM3d: z.number(),
    nrwPct: z.number(),
    avgPressureBar: z.number(),
  }),
});
export type OpsProduction = z.infer<typeof OpsProduction>;

/** `PUT /api/ops/production/plan` — the planner's accepted schedule. Advice only: never sent to SCADA. */
export const SavePlanRequest = z.object({ date: IsoDate, plan: z.array(OpsPlanHour).length(24) });
export type SavePlanRequest = z.infer<typeof SavePlanRequest>;

/** The network at each hour of the day: node pressure (dm), pipe flow along the drawn line (0.1 L/s), velocity (cm/s). */
export const OpsNetworkDay = z.object({
  nodes: z.array(z.string()),
  pipes: z.array(z.string()),
  pressureDm: z.array(z.array(z.number())),
  flowDl: z.array(z.array(z.number())),
  velocityCm: z.array(z.array(z.number())),
});
export type OpsNetworkDay = z.infer<typeof OpsNetworkDay>;

/** Response bodies, one per route. */
export const OpsSensorsResponse = z.object({ date: IsoDate, sensors: z.array(OpsSensor) });
export const OpsReadingsResponse = z.object({ date: IsoDate, series: z.array(OpsSeries) });
export const OpsEventsResponse = z.object({ events: z.array(OpsEvent) });
export const OpsAlarmsResponse = z.object({ alarms: z.array(OpsAlarm) });
export const OpsMarkersResponse = z.object({ markers: z.array(OpsMarker) });
export const OpsDmaBalanceResponse = z.object({ date: IsoDate, dmas: z.array(OpsDmaBalance) });

/** Routes relative to the app API base (`VITE_API_URL`, `/api/gis` on the platform BFF), next to the other GIS routes. */
export const OPS_ROUTES = {
  sensors: '/ops/sensors',
  readings: '/ops/readings',
  events: '/ops/events',
  alarms: '/ops/alarms',
  networkState: '/ops/network-state',
  dmaBalance: '/ops/dma-balance',
  production: '/ops/production',
  productionPlan: '/ops/production/plan',
  markers: '/ops/markers',
  marker: (id: string) => `/ops/markers/${encodeURIComponent(id)}`,
} as const;

/**
 * Live updates pushed by the BFF hub (`ops/hub` under the API base, SignalR), scoped to the caller's tenant.
 * After a reconnect the client refetches the current slot, so a missed message costs one round trip.
 */
export const OpsLiveMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('slot'), date: IsoDate, slot: Slot, status: z.record(OpsStatus) }),
  z.object({ type: z.literal('alarm'), alarm: OpsAlarm }),
  z.object({ type: z.literal('marker'), marker: OpsMarker }),
]);
export type OpsLiveMessage = z.infer<typeof OpsLiveMessage>;
