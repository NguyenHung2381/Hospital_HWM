import { describe, expect, it } from 'vitest';
import { polygonArea, type Point, type Wall } from '@hwn/map-core';
import { layoutWall } from './walls';
import { segmentOutline, wallJoints } from './wallJoints';

const wall = (id: string, start: Point, end: Point, thickness = 0.2): Wall => ({
  id,
  start,
  end,
  thickness,
  height: 3,
});

/** Đa giác đầy đủ của tường (một đoạn đặc). */
const outline = (w: Wall, walls: Wall[]) =>
  segmentOutline(w, layoutWall(w, [])[0]!, wallJoints(walls).get(w.id));

const close = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
const has = (poly: Point[], p: Point) => poly.some((q) => close(q, p));

describe('wallJoints', () => {
  it('góc vuông: hai tường chung đỉnh góc ngoài và góc trong, không chồng nhau', () => {
    const a = wall('a', { x: 0, y: 0 }, { x: 5, y: 0 });
    const b = wall('b', { x: 0, y: 0 }, { x: 0, y: 4 });
    const pa = outline(a, [a, b]);
    const pb = outline(b, [a, b]);
    for (const corner of [
      { x: -0.1, y: -0.1 },
      { x: 0.1, y: 0.1 },
    ]) {
      expect(has(pa, corner)).toBe(true);
      expect(has(pb, corner)).toBe(true);
    }
    // Tổng diện tích = diện tích hình chữ L (không chồng, không hở).
    const expected = 5.1 * 0.2 + 0.2 * 3.9;
    expect(polygonArea(pa) + polygonArea(pb)).toBeCloseTo(expected, 6);
  });

  it('góc xiên 45°: góc ngoài khép kín bằng giao tuyến mặt tường', () => {
    const a = wall('a', { x: 0, y: 0 }, { x: 5, y: 0 });
    const b = wall('b', { x: 0, y: 0 }, { x: 3, y: 3 });
    const pa = outline(a, [a, b]);
    const pb = outline(b, [a, b]);
    // Mỗi góc chung phải xuất hiện ở cả hai đa giác.
    const shared = pa.filter((p) => has(pb, p));
    expect(shared.length).toBeGreaterThanOrEqual(3); // góc trong, góc ngoài, tâm mối nối
  });

  it('chữ T (tường đâm vào thân tường khác): cắt khít theo mặt tường kia', () => {
    const through = wall('t', { x: -5, y: 0 }, { x: 5, y: 0 }, 0.3);
    const stem = wall('s', { x: 0, y: 0 }, { x: 0, y: 4 });
    const ps = outline(stem, [through, stem]);
    // Mặt tường ngang phía dưới ở y = 0.15.
    const nearEnd = ps.filter((p) => p.y < 1);
    expect(nearEnd.length).toBe(2);
    for (const p of nearEnd) expect(p.y).toBeCloseTo(0.15, 6);
  });

  it('ngã ba chung đỉnh: ba tường phủ kín lõi mối nối', () => {
    const a = wall('a', { x: 0, y: 0 }, { x: 4, y: 0 });
    const b = wall('b', { x: 0, y: 0 }, { x: -4, y: 0 });
    const c = wall('c', { x: 0, y: 0 }, { x: 0, y: 4 });
    const all = [a, b, c];
    const total = all.reduce((s, w) => s + polygonArea(outline(w, all)), 0);
    // Tường ngang 8 m + tường đứng 4 m nhô ra khỏi mặt tường ngang (3.9 m).
    expect(total).toBeCloseTo(8 * 0.2 + 3.9 * 0.2, 6);
  });

  it('đầu tự do: cắt vuông đúng tại đầu mút', () => {
    const a = wall('a', { x: 0, y: 0 }, { x: 5, y: 0 });
    const p = outline(a, [a]);
    expect(Math.min(...p.map((q) => q.x))).toBeCloseTo(0, 6);
    expect(Math.max(...p.map((q) => q.x))).toBeCloseTo(5, 6);
  });

  it('cạnh ô cửa giữa tường vẫn cắt vuông', () => {
    const a = wall('a', { x: 0, y: 0 }, { x: 6, y: 0 });
    const b = wall('b', { x: 0, y: 0 }, { x: 0, y: 4 });
    const segs = layoutWall(a, [
      {
        id: 'd',
        type: 'door',
        wallId: 'a',
        offset: 3,
        width: 1,
        height: 2,
        sillHeight: 0,
      },
    ]);
    const caps = wallJoints([a, b]).get('a');
    const first = segmentOutline(a, segs[0]!, caps);
    expect(Math.max(...first.map((q) => q.x))).toBeCloseTo(2.5, 6);
    expect(has(first, { x: -0.1, y: -0.1 })).toBe(true);
  });
});
