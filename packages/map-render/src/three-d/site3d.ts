/**
 * Dựng hình 3D phần ngoài trời của cơ sở: khu vực, đường xe, dốc nghiêng lên sảnh (kèm lối đi bộ),
 * lối đi bộ, mái che, hàng rào, cổng. Toạ độ mặt bằng tổng thể (x, y) → three.js (x, cao độ, y).
 *
 * Quy ước cao độ: mặt đường = 0; sảnh (khu vực "sân / sảnh", "đón / trả khách") và sàn tầng trệt
 * các toà nằm trên bệ cao `PLINTH` m — dốc nối từ mặt đường lên bệ này. Mặt lát nối quanh sảnh
 * (`siteAprons`) cũng nằm trên bệ, cao bằng sảnh, có bậc xuống ở mép giáp lối đi / vỉa hè.
 */
import * as THREE from 'three';
import {
  DEFAULT_RAMP_RISE,
  distance,
  isGateOpen,
  offsetPolyline,
  pointInPolygon,
  polylineLength,
  projectPointOnSegment,
  rampCenterline,
  rampRise,
  rampWalkLines,
  rampWalkWidth,
  sidewalkWidth,
  simplifyPolygon,
  siteAprons,
  stepsFor,
  STEP_TREAD,
  type Point,
  type SitePath,
  type SitePlan,
} from '@hwn/map-core';
import { crosswalks, cutPolyline, gateShape, pathElbows } from '../two-d/siteGeometry';
import { mergeAll, prism } from './geometry';
import { buildGateModel } from './pointModels';
import { strokeGeometry } from './stroke';

/** Cao độ bệ sảnh / sàn tầng trệt so với mặt đường (m). */
export const PLINTH = DEFAULT_RAMP_RISE;

/** Dải phẳng (có thể nghiêng) dọc đường gấp khúc, cao độ từng đỉnh theo `heights`. */
export function ribbon(
  points: readonly Point[],
  width: number,
  heights: readonly number[],
): THREE.BufferGeometry | null {
  if (points.length < 2 || width <= 0) return null;
  const left = offsetPolyline(points, -width / 2);
  const right = offsetPolyline(points, width / 2);
  const pos: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const l0 = [left[i]!.x, heights[i]!, left[i]!.y];
    const r0 = [right[i]!.x, heights[i]!, right[i]!.y];
    const l1 = [left[i + 1]!.x, heights[i + 1]!, left[i + 1]!.y];
    const r1 = [right[i + 1]!.x, heights[i + 1]!, right[i + 1]!.y];
    pos.push(...l0, ...r0, ...l1, ...r0, ...r1, ...l1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Vách đứng dọc đường gấp khúc, từ cao độ `base[i]` lên `top[i]`. */
export function skirt(
  points: readonly Point[],
  base: readonly number[],
  top: readonly number[],
): THREE.BufferGeometry | null {
  if (points.length < 2) return null;
  const pos: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const a0 = [a.x, base[i]!, a.y];
    const a1 = [a.x, top[i]!, a.y];
    const b0 = [b.x, base[i + 1]!, b.y];
    const b1 = [b.x, top[i + 1]!, b.y];
    pos.push(...a0, ...b0, ...a1, ...b0, ...b1, ...a1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Cao độ tăng đều theo chiều dài đường gấp khúc, từ `from` tới `to`. */
function slope(points: readonly Point[], from: number, to: number): number[] {
  const total = polylineLength(points) || 1;
  let acc = 0;
  return points.map((p, i) => {
    if (i > 0) acc += distance(points[i - 1]!, p);
    return from + ((to - from) * acc) / total;
  });
}

/** Các đoạn của đường gấp khúc nằm NGOÀI vùng `inside` (mép vùng tìm bằng chia đôi, sai số ~1 cm). */
export function outsidePieces(points: readonly Point[], inside: (p: Point) => boolean): Point[][] {
  const pieces: Point[][] = [];
  let current: Point[] = [];
  const lerp = (a: Point, b: Point, t: number): Point => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  /** Điểm mép vùng trên đoạn a → b, biết `inside(a) !== inside(b)`. */
  const edge = (a: Point, b: Point) => {
    const at = inside(a);
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2;
      if (inside(lerp(a, b, mid)) === at) lo = mid;
      else hi = mid;
    }
    return lerp(a, b, (lo + hi) / 2);
  };
  let prev = points[0];
  if (!prev) return [];
  let prevIn = inside(prev);
  if (!prevIn) current.push(prev);
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const n = Math.max(1, Math.ceil(distance(a, b) / 0.25));
    for (let k = 1; k <= n; k++) {
      const q = k === n ? b : lerp(a, b, k / n);
      const qIn = inside(q);
      if (qIn !== prevIn) {
        const e = edge(prev!, q);
        if (qIn) {
          current.push(e);
          if (current.length >= 2) pieces.push(current);
          current = [];
        } else {
          current = [e];
        }
      }
      if (!qIn && k === n) current.push(q);
      prev = q;
      prevIn = qIn;
    }
  }
  if (current.length >= 2) pieces.push(current);
  return pieces;
}

/**
 * Bỏ phần đầu của đường gấp khúc nằm trong vùng `inside` (vd. chân dốc trong lòng đường): đường mới
 * bắt đầu tại chỗ ra khỏi vùng. Phần sau đó giữ nguyên. Cả đường nằm trong vùng thì trả về rỗng.
 */
export function trimStart(points: readonly Point[], inside: (p: Point) => boolean): Point[] {
  if (!points.length || !inside(points[0]!)) return [...points];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const n = Math.max(1, Math.ceil(distance(a, b) / 0.25));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      if (inside({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) continue;
      let lo = (k - 1) / n;
      let hi = t;
      for (let j = 0; j < 12; j++) {
        const mid = (lo + hi) / 2;
        if (inside({ x: a.x + (b.x - a.x) * mid, y: a.y + (b.y - a.y) * mid })) lo = mid;
        else hi = mid;
      }
      const e = { x: a.x + (b.x - a.x) * hi, y: a.y + (b.y - a.y) * hi };
      return hi < 1 ? [e, ...points.slice(i + 1)] : [...points.slice(i + 1)];
    }
  }
  return [];
}

/** Cao độ trên đường gấp khúc `line` (cao độ từng đỉnh `heights`) tại hình chiếu của `p`. */
function heightAlong(line: readonly Point[], heights: readonly number[], p: Point): number {
  let best = { d: Infinity, h: heights[0] ?? 0 };
  for (let i = 0; i + 1 < line.length; i++) {
    const proj = projectPointOnSegment(p, line[i]!, line[i + 1]!);
    if (proj.distance < best.d) {
      best = { d: proj.distance, h: heights[i]! + (heights[i + 1]! - heights[i]!) * proj.t };
    }
  }
  return best.h;
}

/** Tứ giác phẳng theo 4 góc (toạ độ mặt bằng) với cao độ riêng từng góc. */
function quad(corners: readonly Point[], heights: readonly number[]): THREE.BufferGeometry {
  const v = corners.map((c, i) => [c.x, heights[i]!, c.y]);
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [...v[0]!, ...v[1]!, ...v[2]!, ...v[0]!, ...v[2]!, ...v[3]!],
      3,
    ),
  );
  g.computeVertexNormals();
  return g;
}

const RAISED = new Set(['plaza', 'dropoff']);

/** Mặt nhựa đường xe ở cao độ này so với mặt đất (dốc bắt đầu từ đây để liền với mặt đường). */
const ROAD_TOP = 0.1;

export interface SiteMeshes {
  /** Mặt khu vực theo màu từng loại. */
  areas: { geometry: THREE.BufferGeometry; color: string; opacity: number }[];
  /** Bệ sảnh nâng cao. */
  plinths: THREE.BufferGeometry | null;
  /** Công trình phụ (khối hộp). */
  structures: THREE.BufferGeometry | null;
  asphalt: THREE.BufferGeometry | null;
  paving: THREE.BufferGeometry | null;
  /** Viền màu đường xe / dốc (theo loại xe hoặc khu phục vụ). */
  edges: { geometry: THREE.BufferGeometry; color: string }[];
  /** Thân dốc (vách hai bên). */
  rampSides: THREE.BufferGeometry | null;
  roofs: THREE.BufferGeometry | null;
  posts: THREE.BufferGeometry | null;
  fences: THREE.BufferGeometry | null;
  /** Cổng (có màu theo đỉnh — `vertexColors`). */
  gates: THREE.BufferGeometry | null;
  /** Vạch qua đường (cùng vị trí với bản đồ 2D). */
  zebras: THREE.BufferGeometry | null;
  /** Vị trí biển tên dốc (đỉnh dốc + một chút), kèm màu. */
  rampSigns: { position: [number, number, number]; text: string; color: string }[];
}

/** Sai lệch (m) khi làm gọn mép răng cưa (theo lưới) của mặt lát nối để mép bậc không lởm chởm. */
const APRON_EDGE_TOLERANCE = 0.2;

/**
 * Dựng toàn bộ phần ngoài trời.
 * @param color màu theo khu vực / khu phục vụ (lấy từ bảng màu 2D để hai chế độ đồng nhất).
 * @param obstacles đường bao các toà (toạ độ mặt bằng tổng thể) — mặt lát nối không lát đè lên toà.
 */
export function buildSiteMeshes(
  site: SitePlan,
  colors: {
    area: (kind: SitePlan['areas'][number]['kind']) => string;
    edge: (p: SitePath) => string | null;
    rampLabel: (p: SitePath) => string;
  },
  obstacles: readonly (readonly Point[])[] = [],
): SiteMeshes {
  const raised = site.areas.filter((a) => RAISED.has(a.kind) && a.polygon.length >= 3);
  const ramps = site.paths.filter((p) => p.kind === 'ramp' && p.points.length >= 2);
  const rampTops = ramps.map((r) => ({ at: r.points[r.points.length - 1]!, rise: rampRise(r) }));
  /** Cao độ mặt đất tại `p`: trên bệ sảnh = PLINTH, đỉnh dốc = độ cao dốc, còn lại = 0. */
  const groundAt = (p: Point) =>
    raised.some((a) => pointInPolygon(p, a.polygon))
      ? PLINTH
      : (rampTops.find((t) => distance(t.at, p) < 0.5)?.rise ?? 0);
  const lifted = (points: readonly Point[], lift: number) => points.map((p) => groundAt(p) + lift);

  // Lòng đường (đường xe, đường chung, khu vực "đường") và bãi xe: phần dốc / viền màu của đường
  // khác lấn vào đây thì không dựng (bản đồ 2D che phần này bằng thứ tự vẽ).
  const roads = site.paths.filter(
    (p) => (p.kind === 'vehicle' || p.kind === 'shared') && p.points.length >= 2,
  );
  const roadAreas = site.areas.filter((a) => a.kind === 'road' && a.polygon.length >= 3);
  const lots = site.areas.filter(
    (a) => (a.kind === 'parking' || a.kind === 'bike_parking') && a.polygon.length >= 3,
  );
  /** `q` nằm trong (hoặc cách mép không quá `margin` m) lòng một đường khác `except`. */
  const inRoad = (q: Point, except?: SitePath, margin = 0) =>
    roads.some(
      (r) =>
        r !== except &&
        r.points.some(
          (a, i) =>
            i + 1 < r.points.length &&
            projectPointOnSegment(q, a, r.points[i + 1]!).distance <
              (r.width - 2 * sidewalkWidth(r)) / 2 + margin,
        ),
    ) || roadAreas.some((a) => pointInPolygon(q, a.polygon));
  const inLot = (q: Point) => lots.some((a) => pointInPolygon(q, a.polygon));
  const onPlaza = (q: Point) =>
    raised.some((a) => a.kind === 'plaza' && pointInPolygon(q, a.polygon));
  /** Lòng dốc đã dựng (tim + cao độ mặt nhựa) — để đặt vạch qua đường lên đúng mặt dốc. */
  const rampDecks: { line: Point[]; heights: number[]; half: number }[] = [];

  const areas: SiteMeshes['areas'] = [];
  const plinths: THREE.BufferGeometry[] = [];
  const structures: THREE.BufferGeometry[] = [];
  site.areas.forEach((a, i) => {
    if (a.polygon.length < 3) return;
    if (a.kind === 'structure') {
      structures.push(prism(a.polygon, 0, 3));
      return;
    }
    if (RAISED.has(a.kind)) {
      plinths.push(prism(a.polygon, 0, a.rise ?? PLINTH));
      return;
    }
    // Lệch cao độ rất nhỏ giữa các khu vực để không nhấp nháy khi chồng nhau.
    const g = prism(a.polygon, 0, 0.005 + (i % 8) * 0.002);
    areas.push({
      geometry: g,
      color: colors.area(a.kind),
      opacity: a.kind === 'road' || a.kind === 'parking' || a.kind === 'bike_parking' ? 1 : 0.85,
    });
  });

  // Mặt lát nối: cùng bệ với sảnh để sảnh và mặt lát liền một mặt.
  for (const a of siteAprons(site, obstacles)) {
    plinths.push(prism(simplifyPolygon(a.polygon, APRON_EDGE_TOLERANCE), 0, PLINTH));
  }

  const asphalt: THREE.BufferGeometry[] = [];
  const paving: THREE.BufferGeometry[] = [];
  const edges: SiteMeshes['edges'] = [];
  const rampSides: THREE.BufferGeometry[] = [];
  const roofs: THREE.BufferGeometry[] = [];
  const posts: THREE.BufferGeometry[] = [];
  const fences: THREE.BufferGeometry[] = [];
  const gates: THREE.BufferGeometry[] = [];
  const rampSigns: SiteMeshes['rampSigns'] = [];
  const push = (list: THREE.BufferGeometry[], g: THREE.BufferGeometry | null) => g && list.push(g);

  // Đầu đường nối vào đỉnh của đường cùng loại (khuỷu, ngã ba): bo tròn để mặt đường liền khối.
  const elbows = pathElbows(site.paths);
  for (const p of site.paths) {
    if (p.points.length < 2) continue;
    const pts = p.points;
    const elbow = elbows.get(p.id);
    const caps = { roundStart: !!elbow?.start, roundEnd: !!elbow?.end };
    switch (p.kind) {
      case 'vehicle':
      case 'shared': {
        // Làn xe chạy trên mặt sảnh (sảnh là điểm đón / trả khách): mặt sảnh dùng chung, không trải nhựa.
        if (p.kind === 'vehicle' && pts.every((q) => onPlaza(q))) break;
        const cw = p.width - 2 * sidewalkWidth(p);
        if (p.kind === 'shared')
          push(paving, strokeGeometry(pts, p.width, lifted(pts, 0.04), caps));
        const edge = colors.edge(p);
        if (edge) {
          // Viền màu chỉ dựng ở phần không nằm trong lòng đường khác / bãi xe.
          const first = pts[0]!;
          const last = pts[pts.length - 1]!;
          for (const piece of outsidePieces(pts, (q) => inRoad(q, p) || inLot(q))) {
            const g = strokeGeometry(piece, cw, lifted(piece, 0.07), {
              roundStart: caps.roundStart && piece[0] === first,
              roundEnd: caps.roundEnd && piece[piece.length - 1] === last,
            });
            if (g) edges.push({ geometry: g, color: edge });
          }
        }
        push(
          asphalt,
          strokeGeometry(pts, edge ? Math.max(cw - 0.6, cw * 0.7) : cw, lifted(pts, 0.1), caps),
        );
        break;
      }
      case 'ramp': {
        const full = rampCenterline(p, site.paths);
        // Dốc nghiêng từ mặt đường (chân dốc) lên bệ sảnh (đỉnh dốc), cao `rise` m.
        const rise = rampRise(p);
        const from = groundAt(full[0]!) === PLINTH ? 0 : groundAt(full[0]!);
        const surface = slope(full, from + 0.12, from + rise + 0.06);
        // Chân dốc nằm trong lòng đường: phần đó hạ xuống dưới mặt đường (mặt đường phủ lên, như thứ
        // tự vẽ của bản đồ 2D); từ mép lòng đường dốc mới nghiêng lên, bắt đầu ngang mặt đường.
        const rest = trimStart(full, (q) => inRoad(q));
        let rp = full;
        let deck = surface;
        if (rest[0] !== full[0]) {
          const head = full.filter((v) => !rest.includes(v));
          rp = [...head, ...rest];
          // Các đỉnh sát chân dốc mà bề ngang dốc còn chạm lòng đường thì giữ ngang mặt đường (dốc
          // cong chéo qua mép đường không bị nhô góc lên giữa lòng đường).
          const up = rest.length >= 2 ? slope(rest, ROAD_TOP - 0.04, from + rise + 0.06) : [];
          const clear = rest.findIndex((q) => !inRoad(q, undefined, p.width / 2));
          const hold = clear < 0 ? rest.length : clear;
          deck = [
            ...head.map(() => 0),
            ...rest.map((_, i) =>
              i < hold ? Math.min(up[i] ?? 0, ROAD_TOP - 0.04) : (up[i] ?? 0),
            ),
          ];
        }
        const edge = colors.edge(p) ?? '#d97706';
        if (rp.length >= 2) {
          const g = ribbon(rp, p.width, deck);
          if (g) edges.push({ geometry: g, color: edge });
          const top = deck.map((h) => h + 0.04);
          push(asphalt, ribbon(rp, Math.max(p.width - 0.6, p.width * 0.7), top));
          push(
            rampSides,
            skirt(
              offsetPolyline(rp, p.width / 2),
              rp.map(() => 0),
              deck,
            ),
          );
          push(
            rampSides,
            skirt(
              offsetPolyline(rp, -p.width / 2),
              rp.map(() => 0),
              deck,
            ),
          );
          rampDecks.push({ line: rp, heights: top, half: p.width / 2 });
        }
        const zero = full.map(() => 0);
        const walkW = rampWalkWidth(p);
        // Lối đi bộ cao hơn lòng dốc một bậc bó vỉa.
        for (const line of rampWalkLines(p, site.paths)) {
          const top = surface.map((h) => h + 0.15);
          push(paving, ribbon(line, walkW, top));
          push(rampSides, skirt(offsetPolyline(line, walkW / 2), zero, top));
          push(rampSides, skirt(offsetPolyline(line, -walkW / 2), zero, top));
        }
        const top = full[full.length - 1]!;
        rampSigns.push({
          position: [top.x, from + rise + 1.2, top.y],
          text: colors.rampLabel(p),
          color: edge,
        });
        break;
      }
      case 'pedestrian':
        // Đầu lối đi bo tròn như bản đồ 2D: chỗ các lối đi gặp nhau liền một mặt lát.
        push(
          paving,
          strokeGeometry(pts, p.width, lifted(pts, 0.06), { roundStart: true, roundEnd: true }),
        );
        break;
      case 'steps':
      case 'slope': {
        // Chân ở mặt đất, đỉnh ngang bệ sảnh: bậc thang = các khối chồng bậc, mặt dốc = mặt nghiêng.
        const rise = rampRise(p);
        const foot = pts[0]!;
        const end = pts[pts.length - 1]!;
        const len = distance(foot, end);
        if (p.kind === 'steps' && pts.length === 2 && len > 1e-6) {
          const dir = { x: (end.x - foot.x) / len, y: (end.y - foot.y) / len };
          const h = p.width / 2;
          const at = (d: number, s: number) => ({
            x: foot.x + dir.x * d - dir.y * s,
            y: foot.y + dir.y * d + dir.x * s,
          });
          const { count } = stepsFor(rise);
          const tread = Math.min(STEP_TREAD, len / count);
          for (let k = 0; k < count; k++) {
            const d = k * tread;
            plinths.push(
              prism([at(d, -h), at(len, -h), at(len, h), at(d, h)], 0, (rise * (k + 1)) / count),
            );
          }
        } else {
          const deck = slope(pts, 0.04, rise);
          push(paving, ribbon(pts, p.width, deck));
          const zero = pts.map(() => 0);
          push(rampSides, skirt(offsetPolyline(pts, p.width / 2), zero, deck));
          push(rampSides, skirt(offsetPolyline(pts, -p.width / 2), zero, deck));
        }
        break;
      }
      case 'covered': {
        const h = lifted(pts, 0.06);
        push(paving, strokeGeometry(pts, p.width, h, { roundStart: true, roundEnd: true }));
        push(
          roofs,
          ribbon(
            pts,
            p.width + 0.8,
            h.map((y) => y + 2.6),
          ),
        );
        for (const side of [p.width / 2 + 0.25, -(p.width / 2 + 0.25)]) {
          const line = offsetPolyline(pts, side);
          const len = polylineLength(line);
          for (let d = 0; d <= len; d += 5) {
            const at = pointAlong(line, d);
            const box = new THREE.BoxGeometry(0.15, 2.6, 0.15);
            box.translate(at.x, groundAt(at) + 1.3, at.y);
            posts.push(box);
          }
        }
        break;
      }
      case 'fence': {
        const holes = site.gates.map((gt) => ({
          position: gt.position,
          half: gateShape(gt, site.paths).half + 0.5,
        }));
        for (const piece of cutPolyline(pts, holes)) {
          push(
            fences,
            skirt(
              piece,
              piece.map(() => 0),
              piece.map(() => 1.6),
            ),
          );
        }
        break;
      }
    }
  }

  // Cổng: trụ cổng + cánh theo kiểu cổng (thanh chắn, 2 cánh, cổng kéo, cổng mở có biển trên).
  const now = new Date();
  for (const gt of site.gates) {
    gates.push(buildGateModel(gt, gateShape(gt, site.paths), isGateOpen(gt, now)));
  }

  // Vạch qua đường: cùng vị trí với bản đồ 2D, nằm sát mặt đường / mặt dốc tại chỗ đó.
  const zebras: THREE.BufferGeometry[] = [];
  const surfaceAt = (q: Point) => {
    for (const d of rampDecks) {
      if (
        d.line.some(
          (a, i) =>
            i + 1 < d.line.length && projectPointOnSegment(q, a, d.line[i + 1]!).distance <= d.half,
        )
      ) {
        // Không thấp hơn mặt đường (chân dốc nằm dưới mặt đường).
        return Math.max(heightAlong(d.line, d.heights, q), groundAt(q) + ROAD_TOP);
      }
    }
    return groundAt(q) + ROAD_TOP;
  };
  for (const z of crosswalks(site.paths)) {
    const rad = (z.angle * Math.PI) / 180;
    const u = { x: Math.cos(rad), y: Math.sin(rad) };
    const n = { x: -u.y, y: u.x };
    for (let t = -z.length / 2 + 0.5; t <= z.length / 2 - 0.4; t += 0.9) {
      const c = { x: z.p.x + u.x * t, y: z.p.y + u.y * t };
      const corners = [
        [-0.22, -z.span / 2],
        [0.22, -z.span / 2],
        [0.22, z.span / 2],
        [-0.22, z.span / 2],
      ].map(([a, b]) => ({ x: c.x + u.x * a! + n.x * b!, y: c.y + u.y * a! + n.y * b! }));
      zebras.push(
        quad(
          corners,
          corners.map((q) => surfaceAt(q) + 0.012),
        ),
      );
    }
  }

  // Dốc lên và dốc xuống của cùng một sảnh: chỉ một biển tên (đặt giữa hai đỉnh dốc).
  const signs: SiteMeshes['rampSigns'] = [];
  const counts: number[] = [];
  for (const s of rampSigns) {
    const i = signs.findIndex(
      (x) =>
        x.text === s.text &&
        Math.hypot(x.position[0] - s.position[0], x.position[2] - s.position[2]) < 25,
    );
    if (i < 0) {
      signs.push({ ...s, position: [...s.position] });
      counts.push(1);
    } else {
      const n = counts[i]!;
      const x = signs[i]!;
      x.position = [
        (x.position[0] * n + s.position[0]) / (n + 1),
        x.position[1],
        (x.position[2] * n + s.position[2]) / (n + 1),
      ];
      counts[i] = n + 1;
    }
  }

  return {
    areas,
    plinths: mergeAll(plinths),
    structures: mergeAll(structures),
    asphalt: mergeAll(asphalt),
    paving: mergeAll(paving),
    edges,
    rampSides: mergeAll(rampSides),
    roofs: mergeAll(roofs),
    posts: mergeAll(posts),
    fences: mergeAll(fences),
    gates: mergeAll(gates),
    zebras: mergeAll(zebras),
    rampSigns: signs,
  };
}

/** Điểm cách đầu đường gấp khúc `d` m. */
function pointAlong(points: readonly Point[], d: number): Point {
  let left = d;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const len = distance(a, b);
    if (left <= len && len > 0) {
      return { x: a.x + ((b.x - a.x) * left) / len, y: a.y + ((b.y - a.y) * left) / len };
    }
    left -= len;
  }
  return points[points.length - 1] ?? { x: 0, y: 0 };
}

export function disposeSiteMeshes(m: SiteMeshes) {
  for (const a of m.areas) a.geometry.dispose();
  for (const e of m.edges) e.geometry.dispose();
  for (const g of [
    m.plinths,
    m.structures,
    m.asphalt,
    m.paving,
    m.rampSides,
    m.roofs,
    m.posts,
    m.fences,
    m.gates,
    m.zebras,
  ]) {
    g?.dispose();
  }
}
