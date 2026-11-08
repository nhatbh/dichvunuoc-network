// The server's own cases (gis-be NetworkEditValidationTests) plus the rules the editor depends on.
import { describe, expect, it } from 'vitest';
import { inspectNetworkEdits, type EditAsset, type EditOperation, type EditState } from './index.js';

const node = (id: string, x = 105): EditAsset => ({
  draftAssetId: id, kind: 'Node', assetCode: id, clientRef: id,
  geometry: { type: 'Point', coordinates: [[x, 21]] }, attributes: { componentCode: 'Junction' },
  fromRef: null, toRef: null, hostRef: null,
});
const pipe = (): EditAsset => ({
  draftAssetId: 'p', kind: 'Pipe', assetCode: 'P1', clientRef: 'p',
  geometry: { type: 'LineString', coordinates: [[105, 21], [105.001, 21]] },
  attributes: { diameterMm: '100', material: 'HDPE' }, fromRef: 'n1', toRef: 'n2', hostRef: null,
});
const state = (): EditState => ({
  n1: { asset: node('n1'), version: 2 },
  n2: { asset: node('n2', 105.001), version: 0 },
  p: { asset: pipe(), version: 0 },
});
const op = (id: string, action: EditOperation['action'], kind: EditOperation['kind'], targetId: string | null, expectedVersion: number | null, after: EditAsset | null, before: EditAsset | null = null): EditOperation =>
  ({ id, action, kind, targetId, expectedVersion, after, before });

describe('inspectNetworkEdits (port of gis-be NetworkEditValidator)', () => {
  it('deleting a connected node explains the dependent pipe', () => {
    const r = inspectNetworkEdits(state(), [op('op', 'Delete', 'Node', 'n1', 2, null)]);
    expect(r.errors.some((x) => x.code === 'DEPENDENCY' && x.message.includes('P1'))).toBe(true);
  });
  it('deleting pipe and node together is valid', () => {
    const r = inspectNetworkEdits(state(), [op('a', 'Delete', 'Node', 'n1', 2, null), op('b', 'Delete', 'Pipe', 'p', 0, null)]);
    expect(r.errors).toEqual([]);
  });
  it('wrong version and unknown target are conflicts', () => {
    const r = inspectNetworkEdits(state(), [op('a', 'Delete', 'Node', 'n1', 1, null), op('b', 'Delete', 'Node', 'foreign', 0, null)]);
    expect(r.errors.filter((x) => x.code === 'TARGET_CONFLICT')).toHaveLength(2);
  });
  it('before comes from the server, not the client', () => {
    const r = inspectNetworkEdits(state(), [op('a', 'Update', 'Node', 'n1', 2, { ...node('a'), assetCode: 'n1' }, node('forged'))]);
    expect(r.operations[0]!.before!.assetCode).toBe('n1');
  });
  it('moving a node requires updating the connected pipe geometry', () => {
    const r = inspectNetworkEdits(state(), [op('a', 'Update', 'Node', 'n1', 2, { ...node('a', 106), assetCode: 'n1' })]);
    expect(r.errors.some((x) => x.code === 'ENDPOINT_POSITION')).toBe(true);
  });
  it('a new pipe resolves new and existing nodes', () => {
    const p = { ...pipe(), draftAssetId: 'b', assetCode: 'P2', fromRef: 'a', toRef: 'n2' };
    const r = inspectNetworkEdits(state(), [op('a', 'Add', 'Node', null, null, node('a')), op('b', 'Add', 'Pipe', null, null, p)]);
    expect(r.errors).toEqual([]);
  });

  it('rejects the editor shapes the server does not accept', () => {
    const p = { ...pipe(), draftAssetId: 'b', assetCode: 'ONG-1', fromRef: null, toRef: null, attributes: { dn: '100', material: 'Gang dẻo' } };
    const codes = inspectNetworkEdits(state(), [op('b', 'Add', 'Pipe', null, null, p)]).errors.map((e) => e.code);
    expect(codes).toContain('DIAMETER');
    expect(codes).toContain('INVALID_PROPERTIES');
  });
  it('requires after.draftAssetId to be the operation id, also for updates', () => {
    const r = inspectNetworkEdits(state(), [op('a', 'Update', 'Node', 'n1', 2, { ...node('n1') })]);
    expect(r.errors.map((e) => e.code)).toContain('INVALID_OPERATION');
  });
  const dev = (id: string, code: string, host: string, props: Record<string, string> = {}): EditAsset => ({
    ...node(id), kind: 'Device', attributes: { componentCode: code, ...props }, hostRef: host,
  });
  it('hosts devices where the catalog says', () => {
    expect(inspectNetworkEdits(state(), [op('h', 'Add', 'Device', null, null, dev('h', 'Hydrant', 'n1'))]).errors).toEqual([]);
    expect(inspectNetworkEdits(state(), [op('w', 'Add', 'Device', null, null, dev('w', 'Washout', 'n1'))]).errors).toEqual([]);
    expect(inspectNetworkEdits(state(), [op('v', 'Add', 'Device', null, null, dev('v', 'butterflyvalve', 'p', { state: 'closed' }))]).errors).toEqual([]);
    expect(inspectNetworkEdits(state(), [op('h', 'Add', 'Device', null, null, dev('h', 'Hydrant', 'p'))]).errors[0]!.code).toBe('INVALID_PROPERTIES');
  });
  it('rejects unknown components, components of another kind and foreign properties', () => {
    expect(inspectNetworkEdits(state(), [op('x', 'Add', 'Device', null, null, dev('x', 'Valve', 'p'))]).errors[0]!.code).toBe('COMPONENT');
    expect(inspectNetworkEdits(state(), [op('y', 'Add', 'Device', null, null, dev('y', 'Tee', 'p'))]).errors[0]!.code).toBe('COMPONENT');
    const foreign = inspectNetworkEdits(state(), [op('z', 'Add', 'Device', null, null, dev('z', 'GateValve', 'p', { setpoint: '3' }))]).errors[0]!;
    expect(foreign.code).toBe('INVALID_PROPERTIES');
    expect(foreign.message).toContain('setpoint');
  });
  it('keeps published asset codes and refuses duplicates', () => {
    expect(inspectNetworkEdits(state(), [op('a', 'Update', 'Node', 'n1', 2, { ...node('a'), assetCode: 'X' })]).errors[0]!.code).toBe('ASSET_CODE_IMMUTABLE');
    expect(inspectNetworkEdits(state(), [op('a', 'Add', 'Node', null, null, { ...node('a', 107), assetCode: 'n2' })]).errors[0]!.code).toBe('DUPLICATE_CODE');
  });
});
