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
