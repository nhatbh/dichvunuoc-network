import { fireEvent, render, screen } from '@solidjs/testing-library'
import { createFakePort } from '@wn/map-runtime-3d/testing'
import { describe, expect, it } from 'vitest'
import { Map3DControls } from './map-3d-controls'

describe('Map3DControls', () => {
  it('toggles 3D mode, tilts, rotates, and toggles buildings / terrain through the port', async () => {
    const port = createFakePort()
    render(() => <Map3DControls port={() => port} />)

    fireEvent.click(screen.getByTestId('map-3d-toggle'))
    expect(port.set3DMode).toHaveBeenCalledWith(true)
    expect(screen.getByTestId('map-3d-toggle').getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByTestId('map-tilt-up'))
    expect(port.setCamera).toHaveBeenLastCalledWith({ pitch: 70 })

    fireEvent.click(screen.getByTestId('map-rotate-right'))
    expect(port.setCamera).toHaveBeenLastCalledWith({ bearing: 5 })

    fireEvent.click(screen.getByTestId('map-compass'))
    expect(port.resetNorth).toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('map-buildings-toggle'))
    expect(port.setBuildings).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByTestId('map-flow-toggle'))
    expect(port.setFlowAnimation).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByTestId('map-terrain-toggle'))
    expect(port.setTerrain).toHaveBeenCalledWith({ enabled: true, exaggeration: 1.5 })
  })
})
