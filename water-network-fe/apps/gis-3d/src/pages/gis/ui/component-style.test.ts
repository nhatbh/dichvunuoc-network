import { describe, expect, it } from 'vitest'
import { hostBearing, materialCode, sourceCode, valveCode } from './component-style'

const identity = (x: number, y: number): [number, number] => [x, y]

describe('component-style', () => {
  it('maps valve kinds, materials and sources to catalog codes', () => {
    expect(valveCode('butterfly')).toBe('ButterflyValve')
    expect(valveCode('boundary')).toBe('GateValve')
    expect(valveCode(undefined)).toBe('GateValve')
    expect(materialCode('Gang dẻo')).toBe('DuctileIron')
    expect(materialCode('unknown')).toBeUndefined()
    expect(sourceCode('reservoir')).toBe('Reservoir')
    expect(sourceCode('plant')).toBe('Source')
  })

  it('takes the bearing of the nearest pipe segment, clockwise from north', () => {
    const pipe = { pts: [[0, 0], [0, 10]] as [[number, number], [number, number]], vertices: [[0, 0], [0, 10], [10, 10]] as [number, number][] }
    expect(hostBearing({ x: 0.2, y: 3 }, pipe, identity)).toBeCloseTo(0)     // first segment runs north
    expect(hostBearing({ x: 6, y: 10.1 }, pipe, identity)).toBeCloseTo(90)  // second runs east
    expect(hostBearing({ x: 0, y: 0 }, undefined, identity)).toBeUndefined()
  })
})
