/**
 * Chỉ đường liên toà trong một cơ sở.
 *
 * Ý tưởng: dùng lại `findRoute` cho phần TRONG từng toà, và dựng thêm một đồ thị nhỏ gồm:
 * - "cổng" của các toà: cửa chính (ra ngoài trời) và cửa đầu cầu nối;
 * - đồ thị đi bộ ngoài trời, tự sinh từ các lối đi bộ đã vẽ (`SitePlan.paths`);
 * - cầu nối giữa các toà.
 * Chi phí tính bằng giây. Tuyến kết quả gồm các chặng (trong toà / ngoài trời / cầu nối).
 */
import { apronAreas, siteAprons } from './aprons';
import { campusSitePlan } from './exterior';
import {
  buildingFootprint,
  campusLevel,
  campusGroundLevel,
  placedFootprint,
  isStairLike,
  rampWalkLines,
  sidewalkWidth,
  toSite,
  type BuildingLink,
  type Campus,
  type SiteArea,
  type SitePath,
  type SitePlan,
  type SitePoi,
} from './campus';
import {
  boundsOf,
  distance,
  normalize,
  offsetPolyline,
  pointOnWall,
  projectPointOnSegment,
  segmentIntersection,
  sub,
} from './geometry';
import { dijkstra, pathTo } from './graph';
import {
  createBuildingRouter,
  WALK_SPEED,
  type BuildingRouter,
  type RouteOptions,
  type RouteTarget,
} from './navigation';
import type {
  Building,
  Id,
  Location,
  Point,
  Route,
  RouteInstructionType,
  RouteSegment,
} from './types';

/* ------------------------------------------------------------------ */
/* Kiểu dữ liệu                                                        */
/* ------------------------------------------------------------------ */

/** Điểm xuất phát: trong một toà, hoặc một điểm ngoài trời (toạ độ mặt bằng tổng thể). */
export type CampusFrom = ({ buildingId: Id } & Location) | { site: Point };

export type CampusTarget =
  | { buildingId: Id; roomId: Id }
  | { buildingId: Id; landmarkId: Id }
  | { poiId: Id }
  | ({ buildingId: Id } & Location);

export interface CampusRouteOptions extends RouteOptions {
  /** Ưu tiên lối có mái che / đi trong nhà (đi ngoài trời không che bị tính đắt hơn). */
  preferCovered?: boolean;
}

export type CampusLeg =
  | { kind: 'indoor'; buildingId: Id; route: Route }
  | {
      kind: 'outdoor';
      /** Toạ độ mặt bằng tổng thể. */
      path: Point[];
      distance: number;
      seconds: number;
      /** Phần lớn chặng (≥ 70% quãng đường) đi dưới mái che. */
      covered: boolean;
    }
  | { kind: 'link'; link: BuildingLink; path: Point[]; distance: number; seconds: number };

export type CampusStepType =
  RouteInstructionType | 'exit-building' | 'enter-building' | 'take-link';

export interface CampusStep {
  type: CampusStepType;
  text: string;
  /** null = ngoài trời. */
  buildingId: Id | null;
  floorId: Id | null;
  distance: number;
  /** Chặng chứa bước này. */
  legIndex: number;
}

export interface CampusRoute {
  campusId: Id;
  legs: CampusLeg[];
  steps: CampusStep[];
  distance: number;
  estimatedSeconds: number;
  destinationName: string;
}

export class CampusRouteError extends Error {
  constructor(
    public readonly code: 'UNKNOWN_BUILDING' | 'UNKNOWN_POI' | 'NOT_IN_CAMPUS',
    message: string,
  ) {
    super(message);
    this.name = 'CampusRouteError';
  }
}

/* ------------------------------------------------------------------ */
/* Đồ thị đi bộ ngoài trời                                             */
/* ------------------------------------------------------------------ */

interface Edge {
  to: string;
  /** Chi phí (giây). */
  cost: number;
  meta: EdgeMeta;
}

type EdgeMeta =
  | { kind: 'outdoor'; from: Point; to: Point; covered: boolean }
  | { kind: 'door' }
  | { kind: 'indoor'; buildingId: Id; route: Route }
  | { kind: 'link'; link: BuildingLink; from: Point; to: Point }
  | { kind: 'none' };

type Graph = Map<string, Edge[]>;

const addEdge = (g: Graph, from: string, edge: Edge) => {
  const list = g.get(from);
  if (list) list.push(edge);
  else g.set(from, [edge]);
};

/** Bán kính gộp đầu lối đi vào thân lối khác (m). */
const JOIN_RADIUS = 0.75;
/** Phạt (giây) mỗi lần đi qua cửa ra / vào toà — để không vòng ra ngoài khi trong nhà gần bằng. */
const DOOR_PENALTY = 5;

export const isWalkable = (p: SitePath) =>
  (p.kind === 'pedestrian' ||
    p.kind === 'covered' ||
    p.kind === 'shared' ||
    isStairLike(p) ||
    (p.kind === 'ramp' && !!p.walkway)) &&
  p.points.length >= 2;

/** Điểm cách mép sân / sảnh trong khoảng này (m) vẫn tính là ở sân (vd. cửa toà sát mép sân). */
const PLAZA_REACH = 1.5;

/** Đầu lối đi bộ trên dốc nối vào lối đi gần nhất trong bán kính này (m) — chân dốc ở mép đường. */
const RAMP_JOIN_RADIUS = 6;

interface AttachTarget {
  key: string;
  position: Point;
}

interface Seg {
  a: Point;
  b: Point;
  covered: boolean;
  accessible: boolean;
  ts: number[];
  /** Bán kính nối đầu đoạn vào thân đoạn khác. */
  join: number;
  /** Đầu đoạn khác cách thân đoạn này trong bán kính này thì nối vào (vỉa hè: tính cả bề rộng). */
  catch: number;
}

const samePt = (a: Point, b: Point) => distance(a, b) < 1e-6;
const pointKey = (p: Point) => `s:${Math.round(p.x * 100)}:${Math.round(p.y * 100)}`;
const lerpPt = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const paramOn = (s: Seg, p: Point) => {
  const len2 = (s.b.x - s.a.x) ** 2 + (s.b.y - s.a.y) ** 2;
  return len2 ? ((p.x - s.a.x) * (s.b.x - s.a.x) + (p.y - s.a.y) * (s.b.y - s.a.y)) / len2 : 0;
};

/**
 * Đồ thị đi bộ ngoài trời: tách các lối đi tại chỗ giao nhau / chỗ nối chữ T, rồi nối từng điểm
 * cần gắn (cửa chính, cổng, điểm ngoài trời, điểm xuất phát) vào lối gần nhất. Nếu chưa vẽ lối đi
 * nào, các điểm được nối thẳng với nhau (đi tắt qua sân).
 */
export function buildSiteWalkGraph(
  paths: readonly SitePath[],
  targets: readonly AttachTarget[],
  options: CampusRouteOptions = {},
  areas: readonly SiteArea[] = [],
): Graph {
  const g: Graph = new Map();
  const cost = (d: number, covered: boolean) =>
    (d / WALK_SPEED) * (covered || !options.preferCovered ? 1 : 1.6);
  const link = (a: string, pa: Point, b: string, pb: Point, covered: boolean) => {
    const d = distance(pa, pb);
    addEdge(g, a, {
      to: b,
      cost: cost(d, covered),
      meta: { kind: 'outdoor', from: pa, to: pb, covered },
    });
    addEdge(g, b, {
      to: a,
      cost: cost(d, covered),
      meta: { kind: 'outdoor', from: pb, to: pa, covered },
    });
  };

  const segs: Seg[] = [];
  const joiners: [Point, Point][] = [];
  /** Đường chung có vỉa hè: nửa bề rộng lòng đường + các đoạn vỉa hè hai bên. */
  const roads: { p: SitePath; half: number; sides: Seg[][] }[] = [];
  for (const p of paths) {
    if (!isWalkable(p)) continue;
    if (options.accessibleOnly && (p.accessible === false || p.kind === 'steps')) continue;
    // Dốc: người đi bộ đi trên lối đi bộ bên cạnh lòng dốc, không đi giữa làn xe.
    // Đường chung: đi trên vỉa hè hai bên, không đi giữa lòng đường.
    const sw = sidewalkWidth(p);
    const off = p.width / 2 - sw / 2;
    const lines =
      p.kind === 'ramp'
        ? rampWalkLines(p, paths)
        : sw > 0
          ? [offsetPolyline(p.points, off), offsetPolyline(p.points, -off)]
          : [p.points];
    const sides = lines.map((line) => {
      const list: Seg[] = [];
      for (let i = 0; i + 1 < line.length; i++) {
        list.push({
          a: line[i]!,
          b: line[i + 1]!,
          covered: p.kind === 'covered',
          accessible: p.accessible !== false && p.kind !== 'steps',
          ts: [0, 1],
          join: p.kind === 'ramp' ? RAMP_JOIN_RADIUS : JOIN_RADIUS,
          // Bậc thang / mặt dốc rộng cả cạnh sảnh: lối đi chạm vào chỗ nào của bề ngang cũng nối được.
          catch:
            sw > 0
              ? sw / 2 + JOIN_RADIUS
              : isStairLike(p)
                ? p.width / 2 + JOIN_RADIUS
                : JOIN_RADIUS,
        });
      }
      segs.push(...list);
      return list;
    });
    if (sw > 0) {
      roads.push({ p, half: p.width / 2 - sw, sides });
      // Qua đường ở hai đầu và mỗi chỗ đường đổi hướng (thường là ngã ba, ngã tư).
      const [left, right] = lines as [Point[], Point[]];
      left.forEach((q, i) => joiners.push([q, right[i]!]));
    }
  }

  if (!segs.length) {
    // Chưa có lối đi: nối thẳng mọi cặp điểm.
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const a = targets[i]!;
        const b = targets[j]!;
        link(a.key, a.position, b.key, b.position, false);
      }
    }
    return g;
  }

  // Giao nhau giữa các đoạn.
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i]!;
      const t = segs[j]!;
      const hit = segmentIntersection(s.a, s.b, t.a, t.b);
      if (hit) {
        s.ts.push(paramOn(s, hit));
        t.ts.push(paramOn(t, hit));
      }
    }
  }
  // Đầu đoạn chạm (gần) thân đoạn khác → nối chữ T. Đầu lối đi bộ trên dốc (bán kính lớn hơn)
  // chỉ nối vào đoạn gần nhất, và chỉ ở đầu tự do (không phải chỗ nối giữa hai đoạn của dốc).
  const isFreeEnd = (s: Seg, end: Point) =>
    !segs.some((t) => t !== s && t.join === s.join && (samePt(t.a, end) || samePt(t.b, end)));
  for (const s of segs) {
    for (const end of [s.a, s.b]) {
      if (s.join > JOIN_RADIUS) {
        if (!isFreeEnd(s, end)) continue;
        let best: { t: Seg; point: Point; d: number } | null = null;
        for (const t of segs) {
          if (t === s || t.join === s.join) continue;
          const proj = projectPointOnSegment(end, t.a, t.b);
          if (proj.distance <= s.join && (!best || proj.distance < best.d)) {
            best = { t, point: proj.point, d: proj.distance };
          }
        }
        if (best && best.d > 1e-6) {
          best.t.ts.push(paramOn(best.t, best.point));
          joiners.push([end, best.point]);
        }
        continue;
      }
      for (const t of segs) {
        if (t === s) continue;
        const proj = projectPointOnSegment(end, t.a, t.b);
        if (proj.distance > 1e-6 && proj.distance <= t.catch) {
          t.ts.push(paramOn(t, proj.point));
          joiners.push([end, proj.point]);
        }
      }
    }
  }
  // Lối đi vẽ tới giữa lòng đường chung (vd. tới tim đường) là chỗ qua đường: nối sang vỉa hè gần
  // nhất ở mỗi bên.
  for (const road of roads) {
    const own = new Set(road.sides.flat());
    const pts = road.p.points;
    const inRoad = (q: Point) =>
      pts.some(
        (a, i) =>
          i + 1 < pts.length && projectPointOnSegment(q, a, pts[i + 1]!).distance < road.half,
      );
    for (const s of segs) {
      if (own.has(s)) continue;
      for (const end of [s.a, s.b]) {
        if (!inRoad(end)) continue;
        for (const side of road.sides) {
          let best: { t: Seg; point: Point; d: number } | null = null;
          for (const t of side) {
            const proj = projectPointOnSegment(end, t.a, t.b);
            if (!best || proj.distance < best.d) best = { t, point: proj.point, d: proj.distance };
          }
          if (best && best.d > 1e-6) {
            best.t.ts.push(paramOn(best.t, best.point));
            joiners.push([end, best.point]);
          }
        }
      }
    }
  }
  // Điểm cần gắn → hình chiếu lên đoạn gần nhất.
  for (const target of targets) {
    let best: { seg: Seg; point: Point; d: number } | null = null;
    for (const s of segs) {
      const proj = projectPointOnSegment(target.position, s.a, s.b);
      if (!best || proj.distance < best.d) best = { seg: s, point: proj.point, d: proj.distance };
    }
    if (!best) continue;
    best.seg.ts.push(paramOn(best.seg, best.point));
    link(target.key, target.position, pointKey(best.point), best.point, false);
  }

  // Sân / sảnh là chỗ người đi bộ: đi thẳng giữa các đầu lối đi, đỉnh dốc, cửa nằm trong (sát) sân
  // và chỗ lối đi cắt / chạy sát mép sân. Chỉ đi thẳng khi đường thẳng không ra khỏi sân (sân lõm,
  // vd. mặt lát nối quanh sảnh).
  const plazaLinks: [string, Point, string, Point][] = [];
  for (const area of areas) {
    if (area.kind !== 'plaza' || area.polygon.length < 3) continue;
    const poly = area.polygon;
    const near = nearPolygon(poly, PLAZA_REACH);
    const anchors = new Map<string, Point>();
    for (const s of segs) {
      for (const end of [s.a, s.b]) if (near(end)) anchors.set(pointKey(end), end);
      // Điểm của đoạn gần sân nhất: chỗ cắt mép sân, hoặc chỗ chạy sát mép sân.
      let best: { t: number; p: Point; d: number } | null = null;
      for (let i = 0; i < poly.length; i++) {
        const hit = segmentIntersection(s.a, s.b, poly[i]!, poly[(i + 1) % poly.length]!);
        if (hit) {
          best = { t: paramOn(s, hit), p: hit, d: 0 };
          break;
        }
        const proj = projectPointOnSegment(poly[i]!, s.a, s.b);
        if (!best || proj.distance < best.d) {
          best = { t: paramOn(s, proj.point), p: proj.point, d: proj.distance };
        }
      }
      if (best && best.t > 1e-6 && best.t < 1 - 1e-6 && near(best.p)) {
        s.ts.push(best.t);
        anchors.set(pointKey(best.p), best.p);
      }
    }
    for (const t of targets) if (near(t.position)) anchors.set(t.key, t.position);
    const staysIn = (a: Point, b: Point) => {
      const n = Math.ceil(distance(a, b) / 0.5);
      for (let k = 1; k < n; k++) if (!near(lerpPt(a, b, k / n))) return false;
      return true;
    };
    const list = [...anchors];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [ka, pa] = list[i]!;
        const [kb, pb] = list[j]!;
        if (staysIn(pa, pb)) plazaLinks.push([ka, pa, kb, pb]);
      }
    }
  }

  for (const s of segs) {
    const ts = [...new Set(s.ts.map((t) => Math.min(1, Math.max(0, t))))].sort((a, b) => a - b);
    for (let i = 0; i + 1 < ts.length; i++) {
      const pa = lerpPt(s.a, s.b, ts[i]!);
      const pb = lerpPt(s.a, s.b, ts[i + 1]!);
      if (distance(pa, pb) < 1e-3) continue;
      link(pointKey(pa), pa, pointKey(pb), pb, s.covered);
    }
  }
  for (const [a, b] of joiners) link(pointKey(a), a, pointKey(b), b, false);
  for (const [ka, pa, kb, pb] of plazaLinks) link(ka, pa, kb, pb, false);
  return g;
}

/**
 * Hàm kiểm tra "điểm nằm trong đa giác hoặc cách mép không quá `reach`" — như
 * `pointInPolygon(p, poly) || khoảng cách tới cạnh ≤ reach` nhưng chia ô để mỗi lần chỉ xét các
 * cạnh gần điểm (mặt lát nối quanh sảnh có hàng chục đỉnh, và được hỏi hàng chục nghìn lần).
 */
function nearPolygon(poly: readonly Point[], reach: number): (p: Point) => boolean {
  const box = boundsOf(poly);
  if (!box) return () => false;
  const CELL = 2;
  const minX = box.minX - reach;
  const minY = box.minY - reach;
  const maxX = box.maxX + reach;
  const maxY = box.maxY + reach;
  const cols = Math.max(1, Math.ceil((maxX - minX) / CELL));
  const rows = Math.max(1, Math.ceil((maxY - minY) / CELL));
  const col = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor((x - minX) / CELL)));
  const row = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor((y - minY) / CELL)));
  /** Cạnh có thể cách ô ≤ reach. */
  const cellEdges: number[][] = Array.from({ length: cols * rows }, () => []);
  /** Cạnh cắt dải ngang của hàng (cho phép đếm giao điểm của tia ngang). */
  const rowEdges: number[][] = Array.from({ length: rows }, () => []);
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    const r0 = row(Math.min(a.y, b.y) - reach);
    const r1 = row(Math.max(a.y, b.y) + reach);
    const c0 = col(Math.min(a.x, b.x) - reach);
    const c1 = col(Math.max(a.x, b.x) + reach);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cellEdges[r * cols + c]!.push(i);
    for (let r = row(Math.min(a.y, b.y)); r <= row(Math.max(a.y, b.y)); r++) rowEdges[r]!.push(i);
  }
  return (p) => {
    if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) return false;
    const r = row(p.y);
    let inside = false;
    for (const i of rowEdges[r]!) {
      const a = poly[i]!;
      const b = poly[(i + 1) % n]!;
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
    if (inside) return true;
    for (const i of cellEdges[r * cols + col(p.x)]!) {
      if (projectPointOnSegment(p, poly[i]!, poly[(i + 1) % n]!).distance <= reach) return true;
    }
    return false;
  };
}

/* ------------------------------------------------------------------ */
/* Cổng của toà                                                        */
/* ------------------------------------------------------------------ */

interface Portal {
  key: string;
  buildingId: Id;
  openingId: Id;
  /** Vị trí nút đồ thị của ô cửa (theo hệ trục toà) — điểm bắt đầu / kết thúc chặng trong toà. */
  location: Location;
  /** Vị trí trên mặt bằng tổng thể. */
  site: Point;
  outdoor: boolean;
}

/** Cửa chính (ra ngoài trời) và cửa đầu cầu nối của các toà có trong `buildings`. */
function collectPortals(campus: Campus, buildings: ReadonlyMap<Id, Building>): Portal[] {
  const linkDoors = new Set(
    (campus.links ?? []).flatMap((l) => [l.a, l.b]).map((e) => e.openingId),
  );
  const portals: Portal[] = [];
  for (const pl of campus.buildings) {
    const b = buildings.get(pl.buildingId);
    if (!b) continue;
    for (const floor of b.floors) {
      for (const o of floor.openings) {
        const outdoor = o.type === 'entrance';
        const linked = linkDoors.has(o.id);
        if (!outdoor && !linked) continue;
        const node = floor.navGraph.nodes.find((n) => n.refId === o.id);
        // Cửa đầu cầu chưa có nút trên đồ thị (vẽ cửa xong chưa tạo lại đồ thị): vẫn dùng tâm ô cửa
        // — chặng trong toà tự bắt vào nút gần nhất của tầng — để chỉ đường vẫn đi qua cầu.
        const wall = node ? undefined : floor.walls.find((w) => w.id === o.wallId);
        const position = node?.position ?? (linked && wall ? pointOnWall(wall, o.offset) : null);
        if (!position || (!node && !floor.navGraph.nodes.length)) continue;
        portals.push({
          key: `p:${b.id}:${o.id}`,
          buildingId: b.id,
          openingId: o.id,
          location: { floorId: floor.id, position },
          site: toSite(pl, position),
          outdoor: outdoor && !!node,
        });
      }
    }
  }
  return portals;
}

/* ------------------------------------------------------------------ */
/* Tìm đường                                                           */
/* ------------------------------------------------------------------ */

const TURN_DEG = 35;

/** Các bước đi bộ ngoài trời: đi thẳng / rẽ trái / rẽ phải theo đường gấp khúc. */
function outdoorSteps(path: Point[], legIndex: number): CampusStep[] {
  const steps: CampusStep[] = [];
  let run = 0;
  const flush = () => {
    if (run >= 1) {
      steps.push({
        type: 'straight',
        text: `Đi thẳng ${Math.round(run)} m`,
        buildingId: null,
        floorId: null,
        distance: run,
        legIndex,
      });
    }
    run = 0;
  };
  for (let i = 0; i + 1 < path.length; i++) {
    run += distance(path[i]!, path[i + 1]!);
    const next = path[i + 2];
    if (!next) break;
    const d1 = normalize(sub(path[i + 1]!, path[i]!));
    const d2 = normalize(sub(next, path[i + 1]!));
    const angle =
      (Math.atan2(d1.x * d2.y - d1.y * d2.x, d1.x * d2.x + d1.y * d2.y) * 180) / Math.PI;
    if (Math.abs(angle) >= TURN_DEG && distance(next, path[i + 1]!) >= 1) {
      flush();
      // Trục y hướng xuống: góc dương = rẽ phải.
      steps.push({
        type: angle > 0 ? 'turn-right' : 'turn-left',
        text: angle > 0 ? 'Rẽ phải' : 'Rẽ trái',
        buildingId: null,
        floorId: null,
        distance: 0,
        legIndex,
      });
    }
  }
  flush();
  return steps;
}

/** Gộp các điểm liên tiếp trùng nhau. */
function dedupe(points: Point[]): Point[] {
  return points.filter((p, i) => i === 0 || distance(p, points[i - 1]!) > 1e-6);
}

/** Chặng trong toà giữa hai nút của đồ thị liên toà (bỏ qua nếu không có đường). */
function addIndoor(g: Graph, fromKey: string, toKey: string, b: Building, route: Route | null) {
  if (!route) return;
  addEdge(g, fromKey, {
    to: toKey,
    cost: route.estimatedSeconds,
    meta: { kind: 'indoor', buildingId: b.id, route },
  });
}

/** Phần dựng sẵn của một cơ sở: chỉ phụ thuộc dữ liệu bản đồ, không phụ thuộc điểm đi / đến. */
interface PreparedCampus {
  campus: Campus;
  buildings: ReadonlyMap<Id, Building>;
  options: CampusRouteOptions;
  site: SitePlan | undefined;
  /** Khu vực ngoài trời kèm mặt lát nối quanh sảnh. */
  areas: SiteArea[];
  byBuilding: Map<Id, Portal[]>;
  /** Các điểm cố định gắn vào đồ thị đi bộ (cửa chính, điểm ngoài trời, cổng). */
  walkTargets: AttachTarget[];
  /** Đồ thị đi bộ ngoài trời với các điểm cố định. */
  walk: Graph;
  /** Cửa ra / vào, cầu nối và các chặng trong toà giữa hai cổng. */
  fixed: Graph;
  router(b: Building): BuildingRouter;
}

function prepareCampus(
  campus: Campus,
  buildings: ReadonlyMap<Id, Building>,
  options: CampusRouteOptions,
): PreparedCampus {
  // Phần ngoài trời của cơ sở + sảnh, dốc… của từng toà (đặt theo vị trí toà).
  const site = campusSitePlan(campus, (id) => buildings.get(id)?.exterior);
  const portals = collectPortals(campus, buildings);
  const routers = new Map<Id, BuildingRouter>();
  const router = (b: Building) => {
    let r = routers.get(b.id);
    if (!r) routers.set(b.id, (r = createBuildingRouter(b, options)));
    return r;
  };

  // Mặt lát nối quanh sảnh (lấp khoảng hở giữa sảnh và các lối đi) cũng là chỗ đi bộ như sân.
  const footprints = campus.buildings.flatMap((pl) => {
    const b = buildings.get(pl.buildingId);
    return b ? [placedFootprint(pl, buildingFootprint(b))] : [];
  });
  const areas = site ? [...site.areas, ...apronAreas(siteAprons(site, footprints))] : [];

  // Đi bộ ngoài trời: nối cửa chính, điểm ngoài trời, cổng.
  const walkTargets: AttachTarget[] = [
    ...portals.filter((p) => p.outdoor).map((p) => ({ key: `out:${p.key}`, position: p.site })),
    ...(site?.pois ?? []).map((p) => ({ key: `poi:${p.id}`, position: p.position })),
    ...(site?.gates ?? []).map((gt) => ({ key: `gate:${gt.id}`, position: gt.position })),
  ];
  const walk = buildSiteWalkGraph(site?.paths ?? [], walkTargets, options, areas);

  const fixed: Graph = new Map();
  for (const p of portals.filter((x) => x.outdoor)) {
    addEdge(fixed, p.key, { to: `out:${p.key}`, cost: DOOR_PENALTY, meta: { kind: 'door' } });
    addEdge(fixed, `out:${p.key}`, { to: p.key, cost: DOOR_PENALTY, meta: { kind: 'door' } });
  }

  // Cầu nối.
  for (const link of campus.links ?? []) {
    if (options.accessibleOnly && !link.accessible) continue;
    const a = portals.find(
      (p) => p.buildingId === link.a.buildingId && p.openingId === link.a.openingId,
    );
    const b = portals.find(
      (p) => p.buildingId === link.b.buildingId && p.openingId === link.b.openingId,
    );
    if (!a || !b) continue;
    const d = Math.max(distance(a.site, b.site), 1);
    const cost = (d / WALK_SPEED) * (link.covered || !options.preferCovered ? 1 : 1.6);
    addEdge(fixed, a.key, {
      to: b.key,
      cost,
      meta: { kind: 'link', link, from: a.site, to: b.site },
    });
    addEdge(fixed, b.key, {
      to: a.key,
      cost,
      meta: { kind: 'link', link, from: b.site, to: a.site },
    });
  }

  // Đi xuyên một toà: từ mỗi cổng tới mọi cổng khác của toà — một lần Dijkstra cho mỗi cổng.
  const byBuilding = new Map<Id, Portal[]>();
  for (const p of portals) {
    byBuilding.set(p.buildingId, [...(byBuilding.get(p.buildingId) ?? []), p]);
  }
  for (const [id, list] of byBuilding) {
    const b = buildings.get(id)!;
    for (const p of list) {
      const others = list.filter((q) => q !== p);
      let routes: (Route | null)[];
      try {
        routes = router(b).routes(
          p.location,
          others.map((q) => q.location),
        );
      } catch {
        continue; // Cổng không gắn được vào đồ thị trong toà: bỏ qua cổng này.
      }
      others.forEach((q, i) => addIndoor(fixed, p.key, q.key, b, routes[i]!));
    }
  }

  return { campus, buildings, options, site, areas, byBuilding, walkTargets, walk, fixed, router };
}

/**
 * Bộ tìm đường của một cơ sở: dựng sẵn phần ngoài trời, mặt lát nối, các cổng và chặng trong toà
 * giữa các cổng — phần tốn thời gian nhất — để dùng lại cho nhiều lần tìm. Dữ liệu được chụp lúc
 * tạo: cơ sở / toà nhà sửa sau đó cần tạo bộ tìm đường mới.
 */
export interface CampusRouter {
  readonly campus: Campus;
  readonly options: CampusRouteOptions;
  route(from: CampusFrom, target: CampusTarget): CampusRoute | null;
}

export function createCampusRouter(
  campus: Campus,
  buildings: ReadonlyMap<Id, Building>,
  options: CampusRouteOptions = {},
): CampusRouter {
  const prepared = prepareCampus(campus, buildings, options);
  return { campus, options, route: (from, target) => routeInCampus(prepared, from, target) };
}

/**
 * Tìm đường (nhanh nhất) giữa hai điểm bất kỳ trong cơ sở, có thể đi qua nhiều toà.
 * Tìm nhiều lần trên cùng dữ liệu: dùng `createCampusRouter`.
 * @param buildings dữ liệu đầy đủ của các toà trong cơ sở.
 * @returns null nếu không có đường đi.
 */
export function findCampusRoute(
  campus: Campus,
  buildings: ReadonlyMap<Id, Building>,
  from: CampusFrom,
  target: CampusTarget,
  options: CampusRouteOptions = {},
): CampusRoute | null {
  return createCampusRouter(campus, buildings, options).route(from, target);
}

function routeInCampus(
  ctx: PreparedCampus,
  from: CampusFrom,
  target: CampusTarget,
): CampusRoute | null {
  const { campus, buildings, options, site, byBuilding } = ctx;
  const inCampus = (id: Id) => campus.buildings.some((pl) => pl.buildingId === id);
  const building = (id: Id) => {
    const b = buildings.get(id);
    if (!b) throw new CampusRouteError('UNKNOWN_BUILDING', `Không tìm thấy toà nhà "${id}"`);
    if (!inCampus(id)) {
      throw new CampusRouteError('NOT_IN_CAMPUS', `Toà "${b.name}" không thuộc cơ sở này`);
    }
    return b;
  };
  const poi: SitePoi | undefined =
    'poiId' in target ? site?.pois.find((p) => p.id === target.poiId) : undefined;
  if ('poiId' in target && !poi) {
    throw new CampusRouteError('UNKNOWN_POI', `Không tìm thấy điểm "${target.poiId}"`);
  }
  const fromBuilding = 'site' in from ? null : building(from.buildingId);
  const toBuilding = 'buildingId' in target ? building(target.buildingId) : null;
  const indoorTarget: RouteTarget | null =
    'roomId' in target
      ? { roomId: target.roomId }
      : 'landmarkId' in target
        ? { landmarkId: target.landmarkId }
        : 'floorId' in target
          ? { floorId: target.floorId, position: target.position }
          : null;
  // Điểm đến không hợp lệ (phòng không tồn tại, chưa có trong đồ thị…): báo đúng lỗi thay vì
  // "không có đường".
  if (toBuilding && indoorTarget) ctx.router(toBuilding).assertTarget(indoorTarget);

  // Xuất phát ngoài trời: gắn thêm điểm xuất phát vào đồ thị đi bộ (dựng lại phần ngoài trời).
  const walk =
    'site' in from
      ? buildSiteWalkGraph(
          site?.paths ?? [],
          [...ctx.walkTargets, { key: 'S', position: from.site }],
          options,
          ctx.areas,
        )
      : ctx.walk;

  // Điểm xuất phát / đích.
  const extra: Graph = new Map();
  if (fromBuilding && !('site' in from)) {
    const start: Location = { floorId: from.floorId, position: from.position };
    const list = byBuilding.get(fromBuilding.id) ?? [];
    const sameTarget = toBuilding?.id === fromBuilding.id ? indoorTarget : null;
    const routes = ctx
      .router(fromBuilding)
      .routes(start, [...list.map((p) => p.location), ...(sameTarget ? [sameTarget] : [])]);
    list.forEach((p, i) => addIndoor(extra, 'S', p.key, fromBuilding, routes[i]!));
    if (sameTarget) addIndoor(extra, 'S', 'T', fromBuilding, routes[list.length]!);
  }
  if (toBuilding && indoorTarget) {
    const router = ctx.router(toBuilding);
    for (const q of byBuilding.get(toBuilding.id) ?? []) {
      addIndoor(extra, q.key, 'T', toBuilding, router.route(q.location, indoorTarget));
    }
  } else if (poi) {
    addEdge(extra, `poi:${poi.id}`, { to: 'T', cost: 0, meta: { kind: 'none' } });
  }

  const none: Edge[] = [];
  const neighbors = (k: string): Edge[] => {
    const lists = [walk.get(k), ctx.fixed.get(k), extra.get(k)].filter((l) => l !== undefined);
    return lists.length === 1 ? lists[0]! : lists.length ? lists.flat() : none;
  };
  const tree = dijkstra('S', neighbors, (k) => k === 'T');
  const path = pathTo(tree, 'T');
  if (!path) return null;
  const found = { edges: path.slice(1).map((s) => s.via!), cost: tree.dist.get('T')! };

  // Gộp các cạnh thành chặng.
  const legs: CampusLeg[] = [];
  /** Quãng đường có mái che của từng chặng ngoài trời. */
  const coveredDist = new Map<CampusLeg, number>();
  for (const e of found.edges) {
    const m = e.meta;
    if (m.kind === 'indoor') {
      legs.push({ kind: 'indoor', buildingId: m.buildingId, route: m.route });
    } else if (m.kind === 'outdoor') {
      const last = legs[legs.length - 1];
      const d = distance(m.from, m.to);
      let leg = last?.kind === 'outdoor' ? last : undefined;
      if (leg) {
        leg.path.push(m.to);
        leg.distance += d;
        leg.seconds += d / WALK_SPEED;
      } else {
        leg = {
          kind: 'outdoor',
          path: [m.from, m.to],
          distance: d,
          seconds: d / WALK_SPEED,
          covered: false,
        };
        legs.push(leg);
      }
      if (m.covered) coveredDist.set(leg, (coveredDist.get(leg) ?? 0) + d);
    } else if (m.kind === 'link') {
      const d = distance(m.from, m.to);
      legs.push({
        kind: 'link',
        link: m.link,
        path: [m.from, m.to],
        distance: d,
        seconds: d / WALK_SPEED,
      });
    }
  }
  for (const leg of legs) {
    if (leg.kind !== 'outdoor') continue;
    leg.path = dedupe(leg.path);
    // Phần lớn chặng (≥ 70%) đi dưới mái che thì coi là lối có mái che (đoạn nối ra cửa thường hở).
    leg.covered = (coveredDist.get(leg) ?? 0) >= leg.distance * 0.7;
  }

  const nameOf = (id: Id) => buildings.get(id)?.name ?? id;
  const destinationName = poi
    ? poi.name
    : ((
        legs.findLast((l) => l.kind === 'indoor') as { route: Route } | undefined
      )?.route.instructions
        .findLast((i) => i.type === 'arrive')
        ?.text.replace(/^Đến /, '') ?? 'điểm đến');

  // Các bước.
  const steps: CampusStep[] = [];
  legs.forEach((leg, li) => {
    const next = legs[li + 1];
    const isLast = li === legs.length - 1;
    if (leg.kind === 'indoor') {
      const ins = leg.route.instructions.filter(
        (i) => !(i.type === 'start' && li > 0) && !(i.type === 'arrive' && !isLast),
      );
      if (li > 0) {
        const prev = legs[li - 1]!;
        steps.push({
          type: 'enter-building',
          text:
            prev.kind === 'link'
              ? `Vào ${nameOf(leg.buildingId)} từ ${prev.link.name}`
              : `Vào ${nameOf(leg.buildingId)} qua cửa chính`,
          buildingId: leg.buildingId,
          floorId: leg.route.from.floorId,
          distance: 0,
          legIndex: li,
        });
      }
      for (const i of ins) {
        steps.push({ ...i, buildingId: leg.buildingId, floorId: i.floorId, legIndex: li });
      }
      if (next?.kind === 'outdoor') {
        steps.push({
          type: 'exit-building',
          text: `Ra khỏi ${nameOf(leg.buildingId)} qua cửa chính`,
          buildingId: leg.buildingId,
          floorId: leg.route.to.floorId,
          distance: 0,
          legIndex: li,
        });
      }
    } else if (leg.kind === 'outdoor') {
      if (li === 0) {
        steps.push({
          type: 'start',
          text: 'Bắt đầu tại vị trí hiện tại (ngoài trời)',
          buildingId: null,
          floorId: null,
          distance: 0,
          legIndex: li,
        });
      }
      const where =
        next?.kind === 'indoor' ? ` tới ${nameOf(next.buildingId)}` : poi ? ` tới ${poi.name}` : '';
      steps.push({
        type: 'straight',
        text: `Đi bộ ngoài trời ${Math.round(leg.distance)} m${leg.covered ? ' theo lối có mái che' : ''}${where}`,
        buildingId: null,
        floorId: null,
        distance: 0,
        legIndex: li,
      });
      steps.push(...outdoorSteps(leg.path, li));
      if (isLast && poi) {
        steps.push({
          type: 'arrive',
          text: `Đến ${poi.name}`,
          buildingId: null,
          floorId: null,
          distance: 0,
          legIndex: li,
        });
      }
    } else {
      const to =
        leg.link.a.buildingId === (legs[li - 1] as { buildingId?: Id })?.buildingId
          ? leg.link.b
          : leg.link.a;
      steps.push({
        type: 'take-link',
        text: `Qua ${leg.link.name} sang ${nameOf(to.buildingId)} (${Math.round(leg.distance)} m)`,
        buildingId: null,
        floorId: null,
        distance: leg.distance,
        legIndex: li,
      });
    }
  });

  const total = legs.reduce((s, l) => s + (l.kind === 'indoor' ? l.route.distance : l.distance), 0);
  return {
    campusId: campus.id,
    legs,
    steps,
    distance: total,
    estimatedSeconds: Math.round(found.cost),
    destinationName,
  };
}

/* ------------------------------------------------------------------ */
/* Đổi sang toạ độ mặt bằng tổng thể (để vẽ bằng RouteLayer)          */
/* ------------------------------------------------------------------ */

/** "Tầng" ảo của bản đồ cơ sở: tầng chung `level` → `floorId` dạng `L<level>`. */
export const levelFloorId = (level: number) => `L${level}`;
export const levelOfFloorId = (floorId: Id): number | null =>
  /^L-?\d+$/.test(floorId) ? Number(floorId.slice(1)) : null;

/**
 * Đổi tuyến liên toà thành một `Route` theo toạ độ mặt bằng tổng thể, mỗi tầng chung của cơ sở là
 * một "tầng" `L<level>` — để vẽ bằng `RouteLayer` / `routeSegmentsOnFloor` như tuyến trong toà.
 * Chặng ngoài trời nằm ở tầng mặt đất; chặng cùng tầng liên tiếp được nối liền.
 */
export function campusRouteToSiteRoute(
  route: CampusRoute,
  campus: Campus,
  buildings: ReadonlyMap<Id, Building>,
): Route {
  const levelsOf = (id: Id) => buildings.get(id)?.floors.map((f) => f.level);
  const ground = campusGroundLevel(campus, levelsOf);
  const placement = (id: Id) => campus.buildings.find((pl) => pl.buildingId === id)!;
  const levelOfFloor = (buildingId: Id, floorId: Id) => {
    const f = buildings.get(buildingId)?.floors.find((x) => x.id === floorId);
    return f ? campusLevel(placement(buildingId), f.level) : ground;
  };

  const raw: RouteSegment[] = [];
  for (const leg of route.legs) {
    if (leg.kind === 'indoor') {
      const pl = placement(leg.buildingId);
      for (const s of leg.route.segments) {
        raw.push({
          floorId: levelFloorId(levelOfFloor(leg.buildingId, s.floorId)),
          path: s.path.map((p) => toSite(pl, p)),
          transition: s.transition && {
            ...s.transition,
            toFloorId: levelFloorId(levelOfFloor(leg.buildingId, s.transition.toFloorId)),
          },
        });
      }
    } else if (leg.kind === 'outdoor') {
      raw.push({ floorId: levelFloorId(ground), path: leg.path });
    } else {
      raw.push({
        floorId: levelFloorId(levelOfFloor(leg.link.a.buildingId, leg.link.a.floorId)),
        path: leg.path,
      });
    }
  }
  // Nối các đoạn liên tiếp cùng tầng (không chuyển tầng ở giữa).
  const segments: RouteSegment[] = [];
  for (const s of raw) {
    const last = segments[segments.length - 1];
    if (last && !last.transition && last.floorId === s.floorId) {
      last.path = dedupe([...last.path, ...s.path]);
      last.transition = s.transition;
    } else {
      segments.push({ ...s, path: dedupe(s.path) });
    }
  }

  const stepLevel = (st: CampusStep) =>
    st.buildingId && st.floorId ? levelOfFloor(st.buildingId, st.floorId) : ground;
  const first = segments[0];
  const lastSeg = segments[segments.length - 1];
  const lastIndoor = [...route.legs].reverse().find((l) => l.kind === 'indoor') as
    Extract<CampusLeg, { kind: 'indoor' }> | undefined;
  const finalLegIsIndoor = route.legs[route.legs.length - 1]?.kind === 'indoor';
  const entry = finalLegIsIndoor && lastIndoor?.route.entry;
  return {
    buildingId: campus.id,
    from: {
      floorId: first?.floorId ?? levelFloorId(ground),
      position: first?.path[0] ?? { x: 0, y: 0 },
    },
    to: {
      floorId: lastSeg?.floorId ?? levelFloorId(ground),
      position: lastSeg?.path[lastSeg.path.length - 1] ?? { x: 0, y: 0 },
    },
    distance: route.distance,
    estimatedSeconds: route.estimatedSeconds,
    segments,
    instructions: route.steps.map((st) => ({
      // Các loại bước riêng của cơ sở hiển thị như "đi thẳng" với trình vẽ trong toà.
      type: (['exit-building', 'enter-building', 'take-link'].includes(st.type)
        ? 'straight'
        : st.type) as RouteInstructionType,
      text: st.text,
      floorId: levelFloorId(stepLevel(st)),
      distance: st.distance,
    })),
    entry:
      entry && lastIndoor
        ? {
            ...entry,
            floorId: levelFloorId(levelOfFloor(lastIndoor.buildingId, entry.floorId)),
            position: toSite(placement(lastIndoor.buildingId), entry.position),
          }
        : undefined,
  };
}
