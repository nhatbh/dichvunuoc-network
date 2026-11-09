import { fireEvent, render, screen } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import { GisProvider, type GisData } from '../lib/gis-data'
import type { CanvasSel, Draft } from './model'
import { PropBody } from './panels'
import type { Asset } from './revision-model'

const G = { canonical: true, MATERIALS: ['HDPE'], COND: {}, dmas: [], pipeBy: {} } as unknown as GisData
const tee: Asset = {
  draftAssetId: 'tee', kind: 'Node', assetCode: 'N-TEE', clientRef: null,
  geometry: { type: 'Point', coordinates: [[105.5, 21.17]] },
  attributes: { componentCode: 'ReducingTee', dn: '225', dn2: '110', material: 'HDPE' }, fromRef: null, toRef: null, hostRef: null,
}
const draft: Draft = { id: 'DRF-Mtee', op: 'mod', baseId: 'tee', kind: 'node', geom: 'point', x: 1, y: 1, ntype: 'ReducingTee', dma: '', props: { dn: '225', dn2: '110', material: 'HDPE' } }

function mount() {
  const [sel, setSel] = createSignal<CanvasSel>({ base: { type: 'node', id: 'tee' } })
  const onUpdate = vi.fn()
  const onBaseAction = vi.fn()
  render(() => (
    <GisProvider data={G}>
      <PropBody sel={sel()} drafts={[draft]} onUpdate={onUpdate} onRemove={() => {}} onAttach={() => {}} onBaseAction={onBaseAction} baseAsset={id => (id === 'tee' ? tee : undefined)} />
    </GisProvider>
  ))
  return { setSel, onUpdate, onBaseAction }
}

describe('editor property panel on the live network', () => {
  it('shows a published fitting by code, component and catalog properties', () => {
    mount()
    expect(screen.getByText('N-TEE')).toBeInTheDocument()
    expect(screen.getByText(/Tê thu/)).toBeInTheDocument()
    expect(screen.getByText('110')).toBeInTheDocument()
  })

  it('follows the selection to the "Sửa" draft and edits its catalog properties', () => {
    const { setSel, onUpdate } = mount()
    setSel('DRF-Mtee')
    expect(screen.getByTestId('catalog-props')).toBeInTheDocument()
    fireEvent.input(screen.getByDisplayValue('110'), { target: { value: '90' } })
    expect(onUpdate).toHaveBeenCalledWith('DRF-Mtee', { props: { dn: '225', dn2: '90', material: 'HDPE' } })
    expect(screen.queryByText(/EAM/)).not.toBeInTheDocument()
  })
})
