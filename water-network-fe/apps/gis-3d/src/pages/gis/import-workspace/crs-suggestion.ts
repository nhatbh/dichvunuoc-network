import { z } from 'zod'
import { vn2000Localities } from './vn2000-catalog'
import type { ImportJob, ReviewConfig } from './types'

/**
 * The import service's proposal of a drawing's source CRS, read from the drawing itself
 * (decision 0032). It is only ever a proposal: nothing is saved until the reviewer confirms.
 */
const ring = z.array(z.tuple([z.number(), z.number()]))
export const crsSuggestionSchema = z
  .object({
    status: z.enum(['detected', 'ambiguous', 'unknown']),
    crs: z.string().nullable(),
    presetId: z.string().nullable(),
    units: z.enum(['m', 'mm']),
    axisOrder: z.enum(['xy', 'yx']),
    confidence: z.string(),
    evidence: z.array(z.object({ kind: z.string(), text: z.string() }).passthrough()),
    candidates: z
      .array(
        z
          .object({
            presetId: z.string(),
            label: z.string(),
            crs: z.string(),
            consistent: z.boolean(),
            distanceKm: z.number(),
            footprint: ring.optional(),
          })
          .passthrough()
      )
      .default([]),
    checks: z
      .array(z.object({ code: z.string(), ok: z.boolean(), message: z.string() }).passthrough())
      .default([]),
    footprint: ring.nullish(),
  })
  .passthrough()
export type CrsSuggestion = z.infer<typeof crsSuggestionSchema>

export type Projection = 'TM3' | 'UTM48N' | 'UTM49N'
export interface CrsChoice {
  localityId: string
  projection: Projection | ''
  units: 'm' | 'mm'
  axisOrder: 'xy' | 'yx'
}

/** EPSG of a locality + projection, the same preset rule as the source CRS panel. */
export function presetFor(localityId: string, projection: Projection | '') {
  const place = vn2000Localities.find(item => item.id === localityId)
  if (!projection) return null
  if (projection !== 'TM3')
    return {
      id: `${localityId || 'utm'}:${projection}`,
      epsg: projection === 'UTM48N' ? 3405 : 3406,
    }
  return place ? { id: `${place.id}:TM3`, epsg: place.epsg } : null
}

export function choiceFromPreset(
  presetId: string | null | undefined,
  crs?: string | null
): Pick<CrsChoice, 'localityId' | 'projection'> {
  const [id = '', kind = ''] = presetId?.split(':') ?? []
  const projection = (['TM3', 'UTM48N', 'UTM49N'].includes(kind) ? kind : '') as Projection | ''
  if (projection)
    return { localityId: vn2000Localities.some(l => l.id === id) ? id : '', projection }
  if (crs === 'EPSG:3405') return { localityId: '', projection: 'UTM48N' }
  if (crs === 'EPSG:3406') return { localityId: '', projection: 'UTM49N' }
  const byEpsg = vn2000Localities.find(l => `EPSG:${l.epsg}` === crs)
  return byEpsg ? { localityId: byEpsg.id, projection: 'TM3' } : { localityId: '', projection: '' }
}

/** One proposal for the job: the files that carry one agree, or the result is ambiguous. */
export function jobSuggestion(
  job: ImportJob | null,
  excluded: string[] = []
): CrsSuggestion | null {
  const files = (job?.inventory?.files ?? []).filter(file => !excluded.includes(file.id))
  const parsed = files
    .map(file => crsSuggestionSchema.safeParse((file as Record<string, unknown>).crsSuggestion))
    .flatMap(result => (result.success ? [result.data] : []))
  if (!parsed.length) return null
  const located = parsed.filter(s => s.crs)
  const first = located[0] ?? parsed[0]!
  const disagree = located.some(
    s => s.crs !== first.crs || s.units !== first.units || s.axisOrder !== first.axisOrder
  )
  return disagree ? { ...first, status: 'ambiguous', confidence: 'low' } : first
}

export function choiceFromSuggestion(s: CrsSuggestion): CrsChoice {
  return { ...choiceFromPreset(s.presetId, s.crs), units: s.units, axisOrder: s.axisOrder }
}

export function choiceFromConfig(config: ReviewConfig): CrsChoice {
  return {
    ...choiceFromPreset(config.sourceCrsPresetId, config.sourceCrs),
    units: config.sourceUnits ?? 'm',
    axisOrder: config.sourceAxisOrder ?? 'xy',
  }
}

export const sameChoice = (a: CrsChoice, b: CrsChoice) =>
  a.localityId === b.localityId &&
  a.projection === b.projection &&
  a.units === b.units &&
  a.axisOrder === b.axisOrder

export function describeChoice(choice: CrsChoice): string {
  const place = vn2000Localities.find(l => l.id === choice.localityId)
  const preset = presetFor(choice.localityId, choice.projection)
  if (!preset) return 'Chưa chọn hệ tọa độ'
  const projection =
    choice.projection === 'TM3'
      ? `${place?.provinceLabel ?? ''} · TM-3 KTT ${formatMeridian(place?.centralMeridian ?? 0)}`
      : choice.projection === 'UTM48N'
        ? 'UTM múi 48'
        : 'UTM múi 49'
  return `VN-2000 · ${projection} · EPSG:${preset.epsg} · ${choice.units === 'm' ? 'mét' : 'milimét'}${
    choice.axisOrder === 'yx' ? ' · trục đảo' : ''
  }`
}

export function formatMeridian(value: number): string {
  const degrees = Math.floor(value)
  const minutes = Math.round((value - degrees) * 60)
  return `${degrees}°${String(minutes).padStart(2, '0')}'`
}

/** The config change for a choice; switching to a source CRS clears point alignment. */
export function choicePatch(choice: CrsChoice): Partial<ReviewConfig> | null {
  const preset = presetFor(choice.localityId, choice.projection)
  if (!preset) return null
  return {
    sourceCrs: `EPSG:${preset.epsg}`,
    sourceCrsPresetId: preset.id,
    sourceUnits: choice.units,
    sourceAxisOrder: choice.axisOrder,
    controlPoints: [],
    controlPointTargetCrs: null,
    fileCrs: [],
  }
}

/** The recorded CRS evidence: what the importer read, and that the reviewer checked it on the map. */
export function evidenceFor(
  choice: CrsChoice,
  suggestion: CrsSuggestion | null,
  reviewer: string
): string {
  const proposed = suggestion && sameChoice(choice, choiceFromSuggestion(suggestion))
  const lines = [
    `${describeChoice(choice)}.`,
    proposed ? 'Đề xuất tự động từ bản vẽ:' : 'Người dùng chọn hệ tọa độ (khác đề xuất tự động).',
    ...(suggestion?.evidence ?? []).map(item => `- ${item.text}`),
    `Đã kiểm tra vị trí trên bản đồ nền và xác nhận: ${reviewer}, ${new Date().toISOString().slice(0, 10)}.`,
  ]
  return lines.join('\n').slice(0, 3900)
}
