import {
  distance,
  lerp,
  toDegrees,
  type Id,
  type Point,
  type Route,
  type RouteInstructionType,
  type RouteSegment,
} from '@hwn/map-core';

export interface FloorRouteSegment extends RouteSegment {
  /** Vị trí của đoạn trong `route.segments`. */
  index: number;
  /** Quãng đường (m, tính từ đầu tuyến) tại điểm đầu và điểm cuối đoạn. */
  start: number;
  end: number;
  /** Đoạn đầu tiên của cả tuyến (bắt đầu tại vị trí người dùng). */
  isFirst: boolean;
  /** Đoạn cuối cùng của cả tuyến (kết thúc tại điểm đến). */
  isLast: boolean;
  /** Tầng của đoạn ngay trước (nếu người dùng đến tầng này bằng thang). */
  arrivedFromFloorId?: Id;
}

/** Các đoạn của tuyến đường nằm trên `floorId`. */
export function routeSegmentsOnFloor(route: Route, floorId: Id): FloorRouteSegment[] {
  return routeTrack(route).filter((s) => s.floorId === floorId);
}

/** Các tầng tuyến đường đi qua, theo thứ tự. */
export const routeFloorIds = (route: Route): Id[] => [
  ...new Set(route.segments.map((s) => s.floorId)),
];

export const flattenPoints = (points: readonly Point[]): number[] =>
  points.flatMap((p) => [p.x, p.y]);

/* ------------------------------------------------------------------ */
/* Đi dọc polyline                                                     */
/* ------------------------------------------------------------------ */

export interface PolylinePosition {
  point: Point;
  /** Hướng đi tại điểm đó (độ, 0 = trục +x, theo chiều kim đồng hồ). */
  heading: number;
}

const headingOf = (a: Point, b: Point) => toDegrees(Math.atan2(b.y - a.y, b.x - a.x));

/** Điểm cách đầu polyline `d` mét (kẹp trong [0, chiều dài]). */
export function pointAlong(points: readonly Point[], d: number): PolylinePosition {
  const first = points[0];
  if (!first) return { point: { x: 0, y: 0 }, heading: 0 };
  if (points.length === 1) return { point: first, heading: 0 };
  let rest = Math.max(0, d);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = distance(a, b);
    if (rest <= len || i === points.length - 1) {
      const t = len > 0 ? Math.min(1, rest / len) : 1;
      return { point: lerp(a, b, t), heading: headingOf(a, b) };
    }
    rest -= len;
  }
  return { point: points[points.length - 1]!, heading: 0 };
}

/** Phần polyline nằm giữa quãng đường `from` và `to` (m, tính từ đầu polyline). */
export function slicePolyline(points: readonly Point[], from: number, to: number): Point[] {
  if (points.length < 2) return [...points];
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.max(lo, to);
  const out: Point[] = [pointAlong(points, lo).point];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    acc += distance(points[i - 1]!, points[i]!);
    if (acc > lo && acc < hi) out.push(points[i]!);
    if (acc >= hi) break;
  }
  out.push(pointAlong(points, hi).point);
  return out;
}

/** Quãng đường tích luỹ tới từng đỉnh của polyline. */
function vertexDistances(points: readonly Point[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++)
    out.push(out[i - 1]! + distance(points[i - 1]!, points[i]!));
  return out;
}

/* ------------------------------------------------------------------ */
/* Toàn tuyến                                                          */
/* ------------------------------------------------------------------ */

/**
 * Các đoạn của tuyến kèm quãng đường tích luỹ. Đi thang không tính quãng đường, nên điểm cuối
 * đoạn này và điểm đầu đoạn sau có cùng giá trị — vì vậy vị trí trên tuyến luôn cần cả
 * `segmentIndex` lẫn quãng đường.
 */
export function routeTrack(route: Route): FloorRouteSegment[] {
  let acc = 0;
  return route.segments.map((segment, i) => {
    const length = vertexDistances(segment.path).at(-1) ?? 0;
    const start = acc;
    acc += length;
    return {
      ...segment,
      index: i,
      start,
      end: acc,
      isFirst: i === 0,
      isLast: i === route.segments.length - 1,
      arrivedFromFloorId: i > 0 ? route.segments[i - 1]!.floorId : undefined,
    };
  });
}

export interface RoutePosition extends PolylinePosition {
  floorId: Id;
  segmentIndex: number;
}

/** Vị trí trên đoạn `segmentIndex` tại quãng đường `d` (m, tính từ đầu tuyến). */
export function positionOnTrack(
  track: readonly FloorRouteSegment[],
  segmentIndex: number,
  d: number,
): RoutePosition | null {
  const s = track[segmentIndex];
  if (!s) return null;
  return { ...pointAlong(s.path, d - s.start), floorId: s.floorId, segmentIndex };
}

/* ------------------------------------------------------------------ */
/* Hình học của từng bước hướng dẫn                                     */
/* ------------------------------------------------------------------ */

export interface RouteStepGeometry {
  type: RouteInstructionType;
  floorId: Id;
  segmentIndex: number;
  /** Quãng đường (m, từ đầu tuyến) khi người dùng bắt đầu bước này. */
  begin: number;
  /** Khoảng quãng đường được làm nổi bật trên bản đồ. */
  from: number;
  to: number;
  /** Phần đường được làm nổi bật (thuộc đoạn `segmentIndex`). */
  path: Point[];
  /** Nơi diễn ra thao tác: góc rẽ, cửa thang, điểm đến… */
  anchor: Point;
}

/** Số mét trước/sau góc rẽ được làm nổi bật để người dùng thấy rõ hướng rẽ. */
const TURN_CONTEXT_M = 4;
/** Số mét cuối trước khi tới thang / điểm đến được làm nổi bật. */
const APPROACH_M = 8;
/** Khoảng cách tối đa để "hít" điểm kết thúc chặng đi thẳng vào góc rẽ gần nhất. */
const SNAP_M = 1.5;

/**
 * Gắn hình học cho từng bước của `route.instructions` bằng cách đi dọc tuyến theo
 * `distance` của các bước "đi thẳng". Không phụ thuộc cách server sinh câu chữ, chỉ cần
 * các bước đúng thứ tự và có quãng đường.
 */
export function routeStepGeometry(route: Route): RouteStepGeometry[] {
  const track = routeTrack(route);
  const lastSeg = track.at(-1);
  if (!lastSeg) return [];

  let seg = 0;
  let cursor = 0;
  const make = (
    type: RouteInstructionType,
    segIndex: number,
    begin: number,
    from: number,
    to: number,
    anchorAt: number,
  ): RouteStepGeometry => {
    const s = track[segIndex]!;
    const clamp = (v: number) => Math.min(s.end, Math.max(s.start, v));
    const lo = clamp(from);
    const hi = clamp(to);
    return {
      type,
      floorId: s.floorId,
      segmentIndex: segIndex,
      begin,
      from: lo,
      to: hi,
      path: slicePolyline(s.path, lo - s.start, hi - s.start),
      anchor: pointAlong(s.path, clamp(anchorAt) - s.start).point,
    };
  };
  /** Điểm cuối chặng: hít vào đỉnh (góc rẽ) gần nhất nếu đủ gần. */
  const snap = (s: FloorRouteSegment, d: number) => {
    let best = d;
    let bestGap = SNAP_M;
    for (const v of vertexDistances(s.path)) {
      const gap = Math.abs(s.start + v - d);
      if (gap < bestGap) {
        best = s.start + v;
        bestGap = gap;
      }
    }
    return best;
  };

  return route.instructions.map((ins) => {
    while (seg < track.length - 1 && track[seg]!.floorId !== ins.floorId) {
      seg++;
      cursor = track[seg]!.start;
    }
    const s = track[seg]!;
    switch (ins.type) {
      case 'start':
        return make(ins.type, seg, cursor, s.start, s.end, cursor);
      case 'straight': {
        const begin = cursor;
        cursor = snap(s, Math.min(s.end, cursor + ins.distance));
        return make(ins.type, seg, begin, begin, cursor, cursor);
      }
      case 'turn-left':
      case 'turn-right':
        return make(
          ins.type,
          seg,
          cursor,
          cursor - TURN_CONTEXT_M,
          cursor + TURN_CONTEXT_M,
          cursor,
        );
      case 'enter-room': {
        // `distance` = số mét còn phải đi tới cửa (0 nếu đã có bước đi thẳng ngay trước).
        const door = Math.min(s.end, cursor + ins.distance);
        const from = Math.min(cursor, door - TURN_CONTEXT_M);
        cursor = door;
        return make(ins.type, seg, door, from, door + TURN_CONTEXT_M, door);
      }
      case 'take-elevator':
      case 'take-stairs':
      case 'take-escalator': {
        const step = make(ins.type, seg, s.end, s.end - APPROACH_M, s.end, s.end);
        if (seg < track.length - 1) {
          seg++;
          cursor = track[seg]!.start;
        }
        return step;
      }
      case 'arrive':
        return make(
          ins.type,
          lastSeg.index,
          lastSeg.end,
          lastSeg.end - APPROACH_M,
          lastSeg.end,
          lastSeg.end,
        );
    }
  });
}

const isManeuver = (type: RouteInstructionType) => type !== 'start' && type !== 'straight';

/**
 * Bước nên hiển thị khi người dùng đang ở quãng đường `d` trên đoạn `segmentIndex`:
 * thao tác sắp tới (rẽ, lên thang, tới nơi) nếu còn cách ≤ `lookahead` mét, ngược lại là
 * chặng đang đi. Một góc rẽ được coi là đã qua khi đi quá nó `passed` mét.
 */
export function stepIndexAt(
  steps: readonly RouteStepGeometry[],
  segmentIndex: number,
  d: number,
  lookahead = 3,
  passed = 1,
): number {
  const onSeg = steps.flatMap((s, i) => (s.segmentIndex === segmentIndex ? [i] : []));
  if (!onSeg.length) return 0;
  const next = onSeg.find((i) => isManeuver(steps[i]!.type) && steps[i]!.begin >= d - passed);
  if (next === undefined) return onSeg[onSeg.length - 1]!;
  if (steps[next]!.begin - d <= lookahead) return next;
  const before = onSeg.filter((i) => i < next);
  return before.length ? before[before.length - 1]! : next;
}
