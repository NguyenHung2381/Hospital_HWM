/**
 * Phần ngoài trời gắn với toà (`Building.exterior`): sảnh, làn đón / trả khách, dốc lên sảnh, lối đi
 * bộ, mái sảnh… vẽ ở trang Vẽ toà nhà theo hệ trục của toà.
 *
 * Giống "lô đất" của công trình trong SimCity / Cities: Skylines:
 * - Dời / xoay toà trên mặt bằng tổng thể thì sảnh, dốc đi theo (`placeExterior`, `campusSitePlan`).
 * - Mỗi toà có các ĐẦU NỐI (`exteriorSockets`): chân dốc (nối với đường xe), đầu lối đi bộ / chân lối
 *   đi bộ trên dốc (nối với lối đi bộ, vỉa hè). Ở Khuôn viên chỉ cần vẽ đường tới các đầu nối;
 *   `campusSockets` cho biết đầu nối nào đã nối, `socketConnector` tạo đoạn nối vào đường gần nhất.
 * - Sảnh (`SiteLobby`, xem `lobby.ts`) là một đối tượng; các phần của sảnh (bệ, bậc, dốc, làn đón)
 *   được ghép vào như đối tượng thường ở đây (`withLobbyParts`).
 */
import {
  isRoadPath,
  rampWalkLines,
  rampWalkWidth,
  sidewalkWidth,
  toSite,
  emptySitePlan,
  type BuildingExterior,
  type BuildingPlacement,
  type Campus,
  type CampusView,
  type SiteArea,
  type SiteAreaKind,
  type SitePath,
  type SitePathKind,
  type SitePlan,
  type SiteVehicleAccess,
  isStairLike,
} from './campus';
import {
  add,
  distance,
  normalize,
  pointInPolygon,
  projectPointOnSegment,
  rotatePoint,
  scale,
  sub,
} from './geometry';
import { withLobbyParts } from './lobby';
import type { Id, Point } from './types';

/** Loại khu vực vẽ được trong phần ngoài trời của toà. */
export const EXTERIOR_AREA_KINDS: readonly SiteAreaKind[] = [
  'plaza',
  'dropoff',
  'parking',
  'green',
  'structure',
  'restricted',
];

/** Loại đường vẽ được trong phần ngoài trời của toà (đường chung, hàng rào thuộc về khuôn viên). */
export const EXTERIOR_PATH_KINDS: readonly SitePathKind[] = [
  'ramp',
  'vehicle',
  'pedestrian',
  'covered',
];

/** Toà có vẽ phần ngoài trời. */
export const hasExterior = (e: BuildingExterior | null | undefined): e is BuildingExterior =>
  !!e && (e.areas.length > 0 || e.paths.length > 0 || (e.lobbies?.length ?? 0) > 0);

/**
 * Phần ngoài trời của toà đặt lên mặt bằng tổng thể (toạ độ mặt bằng) — sảnh đã tách thành các phần
 * (bệ, bậc, dốc, làn đón).
 */
export function placeExterior(
  pl: Pick<BuildingPlacement, 'position' | 'rotation'>,
  ext: BuildingExterior,
): BuildingExterior {
  const placed = { ...pl, buildingId: '' };
  const t = (p: Point) => toSite(placed, p);
  const full = withLobbyParts(ext);
  return {
    areas: full.areas.map((a) => ({ ...a, polygon: a.polygon.map(t) })),
    paths: full.paths.map((p) => ({ ...p, points: p.points.map(t) })),
  };
}

/** Phần ngoài trời của toà theo ID (null / undefined = chưa có hoặc chưa tải). */
export type ExteriorOf = (buildingId: Id) => BuildingExterior | null | undefined;

export interface CampusSiteParts {
  /** Phần ngoài trời của cơ sở + phần ngoài trời của mọi toà (đã đặt lên mặt bằng). */
  site: SitePlan;
  /** ID đối tượng thuộc phần ngoài trời của toà → ID toà đó. */
  owner: ReadonlyMap<Id, Id>;
}

/** Một kết quả ghép đã lưu đệm. */
interface PartsEntry {
  site: SitePlan | undefined;
  exts: (BuildingExterior | null | undefined)[];
  parts: CampusSiteParts;
}

/**
 * Lưu đệm theo danh sách toà của cơ sở (vài kết quả gần nhất — cùng một cơ sở có thể được ghép theo
 * vài cách, vd. kể cả / không kể toà đang sửa): khung vẽ dựng lại mỗi lần render nhưng dữ liệu ít
 * đổi, và các lớp vẽ tính lại mặt lát nối theo tham chiếu của phần ngoài trời.
 */
const partsCache = new WeakMap<object, PartsEntry[]>();
const PARTS_CACHE_SIZE = 4;

/**
 * Ghép phần ngoài trời của cơ sở với sảnh / dốc… của từng toà. Phần của toà nằm sau phần của cơ sở
 * (vẽ đè lên, bắt dính / chọn trước). Kết quả được lưu đệm: cùng dữ liệu thì trả về cùng object.
 */
export function campusSiteParts(
  campus: Pick<Campus, 'buildings' | 'site'>,
  exteriorOf: ExteriorOf,
): CampusSiteParts {
  const exts = campus.buildings.map((pl) => exteriorOf(pl.buildingId));
  const entries = partsCache.get(campus.buildings) ?? [];
  const hit = entries.find(
    (c) =>
      c.site === campus.site &&
      c.exts.length === exts.length &&
      c.exts.every((e, i) => e === exts[i]),
  );
  if (hit) return hit.parts;
  const base = withLobbyParts(campus.site ?? emptySitePlan());
  const owner = new Map<Id, Id>();
  const areas: SiteArea[] = [...base.areas];
  const paths: SitePath[] = [...base.paths];
  campus.buildings.forEach((pl, i) => {
    const ext = exts[i];
    if (!hasExterior(ext)) return;
    const placed = placeExterior(pl, ext);
    for (const a of placed.areas) {
      owner.set(a.id, pl.buildingId);
      areas.push(a);
    }
    for (const p of placed.paths) {
      owner.set(p.id, pl.buildingId);
      paths.push(p);
    }
  });
  const parts = { site: owner.size ? { ...base, areas, paths } : base, owner };
  partsCache.set(
    campus.buildings,
    [{ site: campus.site, exts, parts }, ...entries].slice(0, PARTS_CACHE_SIZE),
  );
  return parts;
}

/**
 * Phần ngoài trời đầy đủ của cơ sở (kể cả sảnh, dốc… của các toà) — dùng để vẽ 2D / 3D và chỉ
 * đường. undefined nếu cơ sở chưa có phần ngoài trời và không toà nào có sảnh / dốc.
 */
export function campusSitePlan(
  campus: Pick<Campus, 'buildings' | 'site'>,
  exteriorOf: ExteriorOf,
): SitePlan | undefined {
  const { site, owner } = campusSiteParts(campus, exteriorOf);
  return campus.site || owner.size ? site : undefined;
}

/** Phần ngoài trời đầy đủ từ dữ liệu `GET /campuses/:id` (sảnh, dốc của toà lấy theo `buildingInfo`). */
export const campusViewSite = (
  view: Pick<CampusView, 'buildings' | 'site' | 'buildingInfo'>,
): SitePlan | undefined =>
  campusSitePlan(view, (id) => view.buildingInfo.find((i) => i.id === id)?.exterior);

/* ------------------------------------------------------------------ */
/* Đầu nối                                                             */
/* ------------------------------------------------------------------ */

/** `road`: chân dốc / đầu đường xe — nối với đường xe. `walk`: đầu lối đi bộ — nối với lối đi bộ. */
export type SocketKind = 'road' | 'walk';

/** Một đầu nối của phần ngoài trời của toà. */
export interface ExteriorSocket {
  /** `<id đường>:start` / `<id đường>:end` (lối đi bộ trên dốc: `<id dốc>:walk<i>`). */
  id: string;
  pathId: Id;
  kind: SocketKind;
  position: Point;
  /** Hướng đi ra khỏi toà tại đầu nối (vector đơn vị). */
  dir: Point;
  /** Bề rộng đường / lối đi tại đầu nối (m). */
  width: number;
  vehicles?: SiteVehicleAccess;
}

/** Hai đầu mút trùng nhau (m). */
const END_JOIN = 0.05;

/**
 * Các đầu nối của phần ngoài trời một toà (theo hệ trục của toà): đầu đường / lối đi không nối với
 * đường nào khác của toà và không nằm trong sảnh, khu vực của toà hay trong toà. Dốc chỉ tính chân
 * dốc (đỉnh dốc thuộc về sảnh); lối đi bộ trên dốc có đầu nối riêng ở chân lối.
 * @param footprint đường bao toà (hệ trục của toà) — đầu đường nằm trong toà không phải đầu nối.
 */
export function exteriorSockets(
  exterior: BuildingExterior,
  footprint: readonly Point[] = [],
): ExteriorSocket[] {
  const ext = withLobbyParts(exterior);
  const lines = ext.paths.filter((p) => p.kind !== 'fence' && p.points.length >= 2);
  const endsOf = (p: SitePath) => [p.points[0]!, p.points[p.points.length - 1]!];
  const covered = (q: Point) =>
    ext.areas.some((a) => a.polygon.length >= 3 && pointInPolygon(q, a.polygon)) ||
    (footprint.length >= 3 && pointInPolygon(q, footprint));
  const out: ExteriorSocket[] = [];
  for (const p of lines) {
    const n = p.points.length;
    for (const end of ['start', 'end'] as const) {
      if (p.kind === 'ramp' && end === 'end') continue;
      const q = end === 'start' ? p.points[0]! : p.points[n - 1]!;
      const prev = end === 'start' ? p.points[1]! : p.points[n - 2]!;
      const shared = lines.some((o) => o !== p && endsOf(o).some((e) => distance(e, q) < END_JOIN));
      if (shared || covered(q)) continue;
      out.push({
        id: `${p.id}:${end}`,
        pathId: p.id,
        kind: isRoadPath(p) ? 'road' : 'walk',
        position: q,
        dir: normalize(sub(q, prev)),
        // Chân bậc thang / mặt dốc rộng cả cạnh sảnh: lối nối vào chỉ cần rộng như lối đi bộ.
        width: isStairLike(p) ? Math.min(p.width, 3) : p.width,
        ...(p.vehicles ? { vehicles: p.vehicles } : {}),
      });
    }
    if (p.kind === 'ramp') {
      rampWalkLines(p, ext.paths).forEach((line, i) => {
        const q = line[0]!;
        if (line.length < 2 || covered(q)) return;
        out.push({
          id: `${p.id}:walk${i}`,
          pathId: p.id,
          kind: 'walk',
          position: q,
          dir: normalize(sub(q, line[1]!)),
          width: rampWalkWidth(p),
        });
      });
    }
  }
  return out;
}

const distToLine = (p: Point, line: readonly Point[]) => {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    best = Math.min(best, projectPointOnSegment(p, line[i]!, line[i + 1]!).distance);
  }
  return best;
};

/** Dung sai khi xét đầu nối đã chạm đường (m). */
const LINK_TOL = 0.6;

/** Khu vực mà đường xe đi vào được (đầu nối chân dốc nằm trong đó là đã nối). */
const ROAD_AREAS = new Set<SiteAreaKind>(['road', 'parking', 'dropoff']);

/**
 * Đầu nối đã chạm vào đường / lối đi nào của mặt bằng chưa.
 * @param ignore bỏ qua các đối tượng này (vd. phần ngoài trời của chính toà có đầu nối).
 */
export function socketLinked(
  s: Pick<ExteriorSocket, 'kind' | 'position'>,
  plan: Pick<SitePlan, 'areas' | 'paths'>,
  ignore: (id: Id) => boolean = () => false,
): boolean {
  const p = s.position;
  for (const path of plan.paths) {
    if (ignore(path.id) || path.points.length < 2 || path.kind === 'fence') continue;
    if (s.kind === 'road') {
      if (!isRoadPath(path)) continue;
      const half = (path.width - 2 * sidewalkWidth(path)) / 2;
      if (distToLine(p, path.points) <= half + LINK_TOL) return true;
    } else {
      if (path.kind === 'vehicle') continue;
      if (path.kind === 'ramp') {
        const w = rampWalkWidth(path);
        if (w && rampWalkLines(path, plan.paths).some((l) => distToLine(p, l) <= w / 2 + LINK_TOL))
          return true;
        continue;
      }
      if (distToLine(p, path.points) <= path.width / 2 + LINK_TOL) return true;
    }
  }
  return plan.areas.some(
    (a) =>
      !ignore(a.id) &&
      a.polygon.length >= 3 &&
      (s.kind === 'road' ? ROAD_AREAS.has(a.kind) : a.kind === 'plaza') &&
      pointInPolygon(p, a.polygon),
  );
}

/** Đầu nối của một toà trên mặt bằng tổng thể. */
export interface CampusSocket extends ExteriorSocket {
  buildingId: Id;
  /** Đã chạm đường / lối đi của khuôn viên (hoặc của toà khác). */
  linked: boolean;
}

/**
 * Đầu nối của mọi toà trên mặt bằng tổng thể, kèm trạng thái đã nối / chưa.
 * @param footprintOf đường bao toà (hệ trục của toà).
 */
export function campusSockets(
  campus: Pick<Campus, 'buildings' | 'site'>,
  exteriorOf: ExteriorOf,
  footprintOf: (buildingId: Id) => readonly Point[] | undefined = () => undefined,
): CampusSocket[] {
  const { site, owner } = campusSiteParts(campus, exteriorOf);
  return campus.buildings.flatMap((pl) => {
    const ext = exteriorOf(pl.buildingId);
    if (!hasExterior(ext)) return [];
    const placed = { ...pl };
    const mine = (id: Id) => owner.get(id) === pl.buildingId;
    return exteriorSockets(ext, footprintOf(pl.buildingId)).map((s) => {
      const position = toSite(placed, s.position);
      return {
        ...s,
        buildingId: pl.buildingId,
        position,
        dir: rotatePoint(s.dir, { x: 0, y: 0 }, pl.rotation),
        linked: socketLinked({ kind: s.kind, position }, site, mine),
      };
    });
  });
}

/**
 * Đoạn đường / lối đi bộ nối đầu nối `s` vào đường (đường xe, đường chung) hoặc lối đi bộ, vỉa hè,
 * sân gần nhất — đi ra theo hướng đầu nối rồi bẻ vào điểm gần nhất (chỗ nối trơn, không gãy ngay
 * ở chân dốc). null nếu không có gì trong `maxDist` m hoặc đầu nối đã chạm đường.
 */
export function socketConnector(
  s: Pick<ExteriorSocket, 'kind' | 'position' | 'dir' | 'width' | 'vehicles'>,
  plan: Pick<SitePlan, 'areas' | 'paths'>,
  ignore: (id: Id) => boolean = () => false,
  maxDist = 80,
): Omit<SitePath, 'id'> | null {
  if (socketLinked(s, plan, ignore)) return null;
  let best: { q: Point; d: number } | null = null;
  const consider = (line: readonly Point[], closed = false) => {
    const pts = closed ? [...line, line[0]!] : line;
    for (let i = 0; i + 1 < pts.length; i++) {
      const proj = projectPointOnSegment(s.position, pts[i]!, pts[i + 1]!);
      if (proj.distance <= maxDist && (!best || proj.distance < best.d)) {
        best = { q: proj.point, d: proj.distance };
      }
    }
  };
  for (const path of plan.paths) {
    if (ignore(path.id) || path.points.length < 2) continue;
    if (s.kind === 'road') {
      if (path.kind === 'vehicle' || path.kind === 'shared') consider(path.points);
    } else if (path.kind === 'pedestrian' || path.kind === 'covered' || path.kind === 'shared') {
      consider(path.points);
    } else if (path.kind === 'ramp') {
      for (const l of rampWalkLines(path, plan.paths)) consider(l);
    }
  }
  if (s.kind === 'walk') {
    for (const a of plan.areas) {
      if (!ignore(a.id) && a.kind === 'plaza' && a.polygon.length >= 3) consider(a.polygon, true);
    }
  }
  const found = best as { q: Point; d: number } | null;
  if (!found || found.d < 0.3) return null;
  const lead = Math.min(4, found.d * 0.35);
  const bend = add(s.position, scale(s.dir, lead));
  // Đi ra theo hướng đầu nối chỉ khi điểm bẻ không vượt quá đích (đích ở ngay phía trước / bên cạnh).
  const points =
    lead >= 0.5 && distance(bend, found.q) < found.d
      ? [s.position, bend, found.q]
      : [s.position, found.q];
  const round = (p: Point) => ({
    x: Math.round(p.x * 100) / 100,
    y: Math.round(p.y * 100) / 100,
  });
  return s.kind === 'road'
    ? {
        kind: 'vehicle',
        name: 'Đường nối vào dốc',
        width: s.width,
        ...(s.vehicles ? { vehicles: s.vehicles } : {}),
        points: points.map(round),
      }
    : {
        kind: 'pedestrian',
        name: 'Lối nối vào sảnh',
        width: Math.max(1.5, s.width),
        points: points.map(round),
      };
}
