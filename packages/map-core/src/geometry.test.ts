import { describe, expect, it } from 'vitest';
import {
  isSelfIntersecting,
  offsetAlongWall,
  pointInPolygon,
  pointOnWall,
  polygonArea,
  polygonCentroid,
  projectPointOnSegment,
  segmentIntersection,
  simplifyPolygon,
  snapAngle,
  snapToGrid,
  snapToPoints,
} from './geometry';

const square = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
  { x: 0, y: 4 },
];

describe('geometry', () => {
  it('chiếu điểm lên đoạn thẳng và kẹp trong đoạn', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(projectPointOnSegment({ x: 3, y: 5 }, a, b)).toEqual({
      t: 0.3,
      point: { x: 3, y: 0 },
      distance: 5,
    });
    expect(projectPointOnSegment({ x: -4, y: 3 }, a, b).point).toEqual({ x: 0, y: 0 });
  });

  it('tìm giao điểm hai đoạn thẳng', () => {
    expect(
      segmentIntersection({ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 4, y: 0 }),
    ).toEqual({ x: 2, y: 2 });
    expect(
      segmentIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }),
    ).toBeNull();
    expect(
      segmentIntersection({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 3, y: 0 }, { x: 2, y: 1 }),
    ).toBeNull();
  });

  it('tính diện tích, trọng tâm và kiểm tra điểm trong đa giác', () => {
    expect(polygonArea(square)).toBe(16);
    expect(polygonCentroid(square)).toEqual({ x: 2, y: 2 });
    expect(pointInPolygon({ x: 1, y: 1 }, square)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 1 }, square)).toBe(false);
  });

  it('phát hiện đa giác tự cắt', () => {
    expect(isSelfIntersecting(square)).toBe(false);
    const bowtie = [square[0]!, square[2]!, square[1]!, square[3]!];
    expect(isSelfIntersecting(bowtie)).toBe(true);
  });

  it('chuyển đổi offset dọc theo tường', () => {
    const wall = { start: { x: 0, y: 0 }, end: { x: 0, y: 10 } };
    expect(pointOnWall(wall, 4)).toEqual({ x: 0, y: 4 });
    expect(offsetAlongWall(wall, { x: 3, y: 7 })).toBeCloseTo(7);
  });

  it('snap theo lưới, góc và điểm có sẵn', () => {
    expect(snapToGrid({ x: 1.26, y: 0.74 }, 0.5)).toEqual({ x: 1.5, y: 0.5 });
    const snapped = snapAngle({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(snapped.x).toBeCloseTo(10);
    expect(snapped.y).toBeCloseTo(0);
    const diag = snapAngle({ x: 0, y: 0 }, { x: 5, y: 4.6 });
    expect(diag.x).toBeCloseTo(diag.y);
    expect(
      snapToPoints(
        { x: 1, y: 1 },
        [
          { x: 1.2, y: 1 },
          { x: 5, y: 5 },
        ],
        0.5,
      ),
    ).toEqual({ x: 1.2, y: 1 });
    expect(snapToPoints({ x: 1, y: 1 }, [{ x: 5, y: 5 }], 0.5)).toBeNull();
  });
});

describe('simplifyPolygon', () => {
  it('làm gọn mép răng cưa theo lưới, sai lệch không quá ngưỡng', () => {
    // Tam giác vuông có cạnh huyền là bậc thang ô 0.2 m.
    const stairs = [{ x: 0, y: 0 }];
    for (let i = 0; i < 10; i++) {
      stairs.push({ x: (i + 1) * 0.2, y: i * 0.2 }, { x: (i + 1) * 0.2, y: (i + 1) * 0.2 });
    }
    stairs.push({ x: 0, y: 2 });
    const simple = simplifyPolygon(stairs, 0.2);
    expect(simple.length).toBeLessThan(6);
    for (const p of stairs) {
      const d = Math.min(
        ...simple.map(
          (a, i) => projectPointOnSegment(p, a, simple[(i + 1) % simple.length]!).distance,
        ),
      );
      expect(d).toBeLessThanOrEqual(0.2 + 1e-9);
    }
    expect(Math.abs(polygonArea(simple) - polygonArea(stairs))).toBeLessThan(0.3);
  });
});
