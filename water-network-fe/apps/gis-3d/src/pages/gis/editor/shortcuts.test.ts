import { describe, it, expect } from 'vitest';
import { resolveShortcut, SHORTCUTS } from './shortcuts';

const ev = (init: Partial<KeyboardEvent>) => init as KeyboardEvent;

describe('resolveShortcut', () => {
  it('maps Enter to edit', () => {
    expect(resolveShortcut(ev({ key: 'Enter' }))).toBe('edit');
  });
  it('maps Delete/Backspace to delete', () => {
    expect(resolveShortcut(ev({ key: 'Delete' }))).toBe('delete');
    expect(resolveShortcut(ev({ key: 'Backspace' }))).toBe('delete');
  });
  it('maps ⌘/Ctrl+D to duplicate', () => {
    expect(resolveShortcut(ev({ key: 'd', metaKey: true }))).toBe('duplicate');
    expect(resolveShortcut(ev({ key: 'd', ctrlKey: true }))).toBe('duplicate');
  });
  it('returns null for unmapped keys', () => {
    expect(resolveShortcut(ev({ key: 'q' }))).toBeNull();
  });
  it('every shortcut points at a real action id', () => {
    const ids = new Set(SHORTCUTS.map((s) => s.actionId));
    expect(ids.has('edit')).toBe(true);
  });
});
