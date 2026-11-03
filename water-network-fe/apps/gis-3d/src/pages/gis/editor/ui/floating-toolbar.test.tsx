import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, it, expect, vi } from 'vitest';
import { FloatingToolbar } from './floating-toolbar';
import type { EditorAction } from '../actions';

const noop = () => {};
const acts: EditorAction[] = [
  { id: 'edit', label: 'Sửa', icon: 'IcPencil', quick: true, enabledFor: () => true, run: noop },
  { id: 'reverse', label: 'Đảo chiều', icon: 'IcRefresh', quick: true, enabledFor: () => true, run: noop },
];

describe('FloatingToolbar', () => {
  it('renders quick actions and fires onPick / onMore', () => {
    const onPick = vi.fn(); const onMore = vi.fn();
    render(() => <FloatingToolbar open x={10} y={10} actions={acts} onPick={onPick} onMore={onMore} />);
    fireEvent.click(screen.getByTitle('Sửa'));
    expect(onPick).toHaveBeenCalledWith('edit');
    fireEvent.click(screen.getByTitle('Thêm lệnh'));
    expect(onMore).toHaveBeenCalled();
  });
});
