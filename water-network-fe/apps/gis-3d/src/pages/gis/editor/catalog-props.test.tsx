import { fireEvent, render, screen } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'
import { CatalogProps, catalogFields, propertyProblem } from './catalog-props'

describe('catalog properties in the editor', () => {
  it('are the ones the catalog declares for the component', () => {
    const keys = catalogFields('ReducingTee', ['dma']).map(f => f.key)
    expect(keys).toEqual(expect.arrayContaining(['dn', 'dn2', 'material', 'year', 'condition']))
    expect(keys).not.toContain('dma')
    expect(catalogFields('GateValve').map(f => f.key)).toContain('state')
  })

  it('are checked as gis-be checks them', () => {
    expect(propertyProblem('ReducingTee', 'dn2', '90')).toBeUndefined()
    expect(propertyProblem('ReducingTee', 'dn2', '40')).toMatch(/dn2/)
    expect(propertyProblem('Bend', 'angle', 'abc')).toBeDefined()
  })

  it('edit through the form, and read-only shows only the values present', () => {
    const onChange = vi.fn()
    const { unmount } = render(() => <CatalogProps code="Bend" values={{ dn: '110', angle: '200' }} onChange={onChange} />)
    expect(screen.getByText(/Góc/)).toBeInTheDocument()
    expect(screen.getByText(/angle/)).toBeInTheDocument() // the out-of-range angle is flagged
    fireEvent.input(screen.getByDisplayValue('110'), { target: { value: '160' } })
    expect(onChange).toHaveBeenCalledWith('dn', '160')
    unmount()
    render(() => <CatalogProps code="Bend" values={{ dn: '110' }} />)
    expect(screen.getByText('110')).toBeInTheDocument()
    expect(screen.queryByText(/Góc/)).not.toBeInTheDocument()
  })
})
