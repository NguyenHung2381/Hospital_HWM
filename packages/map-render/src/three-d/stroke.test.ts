import { describe, expect, it } from 'vitest';
import type { Point } from '@hwn/map-core';
import { roundCorners, strokeTriangles } from './stroke';
import { buildGateModel, landmarkPointModel, sitePoiPointModel } from './pointModels';

/** Tổng diện tích (mặt bằng) và hướng pháp tuyến các tam giác. */
function analyse(pos: number[]) {
  let area = 0;
  let down = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const [ax, , ay, bx, , by, cx, , cy] = pos.slice(i, i + 9) as number[];
    const s = (bx! - ax!) * (cy! - ay!) - (by! - ay!) * (cx! - ax!);
    area += Math.abs(s) / 2;
    if (s > 0) down++;
  }
  return { area, down };
}

/** Điểm `p` có nằm trong một tam giác nào không. */
function covered(pos: number[], p: Point) {
  for (let i = 0; i < pos.length; i += 9) {
    const [ax, , ay, bx, , by, cx, , cy] = pos.slice(i, i + 9) as number[];
    const d1 = (p.x - bx!) * (ay! - by!) - (ax! - bx!) * (p.y - by!);
    const d2 = (p.x - cx!) * (by! - cy!) - (bx! - cx!) * (p.y - cy!);
    const d3 = (p.x - ax!) * (cy! - ay!) - (cx! - ax!) * (p.y - ay!);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos_ = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(neg && pos_)) return true;
  }
  return false;
}

describe('strokeTriangles', () => {
  const L: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  it('mọi tam giác quay mặt lên', () => {
    expect(analyse(strokeTriangles(L, 2, 0, { roundStart: true, roundEnd: true })).down).toBe(0);
  });

  it('góc gãy được lấp tròn ở phía ngoài (không hở góc)', () => {
    const pos = strokeTriangles(L, 2, 0);
    // Điểm ở góc ngoài, cách đỉnh góc 0.9 m theo đường chéo ra ngoài.
    expect(covered(pos, { x: 10 + 0.6, y: -0.6 })).toBe(true);
    // Nhưng không phủ ra ngoài bán kính nửa bề rộng.
    expect(covered(pos, { x: 10 + 0.8, y: -0.8 })).toBe(false);
  });

  it('đầu bo tròn khi yêu cầu, cắt vuông khi không', () => {
    const butt = strokeTriangles(L, 2, 0);
    const round = strokeTriangles(L, 2, 0, { roundStart: true });
    expect(covered(butt, { x: -0.5, y: 0 })).toBe(false);
    expect(covered(round, { x: -0.5, y: 0 })).toBe(true);
  });

  it('cao độ theo từng đỉnh', () => {
    const pos = strokeTriangles(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      1,
      [0, 2],
    );
    const hs = pos.filter((_, i) => i % 3 === 1);
    expect(Math.min(...hs)).toBe(0);
    expect(Math.max(...hs)).toBe(2);
  });
});

describe('roundCorners', () => {
  it('giữ nguyên hai đầu, góc vuông thành cung, không bo đoạn đứng', () => {
    const out = roundCorners(
      [
        [0, 0, 0],
        [5, 0, 0],
        [5, 0, 5],
      ],
      1,
    );
    expect(out[0]).toEqual([0, 0, 0]);
    expect(out[out.length - 1]).toEqual([5, 0, 5]);
    expect(out.length).toBeGreaterThan(3);
    expect(out.some((p) => p[0] === 5 && p[2] === 0)).toBe(false);
    const vertical = roundCorners(
      [
        [0, 0, 0],
        [0, 3, 0],
        [4, 3, 0],
      ],
      1,
    );
    expect(vertical).toHaveLength(3);
  });
});

describe('mô hình 3D các điểm', () => {
  it('mỗi loại mốc / điểm ngoài trời có mô hình với màu theo đỉnh', () => {
    const kinds = [
      'info',
      'kiosk',
      'cashier',
      'pharmacy',
      'restroom',
      'atm',
      'water',
      'waiting',
      'canteen',
      'other',
    ] as const;
    for (const k of kinds) {
      const m = landmarkPointModel(k, '#2563eb');
      expect(m.geometry.getAttribute('color')).toBeTruthy();
      expect(m.height).toBeGreaterThan(0.5);
      expect(m.geometry.boundingBox!.min.y).toBeGreaterThanOrEqual(-1e-6);
    }
    const pois = [
      'atm',
      'shop',
      'canteen',
      'pharmacy',
      'parking',
      'bus',
      'taxi',
      'security',
      'emergency',
      'restroom',
      'info',
      'bike',
      'ev',
      'other',
    ] as const;
    for (const k of pois) {
      const m = sitePoiPointModel(k, '#16a34a');
      expect(m.geometry.getAttribute('position').count).toBeGreaterThan(0);
      expect(m.height).toBeGreaterThan(1);
    }
  });

  it('cổng: trụ hai bên lối qua theo hướng đường', () => {
    // Đường chạy theo trục x (0°) → trụ cổng nằm hai bên theo trục y (z của three).
    const g = buildGateModel(
      { id: 'g', name: 'Cổng', kind: 'vehicle', position: { x: 10, y: 20 }, style: 'open' },
      { angle: 0, half: 3 },
      true,
    );
    g.computeBoundingBox();
    const box = g.boundingBox!;
    expect(box.max.z - box.min.z).toBeGreaterThan(6);
    expect(box.max.x - box.min.x).toBeLessThan(1);
    expect((box.max.z + box.min.z) / 2).toBeCloseTo(20, 3);
  });
});
