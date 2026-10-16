import { describe, expect, it } from 'vitest';
import { aroundMarker, markerBox, placeLabels, type MeasureText } from './labels';

/** Mỗi ký tự rộng 6 px. */
const measure: MeasureText = (text) => text.length * 6;

describe('placeLabels', () => {
  it('nhãn thứ hai bị đè thì chuyển sang vị trí thử khác', () => {
    const scale = 10; // 10 px / m
    const placed = placeLabels(
      [
        {
          key: 'a',
          text: 'Cổng chính',
          anchor: { x: 0, y: 0 },
          candidates: aroundMarker(9),
          fontSize: 11,
        },
        {
          key: 'b',
          text: 'Cổng đi bộ',
          anchor: { x: 3, y: 0 },
          candidates: aroundMarker(9),
          fontSize: 11,
        },
      ],
      [],
      scale,
      measure,
    );
    expect(placed).toHaveLength(2);
    const [a, b] = placed;
    expect(a!.y).toBeGreaterThan(0); // nhãn đầu nằm dưới biểu tượng
    expect(b!.y + b!.height).toBeLessThan(0); // nhãn sau chuyển lên trên
  });

  it('ẩn nhãn khi mọi vị trí đều bị vật cản che', () => {
    const blocker = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    const placed = placeLabels(
      [
        {
          key: 'a',
          text: 'ATM',
          anchor: { x: 0, y: 0 },
          candidates: aroundMarker(9),
          fontSize: 11,
        },
      ],
      [blocker],
      10,
      measure,
    );
    expect(placed).toEqual([]);
  });

  it('không đè lên biểu tượng của chính nó', () => {
    const scale = 10;
    const anchor = { x: 5, y: 5 };
    const [l] = placeLabels(
      [{ key: 'a', text: 'Taxi', anchor, candidates: aroundMarker(11), fontSize: 11 }],
      [markerBox(anchor, 11, scale)],
      scale,
      measure,
    );
    expect(l!.y).toBeGreaterThanOrEqual(anchor.y + 1.1);
  });
});
