import { fireEvent, render, screen } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'
import { ED_TOOLS } from './model'
import { EdMenuBar, EdOptionsBar, EdToolStrip } from './workspace-chrome'

describe('EdMenuBar', () => {
  it('opens a menu, runs an item and closes; disabled items do nothing', () => {
    const save = vi.fn()
    const never = vi.fn()
    render(() => (
      <EdMenuBar menus={[{ id: 'file', label: 'Tệp', items: [{ label: 'Lưu nháp', kbd: 'Ctrl+S', onClick: save }, 'sep', { label: 'Khoá', onClick: never, disabled: true }] }]} />
    ))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tệp' }))
    expect(screen.getByText('Ctrl+S')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Khoá'))
    expect(never).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Lưu nháp'))
    expect(save).toHaveBeenCalled()
    expect(screen.queryByText('Ctrl+S')).toBeNull()
  })
})

describe('EdToolStrip', () => {
  it('lists every tool, marks the active one and switches tools', () => {
    const setTool = vi.fn()
    render(() => <EdToolStrip tool="pipe" setTool={setTool} />)
    expect(screen.getAllByRole('button')).toHaveLength(ED_TOOLS.length)
    expect(screen.getByRole('button', { name: 'Vẽ tuyến ống' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Đặt van' }))
    expect(setTool).toHaveBeenCalledWith('valve')
  })

  it('shows a tooltip with name, command and hint on hover', async () => {
    vi.useFakeTimers()
    render(() => <EdToolStrip tool="select" setTool={vi.fn()} />)
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Tách ống' }))
    vi.advanceTimersByTime(400)
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Tách ống')
    expect(tip).toHaveTextContent('SP')
    expect(tip).toHaveTextContent('chèn nút tách')
    vi.useRealTimers()
  })
})

describe('EdOptionsBar', () => {
  const base = {
    locked: false,
    run: vi.fn(),
    can: (id: string) => id === 'deselect',
    defaults: { pipe: { dn: 200, material: 'HDPE', trunk: false, cond: 'good' }, valve: { dn: 200, vkind: 'gate' } },
    setDefaults: vi.fn(),
    materials: ['HDPE', 'uPVC'],
    offsetDist: 2,
    setOffsetDist: vi.fn(),
    snap: true,
    setSnap: vi.fn(),
    snapModes: { node: true, vertex: true, edge: true, grid: false },
    setSnapModes: vi.fn(),
    ortho: false,
    setOrtho: vi.fn(),
  }

  it('select tool: shows the selection and runs selection commands', () => {
    const run = vi.fn()
    render(() => <EdOptionsBar {...base} run={run} tool={ED_TOOLS[0]!} selection={{ count: 2, detail: '2 ống' }} />)
    expect(screen.getByTestId('selection-summary')).toHaveTextContent('2 đã chọn · 2 ống')
    fireEvent.click(screen.getByRole('button', { name: /Bỏ chọn/ }))
    expect(run).toHaveBeenCalledWith('deselect')
    expect(screen.getByRole('button', { name: /Đảo/ })).toBeDisabled()
  })

  it('pipe tool: edits the drawing defaults', () => {
    const setDefaults = vi.fn()
    render(() => <EdOptionsBar {...base} setDefaults={setDefaults} tool={ED_TOOLS.find((t) => t.id === 'pipe')!} selection={{ count: 0, detail: '' }} />)
    fireEvent.change(screen.getByLabelText('Đường kính'), { target: { value: '300' } })
    expect(setDefaults).toHaveBeenCalledWith(expect.objectContaining({ pipe: expect.objectContaining({ dn: 300 }) }))
  })
})
