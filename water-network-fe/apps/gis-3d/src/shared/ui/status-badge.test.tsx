import { describe, expect, it } from 'vitest'
import { render, screen } from '@solidjs/testing-library'
import { StatusBadge } from './status-badge'

describe('StatusBadge', () => {
  it('renders the status label', () => {
    render(() => <StatusBadge status="published" />)
    expect(screen.getByText('published')).toBeInTheDocument()
  })

  it('uses green treatment for published', () => {
    render(() => <StatusBadge status="published" />)
    expect(screen.getByTestId('status-badge')).toHaveClass('text-green-700')
  })

  it('uses green treatment for passed', () => {
    render(() => <StatusBadge status="passed" />)
    expect(screen.getByTestId('status-badge')).toHaveClass('text-green-700')
  })

  it('uses amber treatment for draft', () => {
    render(() => <StatusBadge status="draft" />)
    expect(screen.getByTestId('status-badge')).toHaveClass('text-amber-700')
  })

  it('uses rose treatment for retired', () => {
    render(() => <StatusBadge status="retired" />)
    expect(screen.getByTestId('status-badge')).toHaveClass('text-rose-700')
  })

  it('falls back to slate for an unknown status (case-insensitive)', () => {
    render(() => <StatusBadge status="Whatever" />)
    const el = screen.getByTestId('status-badge')
    expect(el).toHaveClass('text-slate-700')
    expect(screen.getByText('Whatever')).toBeInTheDocument()
  })
})
