/**
 * Sảnh (`SiteLobby`) — MỘT đối tượng gồm bệ sảnh lát gạch sát tường toà, bậc thang / mặt dốc ở các
 * cạnh và (tuỳ chọn) làn đón ô tô với dốc lên / dốc xuống cong chữ S. Chỉ lưu thông số; các phần
 * (khu vực, đường) được sinh ra khi vẽ 2D / 3D, tính đầu nối và chỉ đường (`withLobbyParts`), nên
 * kéo / xoay / đổi kích thước sảnh thì mọi phần đi theo.
 *
 * Hệ trục của sảnh: `d` theo hướng ra ngoài (0 = tường, `depth` = mép trước), `s` dọc tường, dương
 * về phía TRÁI khi đứng ở cửa nhìn ra.
 */
import {
  DEFAULT_RAMP_RISE,
  rampCenterline,
  rampWalkLines,
  rampWalkWidth,
  type BuildingExterior,
  type LobbyEdge,
  type LobbyRampShape,
  type LobbySide,
  type SiteArea,
  type SiteLobby,
  type SitePath,
  type SitePlan,
  type SiteRampUse,
} from './campus';
import {
  add,
  distance,
  dot,
  normalize,
  offsetPolyline,
  pointInPolygon,
  polygonCentroid,
  projectPointOnSegment,
  rotatePoint,
  scale,
  segmentIntersection,
  sub,
} from './geometry';
import { createId } from './id';
import type { Id, Point } from './types';

/* ------------------------------------------------------------------ */
/* Sảnh đón dựng sẵn                                                   */
/* ------------------------------------------------------------------ */

export interface LobbyOptions {
  /** Tâm cửa chính (hệ trục của toà). */
  door: Point;
  /** Hướng từ cửa nhìn ra ngoài toà (vector đơn vị, vuông góc tường). */
  outward: Point;
  /** Sảnh phục vụ khu nào (màu + biểu tượng của dốc, làn đón). */
  use?: SiteRampUse;
  /** Tên sảnh, vd. "Sảnh Khoa Khám bệnh". */
  name?: string;
  /** Tên khu ghép vào tên làn / dốc, vd. "Khoa Khám bệnh". */
  title?: string;
  /** Bề ngang sảnh dọc theo tường (m). Mặc định 14. */
  width?: number;
  /** Chiều sâu sảnh tính từ tường (m). Mặc định 7. */
  depth?: number;
  /**
   * Khoảng cách từ tường tới chân dốc (m) — chân dốc nên rơi vào làn xe của đường nội bộ.
   * Mặc định = sảnh + làn đón + 3.25 m.
   */
  reach?: number;
  /** Khoảng cách từ tâm cửa tới mỗi chân dốc, dọc theo tường (m). Mặc định 12.5. */
  spread?: number;
  /** Hình hai dốc: cong chữ S (mặc định), thẳng vuông góc ra đường hoặc thẳng nối dài làn đón. */
  rampShape?: LobbyRampShape;
  /** Lối đi bộ có bó vỉa đi kèm hai dốc (người đi bộ, xe lăn). Mặc định có. */
  walkway?: boolean;
  /** Độ chênh cao chân dốc → mặt sảnh (m). Bỏ trống = mặc định của dốc. */
  rise?: number;
  /** Sinh ID theo khoá (`lobby`, `dropoff`, `lane`, `ramp_up`, `ramp_down`). */
  id?: (key: string) => Id;
}

/**
 * Cụm sảnh đón trước một cửa chính: sảnh lát gạch, khu đón / trả khách kẻ vạch, làn đón trả khách
 * một chiều sát sảnh, dốc lên (vào sảnh) và dốc xuống (ra đường) cong chữ S, mỗi dốc có lối đi bộ
 * phía toà nhà. Xe chạy bên phải: vào ở phía bên phải khi nhìn từ cửa ra, khách xuống xe ở phía sảnh.
 * Chân hai dốc là đầu nối — ở Khuôn viên chỉ cần cho đường nội bộ đi qua / nối vào hai điểm này.
 */
export function lobbyExterior(o: LobbyOptions): BuildingExterior {
  const n = normalize(o.outward);
  // Hướng dọc tường: làn đón chạy theo chiều -t, toà nằm bên phải chiều xe chạy.
  const t = { x: n.y, y: -n.x };
  const width = o.width ?? 14;
  const depth = o.depth ?? 7;
  const lane = DROPOFF_LANE;
  const laneD = depth + lane / 2;
  const reach = Math.max(o.reach ?? depth + lane + 3.25, laneD + 2);
  const spread = Math.max(o.spread ?? 12.5, 6);
  const half = dropoffHalf(width);
  const id = o.id ?? ((key: string) => createId(`ext_${key}`));
  const title = o.title ?? o.name ?? 'sảnh';
  const at = (d: number, s: number): Point => {
    const p = add(o.door, add(scale(n, d), scale(t, s)));
    return { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
  };
  const rect = (d0: number, s0: number, d1: number, s1: number) => [
    at(d0, s0),
    at(d1, s0),
    at(d1, s1),
    at(d0, s1),
  ];
  /** Cong chữ S (Bézier bậc 3, hai đầu cùng hướng dọc tường) từ (d0, s0) tới (d1, s1). */
  const sCurve = (d0: number, s0: number, d1: number, s1: number, steps = 6) => {
    const k = (s1 - s0) / 2;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const u = i / steps;
      const v = 1 - u;
      const bez = (a: number, c1: number, c2: number, b: number) =>
        v ** 3 * a + 3 * v * v * u * c1 + 3 * v * u * u * c2 + u ** 3 * b;
      return at(bez(d0, d0, d1, d1), bez(s0, s0 + k, s1 - k, s1));
    });
  };
  const top = half + 0.5;
  /**
   * Dốc thẳng: từ chân dốc đi thẳng vào phía tường, bo cung tròn bán kính `r` rồi nhập vào đầu làn
   * đón theo hướng dọc tường (chân dốc thẳng hàng với đầu làn, lệch ra ngoài một bán kính).
   */
  const straight = (sign: 1 | -1, steps = 6) => {
    const r = Math.min(3, Math.max(1, reach - laneD - 1));
    const arc = Array.from({ length: steps + 1 }, (_, i) => {
      const a = ((i / steps) * Math.PI) / 2;
      return at(laneD + r - Math.sin(a) * r, sign * (top + Math.cos(a) * r));
    });
    return [at(reach, sign * (top + r)), ...arc];
  };
  const common = {
    width: lane,
    vehicles: 'car' as const,
    ...(o.use ? { use: o.use } : {}),
  };
  const ramp = (key: string, flow: 'up' | 'down', sign: 1 | -1): SitePath => ({
    id: id(key),
    kind: 'ramp',
    name: `${flow === 'up' ? 'Dốc lên' : 'Dốc xuống'} – ${title}`,
    ...common,
    ...(o.walkway === false
      ? {}
      : { walkway: flow === 'up' ? ('right' as const) : ('left' as const), sidewalk: 1.5 }),
    flow,
    ...(o.rise !== undefined ? { rise: o.rise } : {}),
    points:
      o.rampShape === 'straight'
        ? straight(sign)
        : o.rampShape === 'inline'
          ? // Thẳng 180°: nối dài làn đón dọc theo tường, chân dốc ở hai bên sảnh.
            [at(laneD, sign * Math.max(spread, top + 4)), at(laneD, sign * top)]
          : sCurve(reach, sign * spread, laneD, sign * top),
  });
  return {
    areas: [
      {
        id: id('lobby'),
        kind: 'plaza',
        name: o.name ?? 'Sảnh',
        polygon: rect(0, -width / 2, depth, width / 2),
      },
      {
        id: id('dropoff'),
        kind: 'dropoff',
        name: 'Đón / trả khách',
        polygon: rect(depth, -half, depth + lane, half),
      },
    ],
    paths: [
      {
        id: id('lane'),
        kind: 'vehicle',
        name: `Làn đón trả khách – ${title}`,
        ...common,
        oneWay: true,
        points: [at(laneD, top), at(laneD, -top)],
      },
      ramp('ramp_up', 'up', 1),
      ramp('ramp_down', 'down', -1),
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Sảnh (một đối tượng)                                                */
/* ------------------------------------------------------------------ */

/** Ngăn cách ID sảnh với khoá của phần trong ID các phần sinh ra (vd. `lobby_x~ramp_up`). */
export const LOBBY_PART_SEP = '~';

/** ID của phần `key` thuộc sảnh `lobbyId`. */
export const lobbyPartId = (lobbyId: Id, key: string): Id => `${lobbyId}${LOBBY_PART_SEP}${key}`;

/** ID sảnh chứa phần có ID `id` (null nếu không phải phần của sảnh). */
export function lobbyIdOf(id: Id): Id | null {
  const i = id.indexOf(LOBBY_PART_SEP);
  return i > 0 ? id.slice(0, i) : null;
}

/** Bề rộng làn đón ô tô trước sảnh (m). */
export const DROPOFF_LANE = 3.5;

/** Nửa bề ngang khu đón trả khách (m) theo bề ngang sảnh; làn đón dài hơn 0.5 m mỗi đầu. */
const dropoffHalf = (width: number) => Math.min(4, width / 2 - 1);

/** Chiều cao tối đa một bậc (m). */
export const STEP_RISER = 0.16;
/** Chiều sâu mặt bậc (m). */
export const STEP_TREAD = 0.35;
/** Độ dốc cho xe lăn: dài 12 m cho mỗi 1 m chênh cao (1:12). */
export const SLOPE_RATIO = 12;
/** Bề ngang dốc xe lăn ở cạnh "bậc + dốc" (m). */
export const WHEELCHAIR_RAMP_WIDTH = 1.5;
/** Kích thước nhỏ nhất của sảnh (m). */
export const LOBBY_MIN_SIZE = 2;
/** Đỉnh bậc / dốc lấn vào bệ sảnh chừng này (m) để liền với sảnh. */
const TOP_INSET = 0.1;

/** Cao độ bệ sảnh (m). */
export const lobbyRise = (l: Pick<SiteLobby, 'rise'>): number =>
  l.rise !== undefined && l.rise >= 0 ? l.rise : DEFAULT_RAMP_RISE;

/** Số bậc và chiều sâu cả dãy bậc (m) để lên độ cao `rise`. */
export function stepsFor(rise: number) {
  const count = Math.max(1, Math.ceil(rise / STEP_RISER - 1e-9));
  return { count, run: count * STEP_TREAD };
}

/** Chiều dài mặt dốc xe lăn (m) để lên độ cao `rise`. */
export const slopeRun = (rise: number): number => Math.max(1, rise * SLOPE_RATIO);

const round2 = (v: number) => Math.round(v * 100) / 100 || 0;
const roundPt = (p: Point): Point => ({ x: round2(p.x), y: round2(p.y) });

/** Hệ trục của sảnh: `at(d, s)` → toạ độ; `local(p)` → (d, s). */
export function lobbyFrame(l: Pick<SiteLobby, 'position' | 'outward'>) {
  const n = normalize(l.outward);
  const t = { x: n.y, y: -n.x };
  const at = (d: number, s: number): Point => add(l.position, add(scale(n, d), scale(t, s)));
  const local = (p: Point) => {
    const v = sub(p, l.position);
    return { d: dot(v, n), s: dot(v, t) };
  };
  return { n, t, at, local };
}

/** Mặt bệ sảnh (hình chữ nhật, cùng thứ tự đỉnh với `lobbyExterior`). */
export function lobbyPolygon(l: SiteLobby): Point[] {
  const { at } = lobbyFrame(l);
  const h = l.width / 2;
  const d = lobbyFullDepth(l);
  return [at(0, -h), at(d, -h), at(d, h), at(0, h)].map(roundPt);
}

/**
 * Chiều sâu cả bệ sảnh tính từ tường (m): có đón / trả ô tô thì sảnh phủ luôn chỗ xe dừng (làn đón
 * chạy trên mặt sảnh) — sâu thêm một làn.
 */
export const lobbyFullDepth = (l: Pick<SiteLobby, 'depth' | 'dropoff'>): number =>
  l.depth + (l.dropoff ? DROPOFF_LANE : 0);

/** Kiểu một cạnh của sảnh. */
export function lobbyEdge(l: SiteLobby, side: LobbySide): LobbyEdge {
  return l.edges?.[side] ?? { kind: 'none' };
}

/**
 * Nửa bề ngang chỗ trống trước sảnh (m), giữa hai dốc ô tô, đo ở chân dãy bậc: tới chỗ gần tâm nhất
 * mà lòng dốc hoặc lối đi bộ trên dốc cắt đường chân bậc. Phần bậc lấn vào khúc bo của dốc nằm dưới
 * thân dốc (vẽ sau) nên dãy bậc lấp kín khoảng giữa hai dốc, không hở khe. Dốc không ra tới chân bậc
 * (vd. dốc thẳng 180° chạy trong sảnh) thì lấy cả bề ngang sảnh.
 */
function frontOpening(l: SiteLobby, paths: readonly SitePath[]): number {
  const { at, local } = lobbyFrame(l);
  const d = lobbyFullDepth(l) + stepsFor(lobbyRise(l)).run;
  const reach = l.width / 2 + 60;
  const a = at(d, -reach);
  const b = at(d, reach);
  let half = l.width / 2;
  for (const p of paths) {
    if (p.kind !== 'ramp') continue;
    const center = rampCenterline(p, paths);
    const lines = [
      offsetPolyline(center, p.width / 2),
      offsetPolyline(center, -p.width / 2),
      ...rampWalkLines(p, paths).flatMap((w) => {
        const ww = rampWalkWidth(p) / 2;
        return [offsetPolyline(w, ww), offsetPolyline(w, -ww)];
      }),
    ];
    for (const line of lines) {
      for (let i = 0; i + 1 < line.length; i++) {
        const hit = segmentIntersection(line[i]!, line[i + 1]!, a, b);
        if (hit) half = Math.min(half, Math.abs(local(hit).s));
      }
    }
  }
  return Math.max(0, half);
}

/**
 * Một cạnh của sảnh: tâm, hướng ra ngoài, hướng dọc cạnh (về bên trái khi nhìn ra), chiều dài. Có
 * đón / trả ô tô thì "cạnh trước" là mép ngoài chỗ xe dừng, giữa hai dốc (`frontHalf` = nửa bề ngang
 * chỗ trống giữa hai dốc).
 */
export function lobbyEdgeLine(l: SiteLobby, side: LobbySide, frontHalf = l.width / 2) {
  const { n, t, at } = lobbyFrame(l);
  const h = l.width / 2;
  const [center, out, length] =
    side === 'front'
      ? [at(lobbyFullDepth(l), 0), n, 2 * Math.min(frontHalf, h)]
      : side === 'left'
        ? [at(l.depth / 2, h), t, l.depth]
        : [at(l.depth / 2, -h), scale(t, -1), l.depth];
  return { center, out, left: { x: out.y, y: -out.x }, length };
}

/** Tên ghép vào tên dốc / làn / bậc, vd. "Sảnh Khoa Khám bệnh" → "Khoa Khám bệnh". */
const lobbyTitle = (l: SiteLobby) => (l.name ? l.name.replace(/^sảnh\s+/i, '') || l.name : 'sảnh');

const SIDE_LABEL: Record<LobbySide, string> = { front: 'trước', left: 'trái', right: 'phải' };

/** Bậc thang / mặt dốc ở cạnh `side`. */
function edgeParts(l: SiteLobby, side: LobbySide, title: string, frontHalf: number): SitePath[] {
  const edge = lobbyEdge(l, side);
  if (edge.kind === 'none') return [];
  const { center, out, left, length } = lobbyEdgeLine(l, side, frontHalf);
  if (length < 0.5) return [];
  const rise = lobbyRise(l);
  /** Một dãy bậc / mặt dốc rộng `span`, tâm lệch `offset` dọc cạnh (dương = bên trái). */
  const piece = (kind: 'steps' | 'slope', offset: number, span: number): SitePath => {
    const c = add(center, scale(left, offset));
    const run = kind === 'steps' ? stepsFor(rise).run : slopeRun(rise);
    return {
      id: lobbyPartId(l.id, `${kind}_${side}`),
      kind,
      name: `${kind === 'steps' ? 'Bậc thang' : 'Dốc xe lăn'} cạnh ${SIDE_LABEL[side]} – ${title}`,
      width: round2(span),
      rise,
      ...(kind === 'steps' ? { accessible: false } : {}),
      points: [roundPt(add(c, scale(out, run))), roundPt(sub(c, scale(out, TOP_INSET)))],
    };
  };
  const rw = Math.min(WHEELCHAIR_RAMP_WIDTH, length / 2);
  const sign = edge.rampAt === 'left' ? 1 : -1;
  const pieces =
    edge.kind === 'steps'
      ? [piece('steps', 0, length)]
      : edge.kind === 'ramp'
        ? [piece('slope', 0, length)]
        : [
            piece('steps', (-sign * rw) / 2, length - rw),
            piece('slope', (sign * (length - rw)) / 2, rw),
          ];
  return pieces;
}

const partsCache = new WeakMap<SiteLobby, BuildingExterior>();

/**
 * Các phần của sảnh: bệ sảnh (khu vực `plaza`), bậc thang / mặt dốc ở các cạnh và — nếu có đón / trả
 * ô tô — làn đón chạy trên mặt sảnh (sảnh chính là điểm đón / trả khách, không có khu kẻ vạch riêng),
 * dốc lên / dốc xuống. ID mỗi phần = `lobbyPartId(sảnh, khoá)`.
 */
export function lobbyParts(l: SiteLobby): BuildingExterior {
  const hit = partsCache.get(l);
  if (hit) return hit;
  const title = lobbyTitle(l);
  const id = (key: string) => lobbyPartId(l.id, key);
  const base: BuildingExterior = l.dropoff
    ? lobbyExterior({
        door: l.position,
        outward: l.outward,
        name: l.name ?? 'Sảnh',
        title,
        width: l.width,
        depth: l.depth,
        walkway: l.dropoff.walkway !== false,
        id,
        ...(l.use ? { use: l.use } : {}),
        ...(l.rise !== undefined ? { rise: l.rise } : {}),
        ...(l.dropoff.reach !== undefined ? { reach: l.dropoff.reach } : {}),
        ...(l.dropoff.spread !== undefined ? { spread: l.dropoff.spread } : {}),
        ...(l.dropoff.shape ? { rampShape: l.dropoff.shape } : {}),
      })
    : { areas: [], paths: [] };
  // Sảnh phủ cả chỗ xe dừng: một bệ sảnh duy nhất thay cho sảnh + khu đón trả khách.
  const plaza = {
    id: id('lobby'),
    kind: 'plaza' as const,
    name: l.name ?? 'Sảnh',
    polygon: lobbyPolygon(l),
    ...(l.rise !== undefined ? { rise: l.rise } : {}),
  };
  const frontHalf = frontOpening(l, base.paths);
  const parts = {
    areas: [plaza],
    paths: [
      ...base.paths,
      ...(['front', 'left', 'right'] as const).flatMap((s) => edgeParts(l, s, title, frontHalf)),
    ],
  };
  partsCache.set(l, parts);
  return parts;
}

const planCache = new WeakMap<object, object>();

/**
 * Mặt bằng với các phần của mọi sảnh ghép vào `areas` / `paths` (bỏ `lobbies`) — để vẽ, tính đầu nối,
 * chỉ đường như các đối tượng thường. Không có sảnh thì trả về chính `plan`. Lưu đệm theo `plan`.
 */
export function withLobbyParts<T extends Pick<SitePlan, 'areas' | 'paths' | 'lobbies'>>(
  plan: T,
): T {
  if (!plan.lobbies?.length) return plan;
  const hit = planCache.get(plan);
  if (hit) return hit as T;
  const { lobbies, ...rest } = plan;
  const parts = lobbies.map(lobbyParts);
  const out = {
    ...rest,
    areas: [...plan.areas, ...parts.flatMap((p) => p.areas)],
    paths: [...plan.paths, ...parts.flatMap((p) => p.paths)],
  } as unknown as T;
  planCache.set(plan, out);
  return out;
}

/** Sảnh sau khi dời các điểm theo `map` và xoay hướng `deg` độ (vd. đặt toà lên mặt bằng). */
export const transformLobby = (l: SiteLobby, map: (p: Point) => Point, deg: number): SiteLobby => ({
  ...l,
  position: map(l.position),
  outward: rotatePoint(l.outward, { x: 0, y: 0 }, deg),
});

/** Sảnh mới trước một cửa: bệ 14 × 7 m, chưa có bậc / dốc ở các cạnh. */
export function newLobby(o: {
  door: Point;
  outward: Point;
  use?: SiteRampUse;
  name?: string;
  dropoff?: boolean;
  walkway?: boolean;
  id?: Id;
}): SiteLobby {
  return {
    id: o.id ?? createId('lobby'),
    name: o.name ?? 'Sảnh',
    ...(o.use ? { use: o.use } : {}),
    position: roundPt(o.door),
    outward: normalize(o.outward),
    width: 14,
    depth: 7,
    edges: o.dropoff
      ? { front: { kind: 'steps' }, left: { kind: 'steps' }, right: { kind: 'steps' } }
      : { front: { kind: 'steps_ramp', rampAt: 'right' } },
    ...(o.dropoff ? { dropoff: { walkway: o.walkway !== false } } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Chuyển dữ liệu kiểu cũ                                              */
/* ------------------------------------------------------------------ */

const SAME = 0.05;
const same = (p: Point, q: Point) => distance(p, q) < SAME;
const samePoints = (a: readonly Point[], b: readonly Point[]) =>
  a.length === b.length && a.every((p, i) => same(p, b[i]!));
const samePolygon = (a: readonly Point[], b: readonly Point[]) =>
  a.length === b.length && a.every((p) => b.some((q) => same(p, q)));

/** Bốn cách đặt một sảnh hình chữ nhật (mỗi cạnh lần lượt là cạnh sát tường). */
function rectFrames(poly: readonly Point[]) {
  if (poly.length !== 4) return [];
  for (let i = 0; i < 4; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % 4]!;
    const c = poly[(i + 2) % 4]!;
    if (Math.abs(dot(normalize(sub(b, a)), normalize(sub(c, b)))) > 0.01) return [];
  }
  const center = polygonCentroid(poly);
  return poly.map((a, i) => {
    const b = poly[(i + 1) % 4]!;
    const mid = scale(add(a, b), 0.5);
    return {
      position: roundPt(mid),
      outward: normalize(sub(center, mid)),
      width: round2(distance(a, b)),
      depth: round2(distance(b, poly[(i + 2) % 4]!)),
    };
  });
}

/** Sảnh (kèm ID các đối tượng cũ được gộp vào) dựng lại từ khu vực sân `a`, null nếu không khớp. */
function lobbyFromPlaza(
  a: SiteArea,
  ext: BuildingExterior,
  footprint: readonly Point[],
  used: ReadonlySet<Id>,
): { lobby: SiteLobby; ids: Id[] } | null {
  const frames = rectFrames(a.polygon);
  const named = a.name ? { name: a.name } : {};
  // Cụm có làn đón: khu đón, làn đón, hai dốc đúng như `lobbyExterior` dựng (chưa sửa tay).
  for (const f of frames) {
    const probe = lobbyExterior({
      door: f.position,
      outward: f.outward,
      width: f.width,
      depth: f.depth,
      id: (k) => k,
    });
    const drop = probe.areas.find((x) => x.kind === 'dropoff')!;
    const dropoff = ext.areas.find(
      (x) => x.kind === 'dropoff' && !used.has(x.id) && samePolygon(x.polygon, drop.polygon),
    );
    const top = probe.paths.find((p) => p.id === 'ramp_up')!.points.at(-1)!;
    const up = ext.paths.find(
      (p) => p.kind === 'ramp' && !used.has(p.id) && same(p.points.at(-1)!, top),
    );
    if (!dropoff || !up) continue;
    const foot = lobbyFrame(f).local(up.points[0]!);
    const lobby: SiteLobby = {
      id: a.id,
      ...named,
      ...(up.use ? { use: up.use } : {}),
      ...f,
      ...(up.rise !== undefined ? { rise: up.rise } : {}),
      dropoff: { walkway: !!up.walkway, reach: round2(foot.d), spread: round2(foot.s) },
    };
    const ids = [a.id, dropoff.id];
    const matched = lobbyParts(lobby).paths.every((g) => {
      const m = ext.paths.find(
        (p) =>
          !used.has(p.id) &&
          !ids.includes(p.id) &&
          p.kind === g.kind &&
          p.width === g.width &&
          (p.walkway ?? null) === (g.walkway ?? null) &&
          (p.flow ?? 'up') === (g.flow ?? 'up') &&
          samePoints(p.points, g.points),
      );
      if (m) ids.push(m.id);
      return !!m;
    });
    if (matched) return { lobby, ids };
  }
  // Sảnh chữ nhật có một cạnh nằm trên tường toà.
  if (footprint.length >= 3) {
    for (const f of frames) {
      const onWall = footprint.some(
        (q, i) =>
          projectPointOnSegment(f.position, q, footprint[(i + 1) % footprint.length]!).distance <
          0.3,
      );
      if (onWall && !pointInPolygon(lobbyFrame(f).at(f.depth / 2, 0), footprint)) {
        return { lobby: { id: a.id, ...named, ...f }, ids: [a.id] };
      }
    }
  }
  return null;
}

/**
 * Gộp sảnh kiểu cũ (sảnh, khu đón, làn đón, dốc là các đối tượng rời — do `lobbyExterior` dựng, chưa
 * sửa tay) và sân hình chữ nhật sát tường toà thành sảnh một đối tượng (`SiteLobby`). Đối tượng
 * không khớp được giữ nguyên. Không có gì để gộp thì trả về chính `ext`.
 * @param footprint đường bao toà (hệ trục toà) — để nhận ra sân sát tường.
 */
export function mergeLobbies(
  ext: BuildingExterior,
  footprint: readonly Point[] = [],
): BuildingExterior {
  const used = new Set<Id>();
  const lobbies: SiteLobby[] = [];
  for (const a of ext.areas) {
    if (a.kind !== 'plaza' || used.has(a.id)) continue;
    const found = lobbyFromPlaza(a, ext, footprint, used);
    if (!found) continue;
    lobbies.push(found.lobby);
    for (const id of found.ids) used.add(id);
  }
  if (!lobbies.length) return ext;
  return {
    areas: ext.areas.filter((a) => !used.has(a.id)),
    paths: ext.paths.filter((p) => !used.has(p.id)),
    lobbies: [...(ext.lobbies ?? []), ...lobbies],
  };
}
