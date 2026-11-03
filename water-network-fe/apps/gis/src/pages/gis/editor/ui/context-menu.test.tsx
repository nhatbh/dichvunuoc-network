import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, it, expect, vi } from 'vitest';
import { ContextMenu } from './context-menu';
import type { EditorAction } from '../actions';

const noop = () => {};
const acts: EditorAction[] = [
  { id: 'edit', label: 'Sửa thuộc tính', icon: 'IcPencil', enabledFor: () => true, run: noop },
  { id: 'delete', label: 'Đánh dấu xoá', icon: 'IcTrash', danger: true, enabledFor: () => true, run: noop },
];

describe('ContextMenu', () => {
  it('renders one row per action and fires onPick', () => {
    const onPick = vi.fn();
    render(() => <ContextMenu open x={10} y={10} label="Ống P-1" actions={acts} onPick={onPick} onClose={noop} />);
    expect(screen.getByText('Sửa thuộc tính')).toBeTruthy();
    fireEvent.click(screen.getByText('Đánh dấu xoá'));
    expect(onPick).toHaveBeenCalledWith('delete');
  });

  it('renders nothing when closed', () => {
    render(() => <ContextMenu open={false} x={0} y={0} actions={acts} onPick={noop} onClose={noop} />);
    expect(screen.queryByText('Sửa thuộc tính')).toBeNull();
  });
});
