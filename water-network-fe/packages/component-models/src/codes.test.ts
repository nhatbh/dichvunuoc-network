import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalogCodeList } from './codes.js';

const exported = JSON.parse(
  readFileSync(new URL('../../contracts/src/catalog/codes.json', import.meta.url), 'utf8'),
) as { codes: unknown[] };

describe('component code list', () => {
  it('matches the list exported to @wn/contracts (run `npm run codes` after changing the catalog)', () => {
    expect(exported.codes).toEqual(JSON.parse(JSON.stringify(catalogCodeList())));
  });

  it('has unique codes and maps the gis-be device types', () => {
    const list = catalogCodeList();
    expect(new Set(list.map((c) => c.code)).size).toBe(list.length);
    const by = new Map(list.map((c) => [c.code, c]));
    expect(by.get('GateValve')).toMatchObject({ host: 'pipe', gisDeviceType: 'Valve' });
    expect(by.get('BulkMeter')).toMatchObject({ host: 'pipe', gisDeviceType: 'FlowMeter' });
    expect(by.get('Hydrant')).toMatchObject({ host: 'node', gisDeviceType: 'Hydrant' });
    expect(by.get('Tee')).toMatchObject({ host: 'node', gisDeviceType: null });
    expect(by.get('Pipe')?.host).toBe('line');
  });
});
