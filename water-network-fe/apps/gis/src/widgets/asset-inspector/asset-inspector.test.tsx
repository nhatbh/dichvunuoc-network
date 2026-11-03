import { render } from '@solidjs/testing-library'
import { describe, it, expect, vi } from 'vitest'
import { AssetInspector } from './asset-inspector'
import type { Feature } from 'geojson'

function makeFeature(id: string, properties: Record<string, unknown>): Feature {
  return { type: 'Feature', id, geometry: { type: 'Point', coordinates: [0, 0] }, properties }
}

describe('AssetInspector', () => {
  it('shows feature name and code', () => {
    const f = makeFeature('PIP-0001', {
      name: 'Ống DN400 · HDPE',
      code: 'O.400.001',
      assetType: 'pipe',
      dma: 'DMA-04',
    })
    const { getByText } = render(() => (
      <AssetInspector feature={f} onClose={() => {}} onEdit={() => {}} onTrace={() => {}} />
    ))
    expect(getByText('Ống DN400 · HDPE')).toBeInTheDocument()
    expect(getByText('O.400.001')).toBeInTheDocument()
  })

  it('shows DMA chip', () => {
    const f = makeFeature('PIP-0001', {
      name: 'Ống DN400 · HDPE',
      code: 'O.400.001',
      assetType: 'pipe',
      dma: 'DMA-04',
    })
    const { getByText } = render(() => (
      <AssetInspector feature={f} onClose={() => {}} onEdit={() => {}} onTrace={() => {}} />
    ))
    expect(getByText('DMA-04')).toBeInTheDocument()
  })

  it('renders nothing when feature is null', () => {
    const { container } = render(() => (
      <AssetInspector feature={null} onClose={() => {}} onEdit={() => {}} onTrace={() => {}} />
    ))
    expect(container.firstChild).toBeNull()
  })

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn()
    const f = makeFeature('VAL-001', {
      name: 'Van biên DMA',
      code: 'V.1',
      assetType: 'valve',
      dma: 'DMA-01',
    })
    const { getByRole } = render(() => (
      <AssetInspector feature={f} onClose={onClose} onEdit={() => {}} onTrace={() => {}} />
    ))
    getByRole('button', { name: /đóng|close/i }).click()
    expect(onClose).toHaveBeenCalled()
  })

  it('hides edit and trace actions when the viewer is read-only', () => {
    const f = makeFeature('NODE-001', {
      name: 'NODE-001',
      code: 'NODE-001',
      assetType: 'node',
    })
    const { queryByRole } = render(() => <AssetInspector feature={f} onClose={() => {}} />)

    expect(queryByRole('button', { name: 'Sửa' })).not.toBeInTheDocument()
    expect(queryByRole('button', { name: 'Truy vết' })).not.toBeInTheDocument()
  })

  it('only exposes actions backed by a real callback', () => {
    const onTrace = vi.fn()
    const f = makeFeature('VAL-001', {
      name: 'VAL-001',
      code: 'VAL-001',
      assetType: 'valve',
    })
    const { getByRole, queryByRole } = render(() => (
      <AssetInspector feature={f} onClose={() => {}} onTrace={onTrace} />
    ))

    expect(queryByRole('button', { name: 'Sửa' })).not.toBeInTheDocument()
    getByRole('button', { name: 'Truy vết' }).click()
    expect(onTrace).toHaveBeenCalledOnce()
  })
})
