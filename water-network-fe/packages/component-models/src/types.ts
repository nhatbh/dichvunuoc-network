// Shared types with no runtime dependency, safe for the 2D map, the editor and Node tools.

/** Pipe / body material codes, matching the backend (gis-be / design-be) material codes. */
export type MaterialCode = 'HDPE' | 'PVC' | 'DuctileIron' | 'Steel' | 'CastIron' | 'Concrete';
export type Joint = 'flanged' | 'socket' | 'fused' | 'plain';
/** Live state shown on sensors, hydrants and meters. */
export type Status = 'normal' | 'warning' | 'critical' | 'offline';

/** How a component sits in the network model (see the Component catalog). */
export type Role = 'line' | 'node' | 'inline' | 'nodeDevice' | 'facility';
export type Category =
  | 'Pipes'
  | 'Fittings'
  | 'Valves'
  | 'Hydrants & services'
  | 'Metering & monitoring'
  | 'Pumping & storage'
  | 'Treatment'
  | 'Electrical & automation';

export const MATERIAL_CODES: readonly MaterialCode[] = ['HDPE', 'PVC', 'DuctileIron', 'Steel', 'CastIron', 'Concrete'];
export const STATUSES: readonly Status[] = ['normal', 'warning', 'critical', 'offline'];
