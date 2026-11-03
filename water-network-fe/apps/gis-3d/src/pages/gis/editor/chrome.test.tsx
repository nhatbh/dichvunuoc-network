import { render, screen } from '@solidjs/testing-library'
import { describe, it, expect, vi } from 'vitest'
import { scSeed } from '../lib/branch-store'
import { EdBranchGate } from './chrome'

describe('EdBranchGate', () => {
  it('renders the branch picker with lifecycle sections and stats', () => {
    render(() => <EdBranchGate branches={scSeed()} onBlank={vi.fn()} onClone={vi.fn()} onOpen={vi.fn()} onExit={vi.fn()} />)
    expect(screen.getByText('Chọn bản làm việc')).toBeInTheDocument()
    expect(screen.getByText('Tạo bản trắng')).toBeInTheDocument()
    // seeded official branch surfaces in the "Bản chính thức" section
    expect(screen.getByText('Hiện trạng mạng lưới')).toBeInTheDocument()
  })

  it('opens an editable (draft) branch and clones a locked (official) one', () => {
    const onOpen = vi.fn()
    const onClone = vi.fn()
    render(() => <EdBranchGate branches={scSeed()} onBlank={vi.fn()} onClone={onClone} onOpen={onOpen} onExit={vi.fn()} />)
    screen.getByText('Thay ống gang Lê Lợi').click() // review → editable → onOpen
    screen.getByText('Hiện trạng mạng lưới').click() // official → locked → onClone
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onClone).toHaveBeenCalledTimes(1)
  })
})
