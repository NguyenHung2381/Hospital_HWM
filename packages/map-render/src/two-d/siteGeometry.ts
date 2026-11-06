/** Hình học thuần (không phụ thuộc Konva) để vẽ phần ngoài trời: ký hiệu dọc đường, cổng, hàng rào, bãi xe. */
import {
  boundsOf,
  distance,
  isRoadPath,
  offsetPolyline,
  projectPointOnSegment,
  rampCenterline,
  segmentIntersection,
  sidewalkWidth,
  type Point,
  type SiteGate,
  type SitePath,
  type SiteVehicleAccess,
} from '@hwn/map-core';

const unit = (from: Point, to: Point): Point => {
  const len = distance(from, to) || 1;
  return { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
};
const degrees = (a: Point, b: Point) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

/** Các điểm đặt ký hiệu dọc đường (cách nhau `step` m, bắt đầu từ `step / 2`), kèm góc. */
export function marksAlong(points: readonly Point[], step: number) {
  const out: { p: Point; angle: number; dir: Point }[] = [];
  let carry = step / 2;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const len = distance(a, b);
    if (len === 0) continue;
    const dir = unit(a, b);
    const angle = degrees(a, b);
    for (let d = carry; d < len; d += step) {
      out.push({ p: { x: a.x + dir.x * d, y: a.y + dir.y * d }, angle, dir });
    }
    carry = (carry - len) % step;
    if (carry < 0) carry += step;
  }
  return out;
}

/**
 * Vị trí vẽ mũi tên / biểu tượng loại xe trên một đường (cách nhau `step` m), bỏ chỗ nằm trên dốc;
 * đường ngắn không còn chỗ nào thì đặt một ký hiệu giữa đoạn dài nhất không bị dốc phủ.
 */
export function roadMarks(path: SitePath, all: readonly SitePath[], step = 14) {
  const ramps = all.filter((r) => r.kind === 'ramp' && r !== path);
  const onRamp = (p: Point) =>
    ramps.some((r) =>
      r.points.some(
        (a, i) =>
          i + 1 < r.points.length &&
          projectPointOnSegment(p, a, r.points[i + 1]!).distance < r.width / 2 + 1,
      ),
    );
  const marks = marksAlong(path.points, step).filter((m) => !onRamp(m.p));
  if (marks.length) return marks;
  let best: { a: Point; b: Point; len: number } | null = null;
  for (let i = 0; i + 1 < path.points.length; i++) {
    const a = path.points[i]!;
    const b = path.points[i + 1]!;
    const len = distance(a, b);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (len >= 4 && !onRamp(mid) && (!best || len > best.len)) best = { a, b, len };
  }
  if (!best) return [];
  return [
    {
      p: { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2 },
      angle: degrees(best.a, best.b),
      dir: unit(best.a, best.b),
    },
  ];
}

/** Điểm giữa (theo chiều dài) của đường gấp khúc. */
export function midpointOf(points: readonly Point[]): Point {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) total += distance(points[i]!, points[i + 1]!);
  let left = total / 2;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const len = distance(a, b);
    if (left <= len && len > 0) {
      return { x: a.x + ((b.x - a.x) * left) / len, y: a.y + ((b.y - a.y) * left) / len };
    }
    left -= len;
  }
  return points[0] ?? { x: 0, y: 0 };
}

export { offsetPolyline } from '@hwn/map-core';

export interface GateShape {
  /** Hướng đường đi qua cổng (độ). */
  angle: number;
  /** Nửa khoảng cách giữa hai trụ cổng (m). */
  half: number;
  /** Hướng ra phía ngoài khuôn viên (đơn vị), nếu cổng nằm ở đầu một đường. */
  outward: Point | null;
  /** Loại xe của đường đi qua cổng. */
  access?: SiteVehicleAccess;
}

/** Hướng + bề rộng cổng, suy ra từ đường gần nhất đi qua cổng (cổng xe ưu tiên đường xe). */
export function gateShape(gate: SiteGate, paths: readonly SitePath[]): GateShape {
  const wantRoad = gate.kind !== 'pedestrian';
  let best: { path: SitePath; i: number; score: number; dist: number } | null = null;
  for (const path of paths) {
    if (path.kind === 'ramp' || path.kind === 'fence') continue;
    const mismatch = isRoadPath(path) !== wantRoad ? 1000 : 0;
    for (let i = 0; i + 1 < path.points.length; i++) {
      const { distance: dist } = projectPointOnSegment(
        gate.position,
        path.points[i]!,
        path.points[i + 1]!,
      );
      if (!best || dist + mismatch < best.score) best = { path, i, score: dist + mismatch, dist };
    }
  }
  if (!best || best.dist > Math.max(best.path.width, 4)) {
    return { angle: 90, half: 2.5, outward: null };
  }
  const pts = best.path.points;
  const tol = best.path.width + 6;
  const outward =
    distance(gate.position, pts[0]!) <= tol
      ? unit(pts[1]!, pts[0]!)
      : distance(gate.position, pts[pts.length - 1]!) <= tol
        ? unit(pts[pts.length - 2]!, pts[pts.length - 1]!)
        : null;
  return {
    angle: degrees(pts[best.i]!, pts[best.i + 1]!),
    half: best.path.width / 2 + 0.6,
    outward,
    access: isRoadPath(best.path) ? best.path.vehicles : undefined,
  };
}

/**
 * Cắt đường gấp khúc (hàng rào) thành các đoạn, chừa khoảng trống `[−half, half]` quanh mỗi lỗ
 * (cổng) nằm trên nó (cách đường không quá `tol` m).
 */
export function cutPolyline(
  points: readonly Point[],
  holes: readonly { position: Point; half: number }[],
  tol = 1.5,
): Point[][] {
  const pieces: Point[][] = [];
  let current: Point[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const len = distance(a, b);
    if (len === 0) continue;
    const at = (d: number): Point => ({
      x: a.x + ((b.x - a.x) * d) / len,
      y: a.y + ((b.y - a.y) * d) / len,
    });
    const cuts = holes
      .map((h) => ({ h, proj: projectPointOnSegment(h.position, a, b) }))
      .filter(({ proj }) => proj.distance <= tol)
      .map(({ h, proj }) => [proj.t * len - h.half, proj.t * len + h.half] as const)
      .sort((x, y) => x[0] - y[0]);
    if (!current.length) current.push(a);
    let pos = 0;
    for (const [from, to] of cuts) {
      if (to <= pos || from >= len) continue;
      if (from > pos) current.push(at(from));
      if (current.length >= 2) pieces.push(current);
      current = [];
      pos = Math.max(pos, to);
      if (pos < len) current.push(at(pos));
    }
    if (pos < len) current.push(b);
  }
  if (current.length >= 2) pieces.push(current);
  return pieces;
}

/**
 * Vạch qua đường (vạch ngựa vằn): chỗ lối đi bộ cắt lòng đường xe / đường chung, chỗ vỉa hè đường
 * chung bị một đường xe khác cắt ngang (vd. lối vào bãi xe rẽ ra từ đường chung) và chỗ lối đi bộ /
 * vỉa hè cắt ngang lòng dốc. `length` đo theo hướng người đi (`angle`), `span` là bề ngang vạch.
 */
export function crosswalks(paths: readonly SitePath[]) {
  const roads = paths.filter((p) => p.kind === 'vehicle' || p.kind === 'shared');
  const walks = paths.filter((p) => p.kind === 'pedestrian' || p.kind === 'covered');
  const out: { key: string; p: Point; angle: number; length: number; span: number }[] = [];
  for (const w of walks) {
    for (let i = 0; i + 1 < w.points.length; i++) {
      const a = w.points[i]!;
      const b = w.points[i + 1]!;
      for (const r of roads) {
        for (let j = 0; j + 1 < r.points.length; j++) {
          const hit = segmentIntersection(a, b, r.points[j]!, r.points[j + 1]!);
          if (!hit) continue;
          out.push({
            key: `${w.id}:${i}:${r.id}:${j}`,
            p: hit,
            angle: degrees(a, b),
            length: r.width - 2 * sidewalkWidth(r),
            span: Math.max(w.width * 1.4, 2.4),
          });
        }
      }
    }
  }

  /** Tim vỉa hè hai bên các đường chung. */
  const sidewalks = paths
    .filter((p) => p.kind === 'shared')
    .flatMap((r) => {
      const sw = sidewalkWidth(r);
      if (sw <= 0) return [];
      const off = r.width / 2 - sw / 2;
      return [off, -off].map((d, k) => ({
        id: `${r.id}~${k}`,
        road: r.id,
        line: offsetPolyline(r.points, d),
        width: sw,
      }));
    });
  /** Bề ngang lòng đường / dốc đo theo hướng người đi (cắt xiên thì dài hơn). */
  const across = (a: Point, b: Point, c: Point, d: Point, width: number) => {
    const u = unit(a, b);
    const v = unit(c, d);
    return width / Math.max(Math.abs(u.x * v.y - u.y * v.x), 0.5);
  };

  // Vỉa hè bị đường xe khác cắt ngang (lối rẽ vào bãi xe, đường nhánh…).
  for (const s of sidewalks) {
    for (let i = 0; i + 1 < s.line.length; i++) {
      const a = s.line[i]!;
      const b = s.line[i + 1]!;
      for (const r of roads) {
        if (r.id === s.road) continue;
        for (let j = 0; j + 1 < r.points.length; j++) {
          const c = r.points[j]!;
          const d = r.points[j + 1]!;
          const hit = segmentIntersection(a, b, c, d);
          if (!hit) continue;
          out.push({
            key: `${s.id}:${i}:${r.id}:${j}`,
            p: hit,
            angle: degrees(a, b),
            length: across(a, b, c, d, r.width - 2 * sidewalkWidth(r)),
            span: Math.max(s.width * 1.2, 2),
          });
        }
      }
    }
  }

  // Dốc: chỗ lối đi bộ hoặc vỉa hè đường chung cắt ngang lòng dốc (lối xe ra vào) — kẻ vạch để
  // người đi bộ có quyền đi trước. Bề dài vạch = bề ngang dốc đo theo hướng người đi.
  const walkLines = [
    ...walks.map((w) => ({ id: w.id, line: w.points, width: w.width })),
    ...sidewalks,
  ];
  for (const ramp of paths.filter((p) => p.kind === 'ramp' && p.points.length >= 2)) {
    const center = rampCenterline(ramp, paths);
    for (const w of walkLines) {
      for (let i = 0; i + 1 < w.line.length; i++) {
        const a = w.line[i]!;
        const b = w.line[i + 1]!;
        for (let j = 0; j + 1 < center.length; j++) {
          const c = center[j]!;
          const d = center[j + 1]!;
          const hit = segmentIntersection(a, b, c, d);
          if (!hit) continue;
          out.push({
            key: `${w.id}:${i}:${ramp.id}:${j}`,
            p: hit,
            angle: degrees(a, b),
            length: across(a, b, c, d, ramp.width),
            span: Math.max(w.width * 1.2, 2),
          });
        }
      }
    }
  }
  return out;
}

/** Kích thước ô đỗ (m): sâu, rộng, lối chạy giữa hai dãy. */
const BAY = {
  car: { depth: 5, width: 2.5, aisle: 6 },
  motorbike: { depth: 2, width: 0.9, aisle: 2.5 },
} as const;

/**
 * Vạch kẻ ô đỗ trong bãi (theo hộp bao của khu vực, dọc theo cạnh dài): các cụm "dãy – lối chạy –
 * dãy" xếp từ một cạnh. Trả về các đoạn [x1, y1, x2, y2] — khi vẽ cần cắt theo đa giác bãi.
 */
export function parkingBays(polygon: readonly Point[], vehicle: SiteVehicleAccess): number[][] {
  const b = boundsOf(polygon);
  if (!b) return [];
  const { depth, width, aisle } = BAY[vehicle];
  const alongX = b.maxX - b.minX >= b.maxY - b.minY;
  // u: trục ngắn (xếp dãy), v: trục dài (xếp ô).
  const [u0, u1] = alongX ? [b.minY, b.maxY] : [b.minX, b.maxX];
  const [v0, v1] = alongX ? [b.minX, b.maxX] : [b.minY, b.maxY];
  const seg = (ua: number, va: number, ub: number, vb: number) =>
    alongX ? [va, ua, vb, ub] : [ua, va, ub, vb];
  const module = 2 * depth + aisle;
  const rows: { from: number; to: number }[] = [];
  const k = Math.floor((u1 - u0) / module);
  if (k === 0) {
    if (u1 - u0 >= depth + aisle / 2) rows.push({ from: u0, to: u0 + depth });
  } else {
    for (let i = 0; i < k; i++) {
      const s = u0 + i * module;
      rows.push({ from: s, to: s + depth }, { from: s + depth + aisle, to: s + module });
    }
  }
  const out: number[][] = [];
  const margin = 1;
  for (const r of rows) {
    // Vạch cuối dãy (phía không có lối chạy) + vạch ngăn từng ô.
    const back = rows.some((o) => o !== r && Math.abs(o.from - r.to) < 1e-6) ? r.to : null;
    if (back !== null) out.push(seg(back, v0 + margin, back, v1 - margin));
    for (let v = v0 + margin; v <= v1 - margin + 1e-6; v += width) {
      out.push(seg(r.from, v, r.to, v));
    }
  }
  return out;
}

/**
 * Nối cửa chính của các toà với lối đi gần nhất (lối đi bộ, có mái che, vỉa hè đường chung) trong
 * phạm vi `maxDist` m — để lối đi trông liền vào toà nhà.
 */
export function entranceLinks(
  entrances: readonly Point[],
  paths: readonly SitePath[],
  maxDist = 12,
) {
  const walks = paths.filter(
    (p) => p.kind === 'pedestrian' || p.kind === 'covered' || p.kind === 'shared',
  );
  return entrances.flatMap((door, i) => {
    let best: { point: Point; dist: number; path: SitePath } | null = null;
    for (const path of walks) {
      for (let j = 0; j + 1 < path.points.length; j++) {
        const proj = projectPointOnSegment(door, path.points[j]!, path.points[j + 1]!);
        if (!best || proj.distance < best.dist) {
          best = { point: proj.point, dist: proj.distance, path };
        }
      }
    }
    if (!best || best.dist > maxDist) return [];
    // Bắt đầu từ mép lối đi, không phải tim.
    const dir = unit(best.point, door);
    const start = best.dist > best.path.width / 2 ? best.path.width / 2 - 0.1 : 0;
    const from = { x: best.point.x + dir.x * start, y: best.point.y + dir.y * start };
    return [
      {
        key: `e${i}`,
        from,
        to: door,
        angle: degrees(from, door),
        covered: best.path.kind === 'covered',
      },
    ];
  });
}

/** Hai đỉnh cách nhau không quá ngưỡng này (m) được coi là cùng một chỗ nối đường. */
const ELBOW_TOLERANCE = 0.35;

/** Họ đường để xét chỗ nối: đường xe nối đường xe, lối đi bộ nối lối đi bộ. */
const pathFamily = (p: Pick<SitePath, 'kind'>): 'road' | 'walk' | null =>
  p.kind === 'vehicle' || p.kind === 'shared'
    ? 'road'
    : p.kind === 'pedestrian' || p.kind === 'covered'
      ? 'walk'
      : null;

/**
 * Đầu đường trùng với một đỉnh (đầu mút hoặc góc gãy) của đường khác cùng họ — chỗ hai đường nối
 * thành khuỷu / ngã ba. Đầu cắt vuông ở đó để lộ khấc ở góc ngoài, nên được bo tròn (như nét
 * `lineJoin: round` của một đường liền) để mặt đường liền một khối.
 */
export function pathElbows(
  paths: readonly SitePath[],
): Map<SitePath['id'], { start: boolean; end: boolean }> {
  const out = new Map<SitePath['id'], { start: boolean; end: boolean }>();
  for (const p of paths) {
    const family = pathFamily(p);
    if (!family || p.points.length < 2) continue;
    const touches = (at: Point) =>
      paths.some(
        (q) =>
          q !== p &&
          pathFamily(q) === family &&
          q.points.some((v) => distance(v, at) <= ELBOW_TOLERANCE),
      );
    const start = touches(p.points[0]!);
    const end = touches(p.points[p.points.length - 1]!);
    if (start || end) out.set(p.id, { start, end });
  }
  return out;
}
