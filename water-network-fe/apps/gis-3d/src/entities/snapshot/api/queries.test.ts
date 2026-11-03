import { describe, it, expect } from 'vitest';
import { aSnapshot } from '@wn/contracts/testing';
import { snapshotSchema } from '../model/types';

// Proves the published @wn/contracts package resolves and validates inside the
// app (consumption proof for US-001).
describe('snapshot contract consumed from @wn/contracts', () => {
  it('parses a valid BE snapshot payload', () => {
    const parsed = snapshotSchema.parse(aSnapshot());
    expect(parsed.status).toBe('published');
    expect(parsed.featureCount).toBe(42);
  });

  it('rejects an invalid status', () => {
    expect(() => snapshotSchema.parse({ ...aSnapshot(), status: 'nope' })).toThrow();
  });
});
