import { render, fireEvent } from '@solidjs/testing-library'
import { describe, it, expect, vi } from 'vitest'
import { LayerPanel } from './layer-panel'

describe('LayerPanel', () => {
  const layers = [{ id: 'pipe', label: 'Tuyến ống', grp: 'Tài sản', on: true, count: 96 }]

  it('toggles a layer', () => {
    const onToggle = vi.fn()
    const { getByText } = render(() => <LayerPanel layers={layers} vis={{ pipe: true }} onToggle={onToggle} />)
    fireEvent.click(getByText('Tuyến ống'))
    expect(onToggle).toHaveBeenCalledWith('pipe')
  })

  it('renders layer label', () => {
    const { getByText } = render(() => <LayerPanel layers={layers} vis={{ pipe: true }} onToggle={vi.fn()} />)
    expect(getByText('Tuyến ống')).toBeInTheDocument()
  })

  it('groups layers by grp', () => {
    const multiLayers = [
      { id: 'pipe', label: 'Tuyến ống', grp: 'Tài sản', on: true, count: 93 },
      { id: 'dma', label: 'Ranh giới DMA', grp: 'Phân vùng', on: true, count: 5 },
    ]
    const { getByText } = render(() => <LayerPanel layers={multiLayers} vis={{ pipe: true, dma: true }} onToggle={vi.fn()} />)
    expect(getByText('Tài sản')).toBeInTheDocument()
    expect(getByText('Phân vùng')).toBeInTheDocument()
  })

  it('does not toggle locked layers', () => {
    const onToggle = vi.fn()
    const lockedLayers = [{ id: 'basemap', label: 'Nền bản đồ', grp: 'Nền', on: true, lock: true }]
    const { getByText } = render(() => <LayerPanel layers={lockedLayers} vis={{ basemap: true }} onToggle={onToggle} />)
    fireEvent.click(getByText('Nền bản đồ'))
    expect(onToggle).not.toHaveBeenCalled()
  })
})
