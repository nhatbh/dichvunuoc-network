/**
 * Button (Solid + Kobalte) — basic smoke tests.
 */

import { fireEvent, render, screen } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './shadcn/button'

describe('Button', () => {
  it('renders children', () => {
    render(() => <Button>Click me</Button>)
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument()
  })

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn()
    render(() => <Button onClick={handleClick}>Click me</Button>)
    fireEvent.click(screen.getByRole('button'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('honours the disabled prop', () => {
    render(() => <Button disabled>Disabled</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('applies variant classes', () => {
    render(() => <Button variant="secondary">Secondary</Button>)
    expect(screen.getByRole('button')).toHaveClass('bg-secondary')
  })

  it('applies size classes', () => {
    render(() => <Button size="sm">Small</Button>)
    expect(screen.getByRole('button')).toHaveClass('h-9')
  })
})
