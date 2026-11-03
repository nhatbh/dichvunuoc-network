import { For, Index, Show, createMemo, createSignal } from 'solid-js'
import { type BlockRule, type CadFeature } from './types'
import { importButton, importField } from './ui'
import { Card } from '../ui/kit'
import type { createImportWorkspace } from './workspace'

const blockActions: [BlockRule['action'], string][] = [
  ['review', 'Cần xác minh'],
  ['node', 'Nút mạng'],
  ['device', 'Thiết bị'],
  ['reference', 'Tham chiếu'],
  ['exclude', 'Loại khỏi mạng'],
]
const nodeTypes = [
  ['Junction', 'Nút đấu nối'],
  ['Reservoir', 'Nguồn nước'],
  ['Tank', 'Bể chứa'],
  ['Hydrant', 'Nút cứu hỏa'],
  ['Other', 'Nút khác'],
] as const
const deviceTypes = [
  ['Valve', 'Van'],
  ['FlowMeter', 'Đồng hồ lưu lượng'],
  ['PressureSensor', 'Cảm biến áp lực'],
  ['Pump', 'Máy bơm'],
  ['Hydrant', 'Trụ cứu hỏa'],
] as const

export function BlockMapping(props: {
  workspace: ReturnType<typeof createImportWorkspace>
  fileFilter: string
  onSelect: (id: string) => void
  onLocate: (id: string, ids: string[]) => void
}) {
  const w = props.workspace
  const rules = createMemo(
    () =>
      w
        .config()
        ?.blockRules?.filter(
          rule =>
            !w.config()?.excludedFileIds?.includes(rule.fileId) &&
            (!props.fileFilter || rule.fileId === props.fileFilter)
        ) ?? []
  )
  const raw = createMemo(() => (w.view() === 'raw' ? (w.preview()?.features ?? []) : []))
  const [positions, setPositions] = createSignal<Record<string, number>>({})
  const ruleKey = (rule: BlockRule) => JSON.stringify([rule.fileId, rule.blockName])
  const instances = (rule: BlockRule) =>
    raw().filter(
      feature =>
        feature.properties.fileId === rule.fileId &&
        feature.properties.blockName === rule.blockName &&
        feature.geometry.type === 'Point' &&
        !feature.properties.isBlockGeometry &&
        !feature.properties.isXref
    )
  function locate(rule: BlockRule, step = 0) {
    const items = instances(rule)
    if (!items.length) return
    const key = ruleKey(rule)
    const index = ((positions()[key] ?? 0) + step + items.length) % items.length
    setPositions(value => ({ ...value, [key]: index }))
    const ids = new Set(items.map(feature => feature.id))
    props.onLocate(
      items[index]!.id,
      raw()
        .filter(
          feature =>
            ids.has(feature.id) ||
            (feature.properties.parentId && ids.has(feature.properties.parentId))
        )
        .map(feature => feature.id)
    )
  }
  const mappedDevices = createMemo(() =>
    raw().filter(feature => {
      const rule = rules().find(
        rule =>
          rule.blockName === feature.properties.blockName &&
          rule.fileId === feature.properties.fileId
      )
      return (
        feature.geometry.type === 'Point' &&
        !feature.properties.isBlockGeometry &&
        rule?.action === 'device'
      )
    })
  )
  const hosts = createMemo(() =>
    raw().filter(feature => {
      if (feature.properties.isBlockGeometry || w.config()?.excludeFeatureIds.includes(feature.id))
        return false
      if (feature.geometry.type === 'LineString')
        return w
          .config()
          ?.layerRules.some(
            rule =>
              rule.fileId === feature.properties.fileId &&
              rule.layer === feature.properties.layer &&
              rule.action === 'pipe'
          )
      return w
        .config()
        ?.blockRules?.some(
          rule =>
            rule.fileId === feature.properties.fileId &&
            rule.blockName === feature.properties.blockName &&
            rule.action === 'node'
        )
    })
  )
  function update(rule: BlockRule, change: Partial<BlockRule>) {
    w.edit(config => ({
      ...config,
      blockRules: config.blockRules?.map(item =>
        item.fileId === rule.fileId && item.blockName === rule.blockName
          ? { ...item, ...change }
          : item
      ),
    }))
  }
  function updateHost(featureId: string, hostFeatureId: string) {
    w.edit(config => ({
      ...config,
      deviceHosts: [
        ...(config.deviceHosts ?? []).filter(host => host.featureId !== featureId),
        ...(hostFeatureId.trim() ? [{ featureId, hostFeatureId: hostFeatureId.trim() }] : []),
      ],
    }))
  }
  const fileName = (id: string) => w.job()?.files.find(file => file.id === id)?.name ?? id
  function compatibleHosts(device: CadFeature) {
    const type = rules().find(
      rule =>
        rule.fileId === device.properties.fileId && rule.blockName === device.properties.blockName
    )?.deviceType
    return hosts().filter(
      host =>
        type === 'PressureSensor' ||
        (['Valve', 'FlowMeter'].includes(type ?? '')
          ? host.geometry.type === 'LineString'
          : host.geometry.type === 'Point')
    )
  }
  return (
    <Show when={rules().length}>
      <Card pad={false} class="overflow-hidden">
        <div class="border-b border-line p-4">
          <h3 class="text-sm font-semibold">Ký hiệu nút mạng và thiết bị</h3>
          <p class="mt-2 text-xs leading-5 text-[color:var(--muted)]">
            Chọn ý nghĩa của từng block sau khi đối chiếu chú giải. Nét vẽ bên trong ký hiệu được
            giữ làm tham chiếu. Mỗi thiết bị cần chọn rõ tuyến ống hoặc nút chứa nó.
          </p>
        </div>
        <p class="px-4 py-2 text-xs" role="status">
          {w.previewLoading()
            ? 'Đang tải vị trí ký hiệu…'
            : w.previewError()
              ? 'Không tải được bản vẽ. Hãy thử tải lại hồ sơ.'
              : 'Bấm Xem trên bản vẽ để tới ký hiệu màu hồng; dùng Trước / Tiếp để đối chiếu từng vị trí. Phân loại áp dụng cho cả nhóm trong cùng tệp.'}
          {w.preview()?.hasMore ? ' Số vị trí bên dưới chỉ tính phần bản vẽ đã tải.' : ''}
        </p>
        <div class="max-h-[400px] overflow-auto">
          <table class="w-full min-w-[650px] text-left text-xs">
            <thead class="sticky top-0 bg-[var(--surface2)]">
              <tr>
                <th class="p-3">Ký hiệu / tệp</th>
                <th class="p-3">Phân loại</th>
                <th class="p-3">Loại tài sản</th>
              </tr>
            </thead>
            <tbody>
              <Index each={rules()}>
                {rule => (
                  <tr class="border-t border-line">
                    <td class="max-w-[280px] break-words p-3">
                      <b>{rule().blockName}</b>
                      <div class="my-2 flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          class={importButton}
                          disabled={!instances(rule()).length}
                          aria-label={`Xem ký hiệu ${rule().blockName} ${rule().fileId} trên bản vẽ`}
                          onClick={() => locate(rule())}
                        >
                          Xem trên bản vẽ
                        </button>
                        <Show
                          when={instances(rule()).length}
                          fallback={<span>Chưa có vị trí trong bản vẽ đã tải</span>}
                        >
                          <span>
                            {(positions()[ruleKey(rule())] ?? 0) + 1} / {instances(rule()).length}{' '}
                            vị trí
                          </span>
                          <button
                            type="button"
                            class={importButton}
                            disabled={instances(rule()).length < 2}
                            aria-label={`Vị trí trước ${rule().blockName} ${rule().fileId}`}
                            onClick={() => locate(rule(), -1)}
                          >
                            Trước
                          </button>
                          <button
                            type="button"
                            class={importButton}
                            disabled={instances(rule()).length < 2}
                            aria-label={`Vị trí tiếp ${rule().blockName} ${rule().fileId}`}
                            onClick={() => locate(rule(), 1)}
                          >
                            Tiếp
                          </button>
                        </Show>
                      </div>
                      <div class="mt-1 text-[10px] text-[color:var(--muted)]">
                        {fileName(rule().fileId)}
                      </div>
                    </td>
                    <td class="p-2">
                      <select
                        class={importField}
                        disabled={w.locked()}
                        aria-label={`Phân loại ký hiệu ${rule().blockName} ${rule().fileId}`}
                        value={rule().action}
                        onChange={event =>
                          update(rule(), {
                            action: event.currentTarget.value as BlockRule['action'],
                            nodeType: undefined,
                            deviceType: undefined,
                          })
                        }
                      >
                        <For each={blockActions}>
                          {([value, label]) => <option value={value}>{label}</option>}
                        </For>
                      </select>
                    </td>
                    <td class="p-2">
                      <Show when={rule().action === 'node'}>
                        <select
                          class={importField}
                          disabled={w.locked()}
                          aria-label={`Loại nút ${rule().blockName}`}
                          value={rule().nodeType ?? ''}
                          onChange={event =>
                            update(rule(), {
                              nodeType:
                                (event.currentTarget.value as BlockRule['nodeType']) || undefined,
                            })
                          }
                        >
                          <option value="">Chọn loại nút…</option>
                          <For each={nodeTypes}>
                            {([value, label]) => <option value={value}>{label}</option>}
                          </For>
                        </select>
                      </Show>
                      <Show when={rule().action === 'device'}>
                        <select
                          class={importField}
                          disabled={w.locked()}
                          aria-label={`Loại thiết bị ${rule().blockName}`}
                          value={rule().deviceType ?? ''}
                          onChange={event =>
                            update(rule(), {
                              deviceType:
                                (event.currentTarget.value as BlockRule['deviceType']) || undefined,
                            })
                          }
                        >
                          <option value="">Chọn loại thiết bị…</option>
                          <For each={deviceTypes}>
                            {([value, label]) => <option value={value}>{label}</option>}
                          </For>
                        </select>
                      </Show>
                    </td>
                  </tr>
                )}
              </Index>
            </tbody>
          </table>
        </div>
        <div class="border-t border-line p-4">
          <label class="flex max-w-xs flex-col gap-1.5 text-xs">
            Ngưỡng gắn thiết bị (m)
            <input
              class={importField}
              disabled={w.locked()}
              type="number"
              min="0.01"
              max="2"
              step="0.01"
              value={w.config()?.hostToleranceM ?? 0.5}
              onInput={event =>
                w.edit(config => ({ ...config, hostToleranceM: Number(event.currentTarget.value) }))
              }
            />
          </label>
          <p class="mt-2 text-[11px] leading-5 text-[color:var(--muted)]">
            Van / đồng hồ lưu lượng gắn vào ống; máy bơm / trụ cứu hỏa gắn vào nút; cảm biến áp lực
            chọn một trong hai. Vị trí và khoảng cách được kiểm tra khi áp dụng.
          </p>
        </div>
        <Show when={w.view() !== 'raw'}>
          <p class="border-t border-line p-4 text-xs text-[color:var(--muted)]">
            Chọn “Bản vẽ gốc” để cấu hình đối tượng chứa thiết bị.
          </p>
        </Show>
        <Show when={mappedDevices().length}>
          <div class="max-h-[320px] overflow-auto border-t border-line">
            <table class="w-full min-w-[650px] text-left text-xs">
              <thead class="sticky top-0 bg-[var(--surface2)]">
                <tr>
                  <th class="p-3">Thiết bị đã tải</th>
                  <th class="p-3">Mã ống / nút chứa thiết bị</th>
                  <th class="p-3">Vị trí</th>
                </tr>
              </thead>
              <tbody>
                <For each={mappedDevices()}>
                  {device => (
                    <tr class="border-t border-line">
                      <td class="max-w-[250px] break-all p-3">
                        {device.properties.blockName}
                        <div class="mt-1 font-mono text-[10px]">{device.id}</div>
                      </td>
                      <td class="p-2">
                        <input
                          class={importField}
                          disabled={w.locked()}
                          aria-label={`Đối tượng chứa ${device.id}`}
                          list={`hosts-${device.id}`}
                          value={
                            w.config()?.deviceHosts?.find(host => host.featureId === device.id)
                              ?.hostFeatureId ?? ''
                          }
                          placeholder="Chọn hoặc nhập đúng mã đối tượng gốc"
                          onInput={event => updateHost(device.id, event.currentTarget.value)}
                        />
                        <datalist id={`hosts-${device.id}`}>
                          <For each={compatibleHosts(device).slice(0, 200)}>
                            {host => (
                              <option value={host.id}>
                                {host.properties.layer} ·{' '}
                                {host.geometry.type === 'Point' ? 'Nút' : 'Ống'}
                              </option>
                            )}
                          </For>
                        </datalist>
                      </td>
                      <td class="p-2">
                        <button
                          type="button"
                          class={importButton}
                          onClick={() => props.onSelect(device.id)}
                        >
                          Xem ký hiệu
                        </button>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
            <p class="p-3 text-[11px] text-[color:var(--muted)]">
              Danh sách chỉ gồm các thiết bị đã tải trong bản xem trước. Có thể tải thêm đối tượng
              để hoàn tất gán; máy chủ kiểm tra toàn bộ hồ sơ.
            </p>
          </div>
        </Show>
      </Card>
    </Show>
  )
}
