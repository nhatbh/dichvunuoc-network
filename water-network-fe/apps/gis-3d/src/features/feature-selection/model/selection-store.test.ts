import { describe, expect, it } from 'vitest';
import { createRoot } from 'solid-js';
import { createSelectionStore } from './selection-store';

describe('selection-store', () => {
  it('selects and clears a feature id', () => {
    createRoot((dispose) => {
      const s = createSelectionStore();
      expect(s.selectedId()).toBeNull();
      s.select('f1');
      expect(s.selectedId()).toBe('f1');
      s.clear();
      expect(s.selectedId()).toBeNull();
      dispose();
    });
  });
});
