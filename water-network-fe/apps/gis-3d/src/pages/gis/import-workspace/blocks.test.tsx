import { fireEvent, render, screen } from '@solidjs/testing-library'
import { expect, it, vi } from 'vitest'
import { BlockMapping } from './blocks'
import type { createImportWorkspace } from './workspace'

it('locates unclassified block instances by file, including symbol geometry, and cycles positions', () => {
  const feature = (id: string, fileId = 'a', extra = {}) => ({
    id,
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [10, 20] },
    properties: { fileId, blockName: 'VAN', ...extra },
  })
  const onLocate = vi.fn()
  const w = {
    config: () => ({
      blockRules: [{ fileId: 'a', blockName: 'VAN', action: 'review' }],
      layerRules: [],
      excludeFeatureIds: [],
    }),
    job: () => ({ files: [{ id: 'a', name: 'A.dwg' }] }),
    view: () => 'raw',
    locked: () => false,
    previewLoading: () => false,
    previewError: () => null,
    preview: () => ({
      features: [
        feature('one'),
        feature('two'),
        feature('other', 'b'),
        feature('detail', 'a', { isBlockGeometry: true, parentId: 'one' }),
      ],
      hasMore: false,
    }),
  } as unknown as ReturnType<typeof createImportWorkspace>
  render(() => <BlockMapping workspace={w} fileFilter="" onSelect={vi.fn()} onLocate={onLocate} />)
  fireEvent.click(screen.getByRole('button', { name: 'Xem ký hiệu VAN a trên bản vẽ' }))
  expect(onLocate).toHaveBeenLastCalledWith('one', ['one', 'two', 'detail'])
  fireEvent.click(screen.getByRole('button', { name: 'Vị trí tiếp VAN a' }))
  expect(onLocate).toHaveBeenLastCalledWith('two', ['one', 'two', 'detail'])
  fireEvent.click(screen.getByRole('button', { name: 'Vị trí tiếp VAN a' }))
  expect(onLocate).toHaveBeenLastCalledWith('one', ['one', 'two', 'detail'])
})

it('maps a block to a catalog component and offers device hosts from its gis-be type', () => {
  const edits: unknown[] = []
  let rules = [
    { fileId: 'a', blockName: 'VAN_GIAM_AP', action: 'component', componentCode: 'PRV' },
    { fileId: 'a', blockName: 'TE', action: 'review' },
  ]
  const point = (id: string, blockName: string) => ({
    id, type: 'Feature', geometry: { type: 'Point', coordinates: [10, 20] }, properties: { fileId: 'a', blockName, layer: 'S' },
  })
  const w = {
    config: () => ({ blockRules: rules, layerRules: [{ fileId: 'a', layer: 'P', action: 'pipe' }], excludeFeatureIds: [], deviceHosts: [] }),
    edit: (fn: (c: unknown) => { blockRules: typeof rules }) => {
      const next = fn({ blockRules: rules })
      rules = next.blockRules
      edits.push(next)
    },
    job: () => ({ files: [{ id: 'a', name: 'A.dwg' }] }),
    view: () => 'raw',
    locked: () => false,
    previewLoading: () => false,
    previewError: () => null,
    preview: () => ({
      features: [
        point('prv', 'VAN_GIAM_AP'),
        point('tee', 'TE'),
        { id: 'pipe', type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [20, 20]] }, properties: { fileId: 'a', layer: 'P' } },
      ],
      hasMore: false,
    }),
  } as unknown as ReturnType<typeof createImportWorkspace>
  render(() => <BlockMapping workspace={w} fileFilter="" onSelect={vi.fn()} onLocate={vi.fn()} />)
  // the PRV is a gis-be Valve: it needs a pipe host
  expect((screen.getByLabelText('Thành phần VAN_GIAM_AP') as HTMLSelectElement).value).toBe('PRV')
  // …so the pipe is offered as its host
  expect(screen.getByLabelText('Đối tượng chứa prv')).toBeTruthy()
  // classify the tee block as a catalog component
  fireEvent.change(screen.getByLabelText('Phân loại ký hiệu TE a'), { target: { value: 'component' } })
  expect(rules.find(r => r.blockName === 'TE')).toMatchObject({ action: 'component', componentCode: undefined })
})
