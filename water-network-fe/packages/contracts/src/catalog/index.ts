import { z } from 'zod';
import list from './codes.json' with { type: 'json' };

/**
 * Component codes, generated from `@wn/component-models` (the authority for codes, decision 0028).
 * Every GIS asset carries one: the code fixes its kind, where it attaches, what it does
 * (functional flags) and which properties it may carry. gis-be, design-be and the CAD import
 * worker validate against copies of this list.
 */
export const ComponentFunction = z.enum([
  'isolates', 'controls', 'meters', 'senses', 'pumps', 'fireFlow', 'stores', 'supplies', 'connects', 'serves',
]);
export type ComponentFunction = z.infer<typeof ComponentFunction>;

export const PropertySpec = z.object({
  key: z.string(),
  type: z.enum(['int', 'number', 'string', 'enum']),
  min: z.number().optional(),
  max: z.number().optional(),
  values: z.array(z.string()).optional(),
  unit: z.string().optional(),
});
export type PropertySpec = z.infer<typeof PropertySpec>;

export const CodeListEntry = z.object({
  code: z.string(),
  name: z.string(),
  vi: z.string(),
  category: z.string(),
  role: z.enum(['line', 'node', 'inline', 'nodeDevice', 'facility']),
  /** GIS asset kind. */
  kind: z.enum(['Pipe', 'Node', 'Device']),
  /** A pipe is a line; devices attach to a pipe or a node; nodes stand alone. */
  host: z.enum(['line', 'pipe', 'node', 'none']),
  functions: z.array(ComponentFunction),
  defaultDN: z.number(),
  dnRange: z.tuple([z.number(), z.number()]),
  hasStatus: z.boolean(),
  properties: z.array(PropertySpec),
});
export type CodeListEntry = z.infer<typeof CodeListEntry>;

export const COMPONENT_CODE_LIST: readonly CodeListEntry[] = z.array(CodeListEntry).parse(list.codes);
export const COMPONENT_CODES: readonly string[] = COMPONENT_CODE_LIST.map((c) => c.code);

const BY_CODE = new Map(COMPONENT_CODE_LIST.map((c) => [c.code, c]));
export const codeEntry = (code: string): CodeListEntry | undefined => BY_CODE.get(code);

/** Does this component do `fn` (e.g. `isolates` for isolation planning)? */
export const componentDoes = (code: string, fn: ComponentFunction): boolean =>
  BY_CODE.get(code)?.functions.includes(fn) ?? false;

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
