import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, it, expect, vi } from 'vitest';
import { ShortcutHelp } from './shortcut-help';

describe('ShortcutHelp', () => {
  it('lists every shortcut when open', () => {
    render(() => <ShortcutHelp open onClose={() => {}} />);
    expect(screen.getByText('Đảo chiều tuyến')).toBeTruthy();
  });
  it('renders nothing when closed', () => {
    render(() => <ShortcutHelp open={false} onClose={() => {}} />);
    expect(screen.queryByText('Đảo chiều tuyến')).toBeNull();
  });
  it('closes on Escape when open', () => {
    const onClose = vi.fn();
    render(() => <ShortcutHelp open onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
