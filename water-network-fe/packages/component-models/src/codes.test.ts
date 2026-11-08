import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalogCodeList } from './codes.js';

const current = JSON.parse(JSON.stringify(catalogCodeList()));
const read = (rel: string) => (JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as { codes: unknown[] }).codes;

// every copy of the list (decision 0028); run `npm run codes` after changing the catalog
const COPIES = [
  '../../contracts/src/catalog/codes.json',
  '../../../../water-network-import/src/wn_import/catalog_codes.json',
  '../../../../water-network-be/src/building-blocks/src/WaterPlatform.BuildingBlocks.Components/component-codes.json',
];

describe('component code list', () => {
  for (const rel of COPIES)
    it(`matches the copy at ${rel.replace(/^(\.\.\/)+/, '')}`, () => {
      if (!existsSync(new URL(rel, import.meta.url))) return; // the package outside the monorepo
      expect(read(rel)).toEqual(current);
    });

  it('gives every code a kind, a host and its properties', () => {
    const list = catalogCodeList();
    expect(new Set(list.map((c) => c.code)).size).toBe(list.length);
    const by = new Map(list.map((c) => [c.code, c]));
    expect(by.get('Pipe')).toMatchObject({ kind: 'Pipe', host: 'line' });
    expect(by.get('Tee')).toMatchObject({ kind: 'Node', host: 'none', functions: ['connects'] });
    expect(by.get('Reservoir')).toMatchObject({ kind: 'Node', functions: ['stores'] });
    expect(by.get('GateValve')).toMatchObject({ kind: 'Device', host: 'pipe', functions: ['isolates'] });
    expect(by.get('CheckValve')!.functions).toEqual(['controls']);
    expect(by.get('Pump')).toMatchObject({ kind: 'Device', host: 'pipe', functions: ['pumps'] });
    expect(by.get('Hydrant')).toMatchObject({ kind: 'Device', host: 'node', functions: ['fireFlow'] });
    expect(by.get('AirValve')).toMatchObject({ kind: 'Device', host: 'node' });
    const keys = (code: string) => by.get(code)!.properties.map((p) => p.key);
    expect(keys('Reducer')).toEqual(expect.arrayContaining(['dn', 'dn2', 'material', 'elevationM']));
    expect(keys('PRV')).toEqual(expect.arrayContaining(['dn', 'state', 'setpoint']));
    expect(keys('Pipe')).not.toContain('dn');
  });
});
