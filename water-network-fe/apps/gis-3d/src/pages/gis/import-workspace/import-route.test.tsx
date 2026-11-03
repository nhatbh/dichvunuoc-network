import { render, screen, waitFor } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GisRuntimePage } from '../gis-runtime-page'

vi.mock('@/entities/session', () => ({ useSessionContext: () => ({ session: () => null }) }))
vi.mock('@/shared/lib/cross-app-sso', () => ({ navigateToMenuApp: vi.fn() }))
vi.mock('../gis-home', () => ({ GisHome: () => <div>Canonical GIS home</div> }))
vi.mock('../legacy-gis-home', () => ({ LegacyGisHome: () => <div>Legacy GIS home</div> }))
vi.mock('../map-page', () => ({ MapPage: () => <div>Scalable GIS map</div> }))
vi.mock('../network-editor/workspace', () => ({
  NetworkEditor: () => <div>Published network editor</div>,
}))
vi.mock('../screens/import', () => ({ ImportScreen: () => <div>CAD import workspace</div> }))
vi.mock('@/shared/config/runtime-config', () => ({
  getGisRuntimePolicy: () => ({ dataSource: 'canonical', viewerMode: 'rich' }),
}))
afterEach(() => {
  window.location.hash = ''
})

describe('Import entry independent of published network', () => {
  it.each(['#import', '#map-drafts'])(
    'opens %s without requiring a published network',
    async route => {
      window.location.hash = route
      render(() => <GisRuntimePage />)
      expect(await screen.findByText('CAD import workspace')).toBeInTheDocument()
      expect(screen.getByTestId('gis-shell')).toBeInTheDocument()
      expect(screen.queryByText('Canonical GIS home')).not.toBeInTheDocument()
    }
  )
  it('opens the published network editor separately from CAD import', async () => {
    window.location.hash = '#editor'
    render(() => <GisRuntimePage />)
    expect(await screen.findByText('Published network editor')).toBeInTheDocument()
    expect(screen.queryByText('CAD import workspace')).not.toBeInTheDocument()
  })
  it('responds to navigation into and out of import', async () => {
    window.location.hash = '#dashboard'
    render(() => <GisRuntimePage />)
    expect(screen.getByText('Canonical GIS home')).toBeInTheDocument()
    window.location.hash = '#import'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(await screen.findByText('CAD import workspace')).toBeInTheDocument()
    window.location.hash = '#dashboard'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await waitFor(() => expect(screen.queryByText('CAD import workspace')).not.toBeInTheDocument())
    expect(screen.getByText('Canonical GIS home')).toBeInTheDocument()
  })
})
