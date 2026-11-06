/**
 * Dựng dải phẳng (đường, lối đi, tuyến chỉ đường) dọc đường gấp khúc như nét bút có `lineJoin:
 * round`: mỗi đoạn là một tứ giác, góc gãy được lấp bằng quạt tròn ở phía ngoài nên dải KHÔNG bị
 * hở / thắt lại ở góc như cách vát (miter) có giới hạn; đầu dải có thể bo tròn để nối liền với dải
 * khác chung đầu mút.
 *
 * Toạ độ mặt bằng (x, y) → three.js (x, cao độ, y). Tam giác quay mặt lên trên.
 */
import * as THREE from 'three';
import type { Point } from '@hwn/map-core';

export interface StrokeOptions {
  /** Bo tròn đầu dải (nửa hình tròn đường kính = bề rộng). */
  roundStart?: boolean;
  roundEnd?: boolean;
  /** Góc lớn nhất (rad) của một lát quạt khi bo tròn. Mặc định ~15°. */
  arcStep?: number;
}

const DEFAULT_ARC_STEP = Math.PI / 12;

/**
 * Mảng toạ độ (x, h, y) các tam giác phủ dải rộng `width` dọc `points`.
 * @param heights cao độ (một số chung, hoặc từng đỉnh — cùng độ dài với `points`).
 */
export function strokeTriangles(
  points: readonly Point[],
  width: number,
  heights: number | readonly number[],
  options: StrokeOptions = {},
): number[] {
  const hAt = (i: number) => (typeof heights === 'number' ? heights : (heights[i] ?? 0));
  // Bỏ đỉnh trùng (theo mặt bằng), giữ cao độ tương ứng.
  const pts: Point[] = [];
  const hs: number[] = [];
  points.forEach((p, i) => {
    const last = pts[pts.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-4) {
      hs[hs.length - 1] = hAt(i);
      return;
    }
    pts.push(p);
    hs.push(hAt(i));
  });
  if (pts.length < 2 || !(width > 0)) return [];
  const half = width / 2;
  const step = options.arcStep ?? DEFAULT_ARC_STEP;
  const out: number[] = [];

  /** Thêm tam giác, đảo thứ tự đỉnh nếu cần để mặt quay lên (+Y). */
  const tri = (a: Point, ha: number, b: Point, hb: number, c: Point, hc: number) => {
    // Mặt quay lên khi diện tích có dấu trên mặt bằng (x, y) âm.
    const s = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(s) < 1e-12) return;
    if (s < 0) out.push(a.x, ha, a.y, b.x, hb, b.y, c.x, hc, c.y);
    else out.push(a.x, ha, a.y, c.x, hc, c.y, b.x, hb, b.y);
  };
  /** Quạt tâm `c` từ vector `from` quay một góc `angle` (rad). */
  const fan = (c: Point, h: number, from: Point, angle: number) => {
    const n = Math.max(1, Math.ceil(Math.abs(angle) / step));
    let prev = { x: c.x + from.x, y: c.y + from.y };
    for (let k = 1; k <= n; k++) {
      const t = (angle * k) / n;
      const cos = Math.cos(t);
      const sin = Math.sin(t);
      const v = { x: from.x * cos - from.y * sin, y: from.x * sin + from.y * cos };
      const next = { x: c.x + v.x, y: c.y + v.y };
      tri(c, h, prev, h, next, h);
      prev = next;
    }
  };

  const dirs = pts.slice(1).map((b, i) => {
    const a = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  });
  const normalOf = (d: Point) => ({ x: -d.y * half, y: d.x * half });

  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const n = normalOf(dirs[i]!);
    const l0 = { x: a.x + n.x, y: a.y + n.y };
    const r0 = { x: a.x - n.x, y: a.y - n.y };
    const l1 = { x: b.x + n.x, y: b.y + n.y };
    const r1 = { x: b.x - n.x, y: b.y - n.y };
    tri(l0, hs[i]!, r0, hs[i]!, l1, hs[i + 1]!);
    tri(r0, hs[i]!, r1, hs[i + 1]!, l1, hs[i + 1]!);
  }

  // Góc gãy: quạt tròn ở phía ngoài khúc quanh.
  for (let i = 1; i + 1 < pts.length; i++) {
    const d0 = dirs[i - 1]!;
    const d1 = dirs[i]!;
    const turn = Math.atan2(d0.x * d1.y - d0.y * d1.x, d0.x * d1.x + d0.y * d1.y);
    if (Math.abs(turn) < 1e-3) continue;
    const n0 = normalOf(d0);
    // Quay sang phía (cross > 0) thì phía ngoài là −n, ngược lại là +n.
    const from = turn > 0 ? { x: -n0.x, y: -n0.y } : n0;
    fan(pts[i]!, hs[i]!, from, turn);
  }

  if (options.roundStart) {
    fan(pts[0]!, hs[0]!, normalOf(dirs[0]!), Math.PI);
  }
  if (options.roundEnd) {
    const n = normalOf(dirs[dirs.length - 1]!);
    fan(pts[pts.length - 1]!, hs[hs.length - 1]!, { x: -n.x, y: -n.y }, Math.PI);
  }
  return out;
}

/** `strokeTriangles` đóng gói thành BufferGeometry (null nếu rỗng). */
export function strokeGeometry(
  points: readonly Point[],
  width: number,
  heights: number | readonly number[],
  options?: StrokeOptions,
): THREE.BufferGeometry | null {
  const pos = strokeTriangles(points, width, heights, options);
  if (pos.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Bo tròn các góc gãy của đường gấp khúc 3D (tuyến chỉ đường): mỗi góc thay bằng cung bậc hai bán
 * kính tối đa `radius` (không vượt quá ~nửa đoạn kề), giữ nguyên hai đầu mút. Đoạn đứng (lên thang)
 * không bị bo.
 */
export function roundCorners(
  points: readonly (readonly [number, number, number])[],
  radius: number,
  samples = 6,
): [number, number, number][] {
  if (points.length < 3 || radius <= 0) return points.map((p) => [p[0], p[1], p[2]]);
  const out: [number, number, number][] = [[points[0]![0], points[0]![1], points[0]![2]]];
  const len3 = (a: readonly number[], b: readonly number[]) =>
    Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[i - 1]!;
    const p = points[i]!;
    const b = points[i + 1]!;
    const la = len3(a, p);
    const lb = len3(p, b);
    const da = [(p[0] - a[0]) / la, (p[1] - a[1]) / la, (p[2] - a[2]) / la];
    const db = [(b[0] - p[0]) / lb, (b[1] - p[1]) / lb, (b[2] - p[2]) / lb];
    const cos = da[0]! * db[0]! + da[1]! * db[1]! + da[2]! * db[2]!;
    // Thẳng hàng, đoạn suy biến hoặc đoạn gần thẳng đứng: giữ nguyên đỉnh.
    const steep = Math.abs(da[1]!) > 0.9 || Math.abs(db[1]!) > 0.9;
    if (!(la > 1e-4 && lb > 1e-4) || cos > 0.9995 || steep) {
      out.push([p[0], p[1], p[2]]);
      continue;
    }
    const r = Math.min(radius, la * 0.45, lb * 0.45);
    const s: [number, number, number] = [p[0] - da[0]! * r, p[1] - da[1]! * r, p[2] - da[2]! * r];
    const e: [number, number, number] = [p[0] + db[0]! * r, p[1] + db[1]! * r, p[2] + db[2]! * r];
    for (let k = 0; k <= samples; k++) {
      const t = k / samples;
      const u = 1 - t;
      out.push([
        u * u * s[0] + 2 * u * t * p[0] + t * t * e[0],
        u * u * s[1] + 2 * u * t * p[1] + t * t * e[1],
        u * u * s[2] + 2 * u * t * p[2] + t * t * e[2],
      ]);
    }
  }
  const last = points[points.length - 1]!;
  out.push([last[0], last[1], last[2]]);
  return out;
}
