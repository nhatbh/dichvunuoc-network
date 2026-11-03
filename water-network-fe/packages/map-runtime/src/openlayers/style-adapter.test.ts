import { describe, expect, it } from 'vitest';
import { Circle as CircleStyle } from 'ol/style';
import { buildStyle, styleForKind, KIND_COLORS } from './style-adapter.js';

describe('style-adapter', () => {
  it('returns a distinct base style per kind', () => {
    expect(styleForKind('node', false)).toBeTruthy();
    expect(KIND_COLORS.pipe).not.toBe(KIND_COLORS.node);
  });
  it('returns a highlighted style when selected', () => {
    const normal = styleForKind('node', false);
    const selected = styleForKind('node', true);
    expect(selected).not.toBe(normal);
  });
  it('renders draft features with a dashed stroke', () => {
    const draft = styleForKind('pipe', false, true);
    expect(draft.getStroke()?.getLineDash()).toEqual([6, 6]);
    const published = styleForKind('pipe', false, false);
    expect(published.getStroke()?.getLineDash() ?? null).toBeNull();
  });

  it('centers a numbered control-point label inside its existing marker', () => {
    const [style] = buildStyle({
      image: { shape: 'circle', radius: 9, color: '#2563eb', stroke: '#ffffff', strokeWidth: 2 },
      text: { value: '12', color: '#ffffff', font: '600 11px sans-serif', offsetY: 0 },
    });
    const label = style?.getText();
    expect(label?.getText()).toBe('12');
    expect(label?.getFont()).toBe('600 11px sans-serif');
    expect(label?.getTextAlign()).toBe('center');
    expect(label?.getTextBaseline()).toBe('middle');
    expect(label?.getOffsetY()).toBe(0);
    expect(label?.getFill()?.getColor()).toBe('#ffffff');
    expect(label?.getStroke()).toBeNull();
    const marker = style?.getImage();
    expect(marker).toBeInstanceOf(CircleStyle);
    expect((marker as CircleStyle).getRadius()).toBe(9);
    expect((marker as CircleStyle).getStroke()?.getWidth()).toBe(2);
  });

  it('applies feature opacity and optional outline to a displaced label without changing the halo', () => {
    const [halo, main] = buildStyle({
      halo: { color: '#ff0000', width: 6, dash: [4, 2] },
      stroke: { color: '#00ff00', width: 3 },
      opacity: 0.5,
      text: { value: '3', color: '#ffffff', offsetY: -14, stroke: '#000000', strokeWidth: 3 },
    });
    expect(halo?.getZIndex()).toBe(-1);
    expect(halo?.getStroke()?.getLineDash()).toEqual([4, 2]);
    expect(halo?.getText()).toBeNull();
    expect(main?.getStroke()?.getWidth()).toBe(3);
    expect(main?.getText()?.getFill()?.getColor()).toBe('rgba(255, 255, 255, 0.5)');
    expect(main?.getText()?.getStroke()?.getColor()).toBe('rgba(0, 0, 0, 0.5)');
    expect(main?.getText()?.getStroke()?.getWidth()).toBe(3);
    expect(main?.getText()?.getOffsetY()).toBe(-14);
  });

  it('keeps existing unlabeled custom styles without text', () => {
    const [style] = buildStyle({
      image: { shape: 'diamond', radius: 7, color: '#d97706' },
      fill: '#0284c7',
      stroke: { color: '#0284c7', width: 2, dash: [6, 4] },
    });
    expect(style?.getText()).toBeNull();
    expect(style?.getFill()?.getColor()).toBe('#0284c7');
    expect(style?.getStroke()?.getLineDash()).toEqual([6, 4]);
    expect(style?.getImage()).toBeTruthy();
  });
});
