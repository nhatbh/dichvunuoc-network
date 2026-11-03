import { describe, expect, it } from 'vitest';
import proj4 from 'proj4';
import { registerVietnamCrs } from './crs.js';

describe('registerVietnamCrs', () => {
  it('registers VN-2000 UTM 48N definitions (idempotent)', () => {
    registerVietnamCrs();
    registerVietnamCrs(); // second call is a no-op
    expect(proj4.defs('EPSG:3405')).toBeTruthy();
    expect(proj4.defs('EPSG:9210')).toBeTruthy();
  });
});
