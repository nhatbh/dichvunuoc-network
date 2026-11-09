/* Catalog properties of a component (decision 0028) as form fields: the editor shows and edits
   what the platform catalog declares for the asset, checked as gis-be will check it. */
import { findComponent, validateAttributes, type PropertySpec } from '@wn/contracts/catalog'
import { For, Show, type JSX } from 'solid-js'
import { Field, KV, Select, TextInput } from '../ui/kit'

export const PROPERTY_LABEL: Record<string, string> = {
  dn: 'Đường kính DN',
  dn2: 'DN nhánh / đầu nhỏ',
  material: 'Vật liệu',
  angle: 'Góc (°)',
  state: 'Trạng thái',
  year: 'Năm lắp',
  condition: 'Tình trạng',
  manufacturer: 'Hãng sản xuất',
  model: 'Model',
  serial: 'Số serial',
  dma: 'DMA',
  elevationM: 'Cao độ (m)',
  depthM: 'Độ sâu (m)',
  setpoint: 'Áp đặt',
  pumpCount: 'Số bơm',
}
const ENUM_LABEL: Record<string, string> = {
  open: 'Đang mở', closed: 'Đang đóng', throttled: 'Tiết lưu',
  good: 'Tốt', fair: 'Trung bình', poor: 'Kém', critical: 'Nguy cấp',
  DuctileIron: 'Gang dẻo', CastIron: 'Gang xám', Steel: 'Thép', Concrete: 'Bê tông', PVC: 'uPVC',
}

/** The catalog properties of `code` shown as fields, `exclude` covered elsewhere. */
export function catalogFields(code: string, exclude: readonly string[] = []): PropertySpec[] {
  return (findComponent(code)?.properties ?? []).filter(p => !exclude.includes(p.key))
}

/** The problem with one value, in gis-be's words, or undefined. */
export function propertyProblem(code: string, key: string, value: string): string | undefined {
  if (value === '') return undefined
  return validateAttributes(code, { [key]: value })[0]
}

export function CatalogProps(props: {
  code: string
  values: Record<string, string>
  exclude?: readonly string[]
  onChange?: (key: string, value: string) => void
}): JSX.Element {
  const label = (spec: PropertySpec) => (PROPERTY_LABEL[spec.key] ?? spec.key) + (spec.unit ? ` (${spec.unit})` : '')
  const fields = () => catalogFields(props.code, props.exclude)
  return (
    <Show
      when={props.onChange}
      fallback={
        <div class="flex flex-col gap-1">
          <For each={fields().filter(f => props.values[f.key])}>
            {spec => <KV label={label(spec)} mono>{ENUM_LABEL[props.values[spec.key]!] ?? props.values[spec.key]}</KV>}
          </For>
        </div>
      }
    >
      <div class="grid grid-cols-2 gap-2.5" data-testid="catalog-props">
        <For each={fields()}>
          {spec => {
            const value = () => props.values[spec.key] ?? ''
            const error = () => propertyProblem(props.code, spec.key, value())
            return (
              <Field label={label(spec)} error={error()}>
                <Show
                  when={spec.type === 'enum'}
                  fallback={<TextInput value={value()} onChange={v => props.onChange!(spec.key, v.trim())} mono error={error()} />}
                >
                  <Select
                    value={value()}
                    onChange={v => props.onChange!(spec.key, v)}
                    options={[{ value: '', label: '—' }, ...(spec.values ?? []).map(v => ({ value: v, label: ENUM_LABEL[v] ?? v }))]}
                  />
                </Show>
              </Field>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
