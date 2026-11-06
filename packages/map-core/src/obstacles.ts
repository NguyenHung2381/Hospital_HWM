/**
 * Tường làm vật cản khi đi lại: phần tường đặc (trừ ô cửa đi / cửa chính) theo đường tâm tường.
 * Dùng để kiểm tra một đoạn đi thẳng có xuyên tường hay không.
 */
import { distance, segmentIntersection, wallLength } from './geometry';
import type { Floor, Point } from './types';

export interface WallObstacle {
  a: Point;
  b: Point;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const segment = (a: Point, b: Point): WallObstacle => ({
  a,
  b,
  minX: Math.min(a.x, b.x),
  minY: Math.min(a.y, b.y),
  maxX: Math.max(a.x, b.x),
  maxY: Math.max(a.y, b.y),
});

/**
 * Các đoạn tường đặc của tầng: mỗi tường được cắt bỏ phần ô cửa đi / cửa chính (cửa sổ vẫn là
 * tường — không đi qua được).
 */
export function solidWallObstacles(floor: Pick<Floor, 'walls' | 'openings'>): WallObstacle[] {
  const gaps = new Map<string, [number, number][]>();
  for (const o of floor.openings) {
    if (o.type === 'window') continue;
    const list = gaps.get(o.wallId) ?? [];
    list.push([o.offset - o.width / 2, o.offset + o.width / 2]);
    gaps.set(o.wallId, list);
  }
  const out: WallObstacle[] = [];
  for (const w of floor.walls) {
    const len = wallLength(w);
    if (len < 1e-6) continue;
    const at = (d: number): Point => ({
      x: w.start.x + ((w.end.x - w.start.x) * d) / len,
      y: w.start.y + ((w.end.y - w.start.y) * d) / len,
    });
    let cursor = 0;
    for (const [from, to] of (gaps.get(w.id) ?? []).sort((p, q) => p[0] - q[0])) {
      const lo = Math.max(0, from);
      if (lo > cursor + 1e-6) out.push(segment(at(cursor), at(lo)));
      cursor = Math.max(cursor, Math.min(len, to));
    }
    if (len > cursor + 1e-6) out.push(segment(at(cursor), at(len)));
  }
  return out;
}

/**
 * Đoạn `a`–`b` cắt qua tường đặc. Giao điểm cách hai đầu đoạn trong khoảng `tolerance` (m) được bỏ
 * qua (vd. nút đồ thị đặt sát / trên tường).
 */
export function crossesWall(
  walls: readonly WallObstacle[],
  a: Point,
  b: Point,
  tolerance = 0.02,
): boolean {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x, b.x);
  const maxY = Math.max(a.y, b.y);
  for (const w of walls) {
    if (w.maxX < minX || w.minX > maxX || w.maxY < minY || w.minY > maxY) continue;
    const hit = segmentIntersection(a, b, w.a, w.b);
    if (hit && distance(hit, a) > tolerance && distance(hit, b) > tolerance) return true;
  }
  return false;
}
