import { describe, expect, it } from 'vitest';
import { codeEntry, COMPONENT_CODES, ComponentCode, componentDoes, pipeMaterialCode, pipeMaterialLabel } from './index.js';

describe('catalog contract', () => {
  it('lists the component codes with kind, host and functions (decision 0028)', () => {
    expect(COMPONENT_CODES).toContain('PRV');
    expect(codeEntry('PRV')).toMatchObject({ kind: 'Device', host: 'pipe', functions: ['controls'] });
    expect(codeEntry('Tee')).toMatchObject({ kind: 'Node', host: 'none' });
    expect(componentDoes('ButterflyValve', 'isolates')).toBe(true);
    expect(componentDoes('CheckValve', 'isolates')).toBe(false);
    expect(ComponentCode.safeParse('PRV').success).toBe(true);
    expect(ComponentCode.safeParse('Valve').success).toBe(false);
  });

  it('maps the app material labels to the backend codes and back', () => {
    expect(pipeMaterialCode('Gang xám')).toBe('CastIron');
    expect(pipeMaterialCode('gang dẻo')).toBe('DuctileIron');
    expect(pipeMaterialCode('uPVC')).toBe('PVC');
    expect(pipeMaterialCode('Thép')).toBe('Steel');
    expect(pipeMaterialCode('HDPE')).toBe('HDPE');
    expect(pipeMaterialCode('Steel')).toBe('Steel');
    expect(pipeMaterialCode('đồng')).toBeUndefined();
    expect(pipeMaterialLabel('CastIron')).toBe('Gang xám');
  });
});
