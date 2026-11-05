import { describe, expect, it } from 'vitest';
import { CATALOG_ITEMS, STATUSES } from './catalog.js';
import { SYMBOLS, STATUS_HEX, symbolSVG } from './symbols.js';

describe('flat symbols', () => {
  it('defines a symbol for every catalog code', () => {
    for (const c of CATALOG_ITEMS) expect(SYMBOLS[c.code], c.code).toBeDefined();
  });
  it('aligns in-line and fitting symbols to the pipe', () => {
    for (const c of CATALOG_ITEMS) {
      if (c.role === 'node' || c.role === 'line') expect(SYMBOLS[c.code]!.align, c.code).toBe('pipe');
      if (['Hydrant', 'PressureSensor', 'Tank', 'Reservoir'].includes(c.code)) expect(SYMBOLS[c.code]!.align, c.code).toBe('point');
    }
  });
  it('renders well-formed SVG with the requested size', () => {
    for (const c of CATALOG_ITEMS) {
      const svg = symbolSVG(c.code, { size: 40 });
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 32 32">')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg).not.toMatch(/undefined|NaN/);
      const opened = (svg.match(/<(path|circle|rect|text)\b/g) ?? []).length;
      const closed = (svg.match(/\/>|<\/text>/g) ?? []).length;
      expect(closed).toBe(opened);
    }
  });
  it('draws a status ring in the status colour', () => {
    for (const s of STATUSES) expect(symbolSVG('PressureSensor', { status: s })).toContain(STATUS_HEX[s]);
    expect(symbolSVG('PressureSensor')).not.toContain(STATUS_HEX.normal);
  });
});
