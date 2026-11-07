import { z } from 'zod';
import list from './codes.json' with { type: 'json' };

/**
 * Component codes, generated from `@wn/component-models` (the authority for codes). gis-be and
 * design-be validate asset types against this list; `CodeListEntry.gisDeviceType` maps a code to
 * the device type gis-be accepts until it takes every code.
 */
export const CodeListEntry = z.object({
  code: z.string(),
  name: z.string(),
  vi: z.string(),
  category: z.string(),
  role: z.enum(['line', 'node', 'inline', 'nodeDevice', 'facility']),
  host: z.enum(['line', 'pipe', 'node']),
  gisDeviceType: z.enum(['Valve', 'FlowMeter', 'PressureSensor', 'Pump', 'Hydrant']).nullable(),
  defaultDN: z.number(),
  dnRange: z.tuple([z.number(), z.number()]),
  hasStatus: z.boolean(),
});
export type CodeListEntry = z.infer<typeof CodeListEntry>;

export const COMPONENT_CODE_LIST: readonly CodeListEntry[] = z.array(CodeListEntry).parse(list.codes);
export const COMPONENT_CODES: readonly string[] = COMPONENT_CODE_LIST.map((c) => c.code);

const BY_CODE = new Map(COMPONENT_CODE_LIST.map((c) => [c.code, c]));
export const codeEntry = (code: string): CodeListEntry | undefined => BY_CODE.get(code);

/** A schema accepting only known component codes. */
export const ComponentCode = z.string().refine((c) => BY_CODE.has(c), { message: 'unknown component code' });
