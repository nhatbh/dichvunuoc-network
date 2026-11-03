import { fireEvent, render, screen } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import { CadPreview, featureBounds, type CadPreviewProps } from './preview'
import type { CadFeature } from './types'

const line: CadFeature = {
  type: 'Feature',
  id: 'pipe-1',
  properties: { fileId: 'drawing-1', layer: 'pipe' },
  geometry: {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [50, 50],
      [100, 100],
    ],
  },
}
const rectangle = { left: 100, top: 50, width: 1000, height: 400 }

function setup(overrides: Partial<CadPreviewProps> = {}) {
  const onSelect = vi.fn()
  const onPickPoint = vi.fn()
  const result = render(() => (
    <CadPreview
      features={[line]}
      selectedId=""
      onSelect={onSelect}
      excludeFeatureIds={[]}
      layerRules={[]}
      coordinateSpace="cad"
      resetKey="drawing-1"
      pickPoint
      onPickPoint={onPickPoint}
      {...overrides}
    />
  ))
  const svg = screen.getByRole('application') as unknown as SVGSVGElement
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(rectangle as DOMRect)
  return { ...result, svg, onSelect, onPickPoint }
}

function pointer(element: Element, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  fireEvent(element, event)
}

function clickPoint(svg: SVGSVGElement, x: number, y: number) {
  pointer(svg, 'pointerdown', x, y)
  pointer(svg, 'pointerup', x, y)
}

function expectPoint(actual: unknown, expected: [number, number]) {
  expect(actual).toBeInstanceOf(Array)
  const point = actual as [number, number]
  expect(point[0]).toBeCloseTo(expected[0], 8)
  expect(point[1]).toBeCloseTo(expected[1], 8)
}

describe('CAD preview coordinates and navigation', () => {
  it('preserves aspect ratio and inverts horizontal letterboxing when picking a CAD point', () => {
    const { svg, onPickPoint, onSelect } = setup()
    expect(svg).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet')
    // The 1000×600 drawing meets a 1000×400 viewport: 166⅔px margins at either side.
    clickPoint(svg, 100 + 1000 / 6 + (370 * 2) / 3, 50 + (170 * 2) / 3)
    expectPoint(onPickPoint.mock.calls[0]?.[0], [25, 75])
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('inverts vertical letterboxing in a tall viewport', () => {
    const { svg, onPickPoint } = setup()
    vi.mocked(svg.getBoundingClientRect).mockReturnValue({
      left: 100,
      top: 50,
      width: 400,
      height: 1000,
    } as DOMRect)
    clickPoint(svg, 100 + 370 * 0.4, 50 + 380 + 170 * 0.4)
    expectPoint(onPickPoint.mock.calls[0]?.[0], [25, 75])
  })

  it('uses the actual SVG screen matrix when CSS transforms affect the viewport', () => {
    const { svg, onPickPoint } = setup()
    Object.defineProperty(svg, 'getScreenCTM', {
      value: () => ({ a: 0.8, b: 0.2, c: -0.2, d: 0.8, e: 120, f: 70 }),
    })
    clickPoint(svg, 0.8 * 370 - 0.2 * 170 + 120, 0.2 * 370 + 0.8 * 170 + 70)
    expectPoint(onPickPoint.mock.calls[0]?.[0], [25, 75])
  })

  it('moves in view coordinates without selecting a point and keeps the inverse correct after panning', () => {
    const { svg, onPickPoint, onSelect } = setup()
    pointer(svg, 'pointerdown', 600, 250)
    pointer(svg, 'pointermove', 700, 290)
    pointer(svg, 'pointerup', 700, 290)
    expect(onPickPoint).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
    clickPoint(svg, 100 + 1000 / 6 + ((370 + 150) * 2) / 3, 50 + ((170 + 60) * 2) / 3)
    expectPoint(onPickPoint.mock.calls[0]?.[0], [25, 75])
  })

  it('keeps the coordinate under the wheel cursor fixed through zoom', () => {
    const { svg, onPickPoint } = setup()
    const x = 100 + 1000 / 6 + (370 * 2) / 3
    const y = 50 + (170 * 2) / 3
    clickPoint(svg, x, y)
    fireEvent.wheel(svg, { clientX: x, clientY: y, deltaY: -300 })
    clickPoint(svg, x, y)
    expectPoint(onPickPoint.mock.calls[0]?.[0], [25, 75])
    expectPoint(onPickPoint.mock.calls[1]?.[0], [25, 75])
  })

  it('snaps within eight CSS pixels but preserves arbitrary coordinates beyond that distance', () => {
    const { svg, onPickPoint } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Phóng to' }))
    // The middle vertex remains at the viewport centre after zoom.
    clickPoint(svg, 607, 250)
    clickPoint(svg, 609, 250)
    expectPoint(onPickPoint.mock.calls[0]?.[0], [50, 50])
    expectPoint(onPickPoint.mock.calls[1]?.[0], [50 + 9 / ((2 / 3) * 5.2 * 1.5), 50])
  })

  it('ignores cancelled drags and pointerup displacement without a move event', () => {
    const { svg, onPickPoint, onSelect } = setup()
    pointer(svg, 'pointerdown', 600, 250)
    pointer(svg, 'pointercancel', 600, 250)
    pointer(svg, 'pointerup', 600, 250)
    pointer(svg, 'pointerdown', 600, 250)
    pointer(svg, 'pointerup', 610, 250)
    expect(onPickPoint).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('retains feature selection and exclusion styling with a wider transparent hit area', () => {
    const { svg, container, onSelect, onPickPoint } = setup({
      pickPoint: false,
      excludeFeatureIds: ['pipe-1'],
    })
    const hit = container.querySelector('[data-cad-hit-area]')!
    expect(hit).toHaveAttribute('stroke-width', '14')
    expect(container.querySelector('path[stroke="#dc2626"]')).toHaveAttribute(
      'stroke-dasharray',
      '5 4'
    )
    pointer(hit, 'pointerdown', 600, 250)
    pointer(svg, 'pointerup', 600, 250)
    expect(onSelect).toHaveBeenLastCalledWith('pipe-1')
    clickPoint(svg, 400, 200)
    expect(onSelect).toHaveBeenLastCalledWith('')
    expect(onPickPoint).not.toHaveBeenCalled()
  })

  it('exposes numbered control points to keyboard users and preserves incomplete row numbers', () => {
    const { onPickPoint } = setup({
      controlPoints: [{ id: 'cp-3', coordinate: [25, 75] }],
      activeControlPointId: 'cp-3',
    })
    const marker = screen.getByRole('button', { name: 'Điểm đối chiếu CAD 3' })
    expect(marker).toHaveAttribute('tabindex', '0')
    expect(marker).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(marker, { key: 'Enter' })
    expect(onPickPoint).toHaveBeenCalledExactlyOnceWith([25, 75])
  })

  it('allows panning from a control point without picking it and emits only once for a pointer click', () => {
    const { svg, onPickPoint } = setup({ controlPoints: [{ id: 'cp-1', coordinate: [50, 50] }] })
    const marker = () => screen.getByRole('button', { name: 'Điểm đối chiếu CAD 1' })
    pointer(marker(), 'pointerdown', 600, 250)
    pointer(svg, 'pointermove', 700, 290)
    pointer(svg, 'pointerup', 700, 290)
    fireEvent.click(marker(), { detail: 1 })
    expect(onPickPoint).not.toHaveBeenCalled()
    pointer(marker(), 'pointerdown', 700, 290)
    pointer(svg, 'pointerup', 700, 290)
    fireEvent.click(marker(), { detail: 1 })
    expect(onPickPoint).toHaveBeenCalledExactlyOnceWith([50, 50])
  })

  it('focuses the selected feature on an external focusKey change and resets with Home', () => {
    const [selectedId, setSelectedId] = createSignal('')
    const [focusKey, setFocusKey] = createSignal<string>()
    const onPickPoint = vi.fn()
    const target: CadFeature = {
      ...line,
      id: 'target',
      geometry: {
        type: 'LineString',
        coordinates: [
          [80, 80],
          [90, 90],
        ],
      },
    }
    render(() => (
      <CadPreview
        features={[line, target]}
        selectedId={selectedId()}
        focusKey={focusKey()}
        onSelect={() => {}}
        excludeFeatureIds={[]}
        layerRules={[]}
        coordinateSpace="cad"
        resetKey="drawing"
        pickPoint
        onPickPoint={onPickPoint}
        fill
      />
    ))
    const svg = screen.getByRole('application')
    expect(svg).not.toHaveStyle({ 'aspect-ratio': '5 / 3' })
    setSelectedId('target')
    setFocusKey('focus-1')
    fireEvent.keyDown(svg, { key: 'Enter' })
    expectPoint(onPickPoint.mock.calls[0]?.[0], [85, 85])
    fireEvent.keyDown(svg, { key: 'Home' })
    fireEvent.keyDown(svg, { key: 'Enter' })
    expectPoint(onPickPoint.mock.calls[1]?.[0], [50, 50])
  })

  it('omits non-finite coordinates and does not bridge a broken line segment', () => {
    const broken: CadFeature = {
      ...line,
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [NaN, 4],
          [100, 100],
        ],
      },
    }
    const xref: CadFeature = {
      ...line,
      id: 'xref',
      properties: { isXref: true },
      geometry: { type: 'Point', coordinates: [1e8, 1e8] },
    }
    expect(featureBounds([broken, xref])).toEqual([0, 0, 100, 100])
    const { container } = setup({ features: [broken] })
    const path = container.querySelector('[data-cad-hit-area]')?.getAttribute('d')
    expect(path).not.toMatch(/NaN|Infinity|L/)
    expect(path?.match(/M/g)).toHaveLength(2)
  })

  it('does not create a control point from an empty drawing or a hidden viewport', () => {
    const { svg, onPickPoint } = setup({ features: [] })
    clickPoint(svg, 600, 250)
    expect(onPickPoint).not.toHaveBeenCalled()
    vi.mocked(svg.getBoundingClientRect).mockReturnValue({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    } as DOMRect)
    clickPoint(svg, 600, 250)
    expect(onPickPoint).not.toHaveBeenCalled()
  })
})
