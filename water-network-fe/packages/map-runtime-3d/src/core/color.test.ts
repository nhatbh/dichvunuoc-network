import { describe, expect, it } from 'vitest';
import { parseColor } from './color.js';

describe('parseColor', () => {
  it('parses hex forms', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 255]);
    expect(parseColor('#0E7C86')).toEqual([14, 124, 134, 255]);
    expect(parseColor('#0E7C8680')).toEqual([14, 124, 134, 128]);
    expect(parseColor('#abcd')).toEqual([170, 187, 204, 221]);
  });
  it('parses rgb / rgba / hsl', () => {
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3, 255]);
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual([10, 20, 30, 128]);
    expect(parseColor('rgba(0,0,0,0)')[3]).toBe(0);
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual([255, 0, 0, 255]);
  });
  it('applies an opacity multiplier', () => {
    expect(parseColor('#ffffff', 0.5)[3]).toBe(128);
    expect(parseColor('rgba(0,0,0,0.5)', 0.5)[3]).toBe(64);
  });
  it('knows a few names and falls back to visible slate for garbage', () => {
    expect(parseColor('transparent')[3]).toBe(0);
    expect(parseColor('white')).toEqual([255, 255, 255, 255]);
    expect(parseColor('not-a-colour')).toEqual([100, 116, 139, 255]);
    expect(parseColor(undefined)).toEqual([100, 116, 139, 255]);
  });
});
