import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalogCodeList } from './codes.js';

const exported = JSON.parse(
  readFileSync(new URL('../../contracts/src/catalog/codes.json', import.meta.url), 'utf8'),
) as { codes: unknown[] };

describe('component code list', () => {
  it('matches the list exported to @wn/contracts (run `npm run codes` after changing the catalog)', () => {
    expect(exported.codes).toEqual(JSON.parse(JSON.stringify(catalogCodeList())));
  });

  it('matches the copy the CAD import service validates against (water-network-import)', () => {
    const copy = new URL('../../../../water-network-import/src/wn_import/catalog_codes.json', import.meta.url);
    if (!existsSync(copy)) return; // the package outside the monorepo
    const codes = (JSON.parse(readFileSync(copy, 'utf8')) as { codes: unknown[] }).codes;
    expect(codes).toEqual(JSON.parse(JSON.stringify(catalogCodeList())));
  });

  it('has unique codes and maps the gis-be device types', () => {
    const list = catalogCodeList();
    expect(new Set(list.map((c) => c.code)).size).toBe(list.length);
    const by = new Map(list.map((c) => [c.code, c]));
    expect(by.get('GateValve')).toMatchObject({ host: 'pipe', gisDeviceType: 'Valve' });
    expect(by.get('BulkMeter')).toMatchObject({ host: 'pipe', gisDeviceType: 'FlowMeter' });
    expect(by.get('Hydrant')).toMatchObject({ host: 'node', gisDeviceType: 'Hydrant' });
    expect(by.get('Tee')).toMatchObject({ host: 'node', gisKind: 'Node', gisNodeType: 'Junction', gisDeviceType: null });
    expect(by.get('Pipe')).toMatchObject({ host: 'line', gisKind: 'Pipe' });
    // gis-be hosts pumps on nodes, whatever the catalog role
    expect(by.get('Pump')).toMatchObject({ host: 'node', gisKind: 'Device', gisDeviceType: 'Pump' });
    expect(by.get('Reservoir')).toMatchObject({ gisKind: 'Node', gisNodeType: 'Reservoir' });
    expect(by.get('AirValve')).toMatchObject({ gisKind: 'Node', gisNodeType: 'Other' });
  });
});
