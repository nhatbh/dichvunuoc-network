import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, it, expect, vi } from 'vitest';
import { CommandPalette } from './command-palette';
import type { EditorAction } from '../actions';

const noop = () => {};
const acts: EditorAction[] = [
  { id: 'reverse', label: 'Đảo chiều tuyến', icon: 'IcRefresh', enabledFor: () => true, run: noop },
  { id: 'offset', label: 'Vẽ song song', icon: 'IcOffset', enabledFor: () => true, run: noop },
];

describe('CommandPalette', () => {
  it('filters by query and runs the picked command', async () => {
    const onRun = vi.fn();
    const onClose = vi.fn();
    render(() => <CommandPalette open actions={acts} onRun={onRun} onClose={onClose} />);
    const input = screen.getByPlaceholderText('Tìm lệnh…') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'song' } });
    expect(screen.queryByText('Đảo chiều tuyến')).toBeNull();
    fireEvent.click(screen.getByText('Vẽ song song'));
    expect(onRun).toHaveBeenCalledWith('offset');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
