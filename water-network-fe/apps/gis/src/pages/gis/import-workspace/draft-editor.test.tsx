import { fireEvent, render, screen } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import { createDraftEditor, overlayLineEdits, splitLineAt } from './draft-editor'
import { reviewForJob, type CadFeature, type ImportJob, type ReviewConfig } from './types'
import type { createImportWorkspace } from './workspace'

const source: CadFeature = {
  type: 'Feature',
  id: 'pipe-1',
  geometry: {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
  },
  properties: { fileId: 'file-1', layer: 'PIPE', entityType: 'LINE' },
}
function setup() {
  const job = { id: 'job-1', files: [{ id: 'file-1', name: 'Source.dxf' }] } as ImportJob
  const [config, setConfig] = createSignal<ReviewConfig>({
    ...reviewForJob(job),
    layerRules: [
      { fileId: 'file-1', layer: 'PIPE', action: 'pipe', diameterMm: 100, material: 'HDPE' },
    ],
  })
  const [selected, select] = createSignal('pipe-1')
  const w = {
    config,
    job: () => job,
    locked: () => false,
    edit: (change: (c: ReviewConfig) => ReviewConfig) => setConfig(change),
    canUndo: () => false,
    canRedo: () => false,
    undo: vi.fn(),
    redo: vi.fn(),
  } as unknown as ReturnType<typeof createImportWorkspace>
  let editor!: ReturnType<typeof createDraftEditor>
  render(() => {
    editor = createDraftEditor(
      w,
      () => overlayLineEdits([source], config()).find(f => f.id === selected()),
      select,
      vi.fn()
    )
    return <editor.Toolbar />
  })
  return { editor, config, select }
}
describe('draft geometry editing', () => {
  it('draws a persistent pipe edit, preserving CAD source and explicit attributes', () => {
    const { editor, config } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Vẽ tuyến nối' }))
    editor.pick([10, 10])
    editor.pick([20, 10])
    fireEvent.click(screen.getByRole('button', { name: /Hoàn tất tuyến/ }))
    expect(config().lineEdits).toHaveLength(1)
    expect(config().lineEdits![0]).toMatchObject({
      fileId: 'file-1',
      coordinates: [
        [10, 10],
        [20, 10],
      ],
      diameterMm: 100,
      material: 'HDPE',
    })
    expect(source.geometry.coordinates).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ])
    expect(overlayLineEdits([source], config())).toHaveLength(2)
  })
  it('moves a selected vertex and splits the edited candidate without deleting the original', () => {
    const { editor, config, select } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Sửa đỉnh / nối đầu mút' }))
    fireEvent.change(screen.getByLabelText('Đỉnh cần chuyển'), { target: { value: '0' } })
    editor.pick([-5, 0])
    expect(config().lineEdits![0]!.coordinates[0]).toEqual([-5, 0])
    select('pipe-1')
    fireEvent.click(screen.getByRole('button', { name: 'Tách tuyến' }))
    editor.pick([5, 1])
    expect(config().excludeFeatureIds).toContain('pipe-1')
    const children = config().lineEdits!.filter(e => e.id.startsWith('draft-'))
    expect(children).toHaveLength(2)
    expect(children[0]!.coordinates.at(-1)).toEqual([5, 0])
    expect(children[1]!.coordinates[0]).toEqual([5, 0])
    expect(children.every(e => e.sourceFeatureId === 'pipe-1')).toBe(true)
    expect(config().acceptWarningCodes).toEqual([])
  })
  it('projects a split onto the nearest segment and rejects endpoint-only splits', () => {
    expect(
      splitLineAt(
        [
          [0, 0],
          [10, 0],
        ],
        [5, 2]
      )
    ).toEqual([
      [
        [0, 0],
        [5, 0],
      ],
      [
        [5, 0],
        [10, 0],
      ],
    ])
    expect(
      splitLineAt(
        [
          [0, 0],
          [10, 0],
        ],
        [0, 0]
      )
    ).toBeNull()
    expect(
      splitLineAt(
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 0],
        ],
        [5, 0]
      )
    ).not.toBeNull()
  })
})
