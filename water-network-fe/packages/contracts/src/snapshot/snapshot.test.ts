import { describe, expect, it } from 'vitest';
import { PublishedNetworkSnapshot } from './index.js';
import { aSnapshot } from '../testing/index.js';

describe('PublishedNetworkSnapshot contract', () => {
  it('round-trips a valid BE-shaped payload', () => {
    const payload = aSnapshot();
    const parsed = PublishedNetworkSnapshot.parse(payload);
    expect(parsed).toEqual(payload);
  });

  it('rejects an invalid status', () => {
    const bad = { ...aSnapshot(), status: 'archived' };
    expect(() => PublishedNetworkSnapshot.parse(bad)).toThrow();
  });

  it('allows a not-yet-published snapshot', () => {
    const draft = aSnapshot({ status: 'draft', publishedAt: null });
    expect(PublishedNetworkSnapshot.parse(draft).publishedAt).toBeNull();
  });
});
