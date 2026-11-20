import { describe, expect, it } from 'vitest'
import { NET, solveNetwork } from '../data/network-model'
import { PLANT } from '../data/plant-model'
import { PlantSim } from './plant-sim'

const run = (sim: PlantSim, seconds: number) => {
  for (let i = 0; i < seconds * 2; i++) sim.advance(0.5)
}

describe('PlantSim', () => {
  it('starts in a steady, plausible state', () => {
    const sim = new PlantSim()
    expect(sim.qOut).toBeGreaterThan(400)
    expect(sim.pOut).toBeGreaterThan(3)
    expect(sim.pOut).toBeLessThan(5.5)
    expect(sim.reservoirPct).toBeGreaterThan(20)
    expect(sim.filteredTurb).toBeLessThan(1)
  })

  it('loses outlet pressure and raises an alarm when every clean-water pump is stopped', () => {
    const sim = new PlantSim()
    sim.speed = 10
    for (const t of ['P-NS-01', 'P-NS-02', 'P-NS-03']) sim.command(t, 'stop')
    run(sim, 6)
    expect(sim.qOut).toBe(0)
    expect(sim.pOut).toBeLessThan(1)
    expect(sim.activeAlarms.some(a => a.tag === 'PT-701')).toBe(true)
  })

  it('runs a filter backwash through its phases back to filtering', () => {
    const sim = new PlantSim()
    sim.speed = 300
    sim.command('F-501', 'wash')
    expect(sim.dev['F-501']!.phase).toBe('drain')
    run(sim, 30)
    expect(sim.dev['F-501']!.phase).toBe('filter')
    expect(sim.dev['F-501']!.headloss).toBeLessThan(0.5)
  })
})

describe('network + plant model from CAD', () => {
  it('reads the drawings: 43 distribution pipes, 27 valves, service lines and the plant structures', () => {
    expect(NET.pipes.filter(p => p.kind === 'trunk' || p.kind === 'dist').length).toBeGreaterThanOrEqual(43)
    expect(NET.valves).toHaveLength(27)
    expect(NET.pipes.filter(p => p.kind === 'service').length).toBeGreaterThan(700)
    expect(PLANT.structures.map(s => s.no)).toEqual(expect.arrayContaining([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]))
  })

  it('cuts supply downstream of a closed valve', () => {
    const base = { entryHead: 40, qZone: 150, qOut: 1300, qRaw: 1400, demandFactor: 1 }
    const open = solveNetwork({ ...base, closedValves: new Set() })
    expect(open.unsupplied).toBe(0)
    const shut = solveNetwork({ ...base, closedValves: new Set(NET.valves.map(v => v.code)) })
    expect(shut.unsupplied).toBeGreaterThan(0)
    expect(open.minP).toBeGreaterThan(20)
  })
})
