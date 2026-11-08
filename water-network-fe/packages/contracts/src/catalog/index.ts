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
  /** How gis-be stores it until it accepts every code; the code travels as attribute `componentCode`. */
  gisKind: z.enum(['Pipe', 'Node', 'Device']),
  gisDeviceType: z.enum(['Valve', 'FlowMeter', 'PressureSensor', 'Pump', 'Hydrant']).nullable(),
  gisNodeType: z.enum(['Junction', 'Reservoir', 'Tank', 'Hydrant', 'Other']).nullable(),
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

/** Pipe material codes gis-be and design-be accept, with the Vietnamese labels the app shows. */
export const PIPE_MATERIALS = [
  { code: 'HDPE', vi: 'HDPE', aliases: ['PE', 'PE100'] },
  { code: 'PVC', vi: 'uPVC', aliases: ['uPVC', 'UPVC', 'Nhựa PVC'] },
  { code: 'DuctileIron', vi: 'Gang dẻo', aliases: ['DI', 'Gang deo'] },
  { code: 'CastIron', vi: 'Gang xám', aliases: ['CI', 'Gang xam'] },
  { code: 'Steel', vi: 'Thép', aliases: ['Thep', 'Thép tráng kẽm'] },
  { code: 'Concrete', vi: 'Bê tông', aliases: ['Be tong', 'Bê tông cốt thép'] },
] as const;
export type PipeMaterialCode = (typeof PIPE_MATERIALS)[number]['code'];

const MATERIAL_BY_LABEL = new Map<string, PipeMaterialCode>(
  PIPE_MATERIALS.flatMap((m) => [m.code, m.vi, ...m.aliases].map((l) => [l.toLowerCase(), m.code] as const)),
);
/** The material code for a label or code (case-insensitive); undefined when unknown. */
export const pipeMaterialCode = (label: string): PipeMaterialCode | undefined =>
  MATERIAL_BY_LABEL.get(label.trim().toLowerCase());
/** The Vietnamese label for a material code. */
export const pipeMaterialLabel = (code: string): string =>
  PIPE_MATERIALS.find((m) => m.code.toLowerCase() === code.toLowerCase())?.vi ?? code;
