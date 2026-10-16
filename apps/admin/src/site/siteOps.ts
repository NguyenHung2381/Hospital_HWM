/**
 * Thao tác thuần trên phần ngoài trời của cơ sở (toạ độ mặt bằng tổng thể, mét).
 * Mọi hàm trả về bản cơ sở MỚI (không sửa trực tiếp) để dùng với lịch sử hoàn tác của editor.
 */
import {
  add,
  boundsOf,
  createId,
  distance,
  emptySitePlan,
  isRoadPath,
  isStairLike,
  isWalkable,
  lobbyFrame,
  lobbyFullDepth,
  lobbyParts,
  lobbyPolygon,
  LOBBY_MIN_SIZE,
  normalizeDegrees,
  pointInPolygon,
  projectPointOnSegment,
  rotatePoint,
  scale,
  sidewalkWidth,
  sub,
  toSite,
  type BBox,
  type BuildingLink,
  type Campus,
  type Id,
  type LinkEnd,
  type Point,
  type SiteArea,
  type SiteAreaKind,
  type SiteGateKind,
  type SiteLobby,
  type SitePath,
  type SitePathKind,
  type SitePlan,
  type SitePoiKind,
} from '@hwn/map-core';

export type SiteItemType = 'area' | 'path' | 'gate' | 'poi' | 'link' | 'lobby';
export interface SiteRef {
  type: SiteItemType | 'building';
  id: Id;
}

export const SITE_TYPE_LABEL: Record<SiteRef['type'], string> = {
  building: 'Toà nhà',
  area: 'Khu vực',
  path: 'Đường / lối đi',
  gate: 'Cổng',
  poi: 'Điểm ngoài trời',
  link: 'Cầu nối',
  lobby: 'Sảnh',
};

export const DEFAULT_PATH_WIDTH: Record<SitePathKind, number> = {
  vehicle: 6,
  ramp: 3.5,
  shared: 10,
  fence: 0.3,
  pedestrian: 2,
  covered: 3,
  steps: 4,
  slope: 1.5,
};

const siteOf = (c: Campus): SitePlan => c.site ?? emptySitePlan();

/** Danh sách chứa đối tượng loại `type` trong phần ngoài trời. */
const LIST_KEY = {
  area: 'areas',
  path: 'paths',
  gate: 'gates',
  poi: 'pois',
  lobby: 'lobbies',
} as const;
type ListType = keyof typeof LIST_KEY;
const withSite = (c: Campus, fn: (s: SitePlan) => SitePlan): Campus => ({
  ...c,
  site: fn(siteOf(c)),
});

/* ------------------------------------------------------------------ */
/* Thêm                                                                */
/* ------------------------------------------------------------------ */

export function addArea(
  c: Campus,
  kind: SiteAreaKind,
  polygon: Point[],
  id = createId('area'),
): [Campus, Id] {
  return [withSite(c, (s) => ({ ...s, areas: [...s.areas, { id, kind, polygon }] })), id];
}

export function addPath(
  c: Campus,
  kind: SitePathKind,
  points: Point[],
  id = createId('path'),
): [Campus, Id] {
  const path: SitePath = { id, kind, points, width: DEFAULT_PATH_WIDTH[kind] };
  return [withSite(c, (s) => ({ ...s, paths: [...s.paths, path] })), id];
}

/** Chèn một đường đã dựng sẵn (vd. đoạn nối vào chân dốc của toà). */
export function insertPath(c: Campus, path: SitePath): Campus {
  return withSite(c, (s) => ({ ...s, paths: [...s.paths, path] }));
}

/** Thêm một sảnh (một đối tượng gồm bệ, bậc / dốc các cạnh, làn đón). */
export function addLobby(c: Campus, lobby: SiteLobby): Campus {
  return withSite(c, (s) => ({ ...s, lobbies: [...(s.lobbies ?? []), lobby] }));
}

/** Chèn phần ngoài trời dựng sẵn — khu vực và đường. */
export function insertParts(c: Campus, parts: { areas: SiteArea[]; paths: SitePath[] }): Campus {
  return withSite(c, (s) => ({
    ...s,
    areas: [...s.areas, ...parts.areas],
    paths: [...s.paths, ...parts.paths],
  }));
}

export function addGate(
  c: Campus,
  kind: SiteGateKind,
  position: Point,
  id = createId('gate'),
): [Campus, Id] {
  const n = siteOf(c).gates.length + 1;
  return [
    withSite(c, (s) => ({
      ...s,
      gates: [...s.gates, { id, kind, position, name: n === 1 ? 'Cổng chính' : `Cổng ${n}` }],
    })),
    id,
  ];
}

export function addPoi(
  c: Campus,
  kind: SitePoiKind,
  position: Point,
  name: string,
  id = createId('poi'),
): [Campus, Id] {
  return [
    withSite(c, (s) => ({ ...s, pois: [...s.pois, { id, kind, position, name, tags: [] }] })),
    id,
  ];
}

export function addLink(c: Campus, a: LinkEnd, b: LinkEnd, id = createId('link')): [Campus, Id] {
  const n = (c.links?.length ?? 0) + 1;
  const link: BuildingLink = {
    id,
    name: `Cầu nối ${n}`,
    kind: 'bridge',
    a,
    b,
    accessible: true,
    covered: true,
  };
  return [{ ...c, links: [...(c.links ?? []), link] }, id];
}

/* ------------------------------------------------------------------ */
/* Sửa / xoá                                                           */
/* ------------------------------------------------------------------ */

type Patchable = {
  area: SiteArea;
  path: SitePath;
  gate: SitePlan['gates'][number];
  poi: SitePlan['pois'][number];
  link: BuildingLink;
  lobby: SiteLobby;
};

/** Sửa thuộc tính một đối tượng ngoài trời / cầu nối. */
export function patchItem<T extends SiteItemType>(
  c: Campus,
  type: T,
  id: Id,
  patch: Partial<Patchable[T]>,
): Campus {
  if (type === 'link') {
    return { ...c, links: (c.links ?? []).map((l) => (l.id === id ? { ...l, ...patch } : l)) };
  }
  const key = LIST_KEY[type as ListType];
  return withSite(c, (s) => ({
    ...s,
    [key]: ((s[key] ?? []) as { id: Id }[]).map((x) => (x.id === id ? { ...x, ...patch } : x)),
  }));
}

/** Xoá toàn bộ phần ngoài trời (đường, khu vực, cổng, điểm) và các cầu nối — giữ vị trí các toà. */
export function clearSite(c: Campus): Campus {
  return { ...c, site: emptySitePlan(), links: [] };
}

/** Cầu nối sẵn có giữa đúng hai cửa này (theo bất kỳ chiều nào). */
export function findLink(c: Campus, a: LinkEnd, b: LinkEnd): BuildingLink | undefined {
  const same = (x: LinkEnd, y: LinkEnd) =>
    x.buildingId === y.buildingId && x.openingId === y.openingId;
  return (c.links ?? []).find(
    (l) => (same(l.a, a) && same(l.b, b)) || (same(l.a, b) && same(l.b, a)),
  );
}

export function deleteItem(c: Campus, ref: SiteRef): Campus {
  if (ref.type === 'building') return c;
  if (ref.type === 'link') return { ...c, links: (c.links ?? []).filter((l) => l.id !== ref.id) };
  const key = LIST_KEY[ref.type];
  return withSite(c, (s) => ({
    ...s,
    [key]: ((s[key] ?? []) as { id: Id }[]).filter((x) => x.id !== ref.id),
  }));
}

/** Bản gốc của đối tượng — để kéo đi luôn tính từ vị trí ban đầu (không trôi số). */
export type MoveOrigin =
  | { type: 'area'; id: Id; points: Point[] }
  | { type: 'path'; id: Id; points: Point[] }
  | { type: 'gate' | 'poi' | 'lobby'; id: Id; point: Point };

export function moveOrigin(c: Campus, ref: SiteRef): MoveOrigin | null {
  const s = siteOf(c);
  switch (ref.type) {
    case 'area': {
      const a = s.areas.find((x) => x.id === ref.id);
      return a ? { type: 'area', id: a.id, points: a.polygon } : null;
    }
    case 'path': {
      const p = s.paths.find((x) => x.id === ref.id);
      return p ? { type: 'path', id: p.id, points: p.points } : null;
    }
    case 'gate':
    case 'poi': {
      const list = ref.type === 'gate' ? s.gates : s.pois;
      const x = list.find((i) => i.id === ref.id);
      return x ? { type: ref.type, id: x.id, point: x.position } : null;
    }
    case 'lobby': {
      const l = s.lobbies?.find((x) => x.id === ref.id);
      return l ? { type: 'lobby', id: l.id, point: l.position } : null;
    }
    default:
      return null;
  }
}

export function applyMove(c: Campus, origin: MoveOrigin, delta: Point): Campus {
  if (origin.type === 'area') {
    return patchItem(c, 'area', origin.id, { polygon: origin.points.map((p) => add(p, delta)) });
  }
  if (origin.type === 'path') {
    return patchItem(c, 'path', origin.id, { points: origin.points.map((p) => add(p, delta)) });
  }
  return patchItem(c, origin.type, origin.id, { position: add(origin.point, delta) });
}

/** Dời một đỉnh của khu vực / đường. */
export function setVertex(
  c: Campus,
  type: 'area' | 'path',
  id: Id,
  index: number,
  to: Point,
): Campus {
  const s = siteOf(c);
  if (type === 'area') {
    const a = s.areas.find((x) => x.id === id);
    if (!a) return c;
    return patchItem(c, 'area', id, {
      polygon: a.polygon.map((p, i) => (i === index ? to : p)),
    });
  }
  const p = s.paths.find((x) => x.id === id);
  if (!p) return c;
  return patchItem(c, 'path', id, { points: p.points.map((q, i) => (i === index ? to : q)) });
}

/** Xoá một đỉnh (giữ tối thiểu 3 đỉnh cho khu vực, 2 điểm cho đường). */
export function removeVertex(c: Campus, type: 'area' | 'path', id: Id, index: number): Campus {
  const s = siteOf(c);
  if (type === 'area') {
    const a = s.areas.find((x) => x.id === id);
    if (!a || a.polygon.length <= 3) return c;
    return patchItem(c, 'area', id, { polygon: a.polygon.filter((_, i) => i !== index) });
  }
  const p = s.paths.find((x) => x.id === id);
  if (!p || p.points.length <= 2) return c;
  return patchItem(c, 'path', id, { points: p.points.filter((_, i) => i !== index) });
}

/* ------------------------------------------------------------------ */
/* Chọn / bắt dính                                                     */
/* ------------------------------------------------------------------ */

const distToPolyline = (p: Point, pts: readonly Point[]) => {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    best = Math.min(best, projectPointOnSegment(p, pts[i]!, pts[i + 1]!).distance);
  }
  return best;
};

/** Điểm `p` nằm trên đường `x` (nới `tol` m): bậc thang / mặt dốc đầu cắt vuông, đường khác đầu tròn. */
function onPath(x: SitePath, p: Point, tol: number): boolean {
  if (!isStairLike(x)) return distToPolyline(p, x.points) <= x.width / 2 + tol;
  for (let i = 0; i + 1 < x.points.length; i++) {
    const a = x.points[i]!;
    const b = x.points[i + 1]!;
    const len = distance(a, b);
    if (len < 1e-9) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const along = (p.x - a.x) * ux + (p.y - a.y) * uy;
    const across = Math.abs(-(p.x - a.x) * uy + (p.y - a.y) * ux);
    if (along >= -tol && along <= len + tol && across <= x.width / 2 + tol) return true;
  }
  return false;
}

/**
 * Đối tượng ngoài trời dưới con trỏ, ưu tiên: điểm > cổng > cầu nối > đường > khu vực.
 * @param tol dung sai (m), thường quy đổi từ vài pixel.
 * @param links vị trí hai đầu các cầu nối trên tầng đang xem.
 */
export function hitSite(
  c: Campus,
  p: Point,
  tol: number,
  links: readonly { id: Id; from: Point; to: Point }[] = [],
): SiteRef | null {
  const s = siteOf(c);
  const near = (q: Point, r: number) => distance(p, q) <= r;
  const poi = [...s.pois].reverse().find((x) => near(x.position, tol * 1.6));
  if (poi) return { type: 'poi', id: poi.id };
  const gate = [...s.gates].reverse().find((x) => near(x.position, tol * 1.6));
  if (gate) return { type: 'gate', id: gate.id };
  const link = links.find((l) => distToPolyline(p, [l.from, l.to]) <= tol);
  if (link) return { type: 'link', id: link.id };
  const path = [...s.paths].reverse().find((x) => onPath(x, p, tol));
  if (path) return { type: 'path', id: path.id };
  const lobby = [...(s.lobbies ?? [])].reverse().find((l) => hitLobby(l, p, tol));
  if (lobby) return { type: 'lobby', id: lobby.id };
  const area = [...s.areas].reverse().find((x) => pointInPolygon(p, x.polygon));
  if (area) return { type: 'area', id: area.id };
  return null;
}

/** Điểm `p` nằm trên một phần của sảnh (bệ, khu đón, làn, dốc, bậc). */
export function hitLobby(l: SiteLobby, p: Point, tol: number): boolean {
  const parts = lobbyParts(l);
  return (
    parts.areas.some((a) => pointInPolygon(p, a.polygon)) ||
    parts.paths.some((x) => onPath(x, p, tol))
  );
}

/** Đỉnh của khu vực / đường đang chọn nằm dưới con trỏ. */
export function hitVertex(c: Campus, ref: SiteRef | null, p: Point, tol: number): number | null {
  if (!ref || (ref.type !== 'area' && ref.type !== 'path')) return null;
  const s = siteOf(c);
  const pts =
    ref.type === 'area'
      ? s.areas.find((x) => x.id === ref.id)?.polygon
      : s.paths.find((x) => x.id === ref.id)?.points;
  const i = pts?.findIndex((q) => distance(p, q) <= tol) ?? -1;
  return i >= 0 ? i : null;
}

/** Điểm bắt dính gần nhất: đỉnh các đường / khu vực và các điểm thêm (vd. cửa chính các toà). */
export function snapToSiteVertex(
  c: Campus,
  p: Point,
  radius: number,
  extra: readonly Point[] = [],
  /** Bỏ qua điểm này (vd. đỉnh đang được kéo). */
  exclude?: Point,
): Point | null {
  const s = siteOf(c);
  let best: { q: Point; d: number } | null = null;
  const candidates = [
    ...s.paths.flatMap((x) => x.points),
    ...s.areas.flatMap((x) => x.polygon),
    ...extra,
  ];
  for (const q of candidates) {
    if (q === exclude) continue;
    const d = distance(p, q);
    if (d <= radius && (!best || d < best.d)) best = { q, d };
  }
  return best?.q ?? null;
}

/**
 * Điểm gần nhất trên tim một đường / lối đi (không phải hàng rào) trong bán kính `radius` — để đường
 * mới vẽ dừng đúng trên tim đường khác, tạo ngã ba / ngã tư liền mạch.
 * @param skipId bỏ qua đường này (vd. đường đang được sửa đỉnh).
 */
export function snapToSitePath(
  c: Pick<Campus, 'site'>,
  p: Point,
  radius: number,
  skipId?: Id,
): Point | null {
  let best: { q: Point; d: number } | null = null;
  for (const x of c.site?.paths ?? []) {
    if (x.id === skipId || x.kind === 'fence') continue;
    for (let i = 0; i + 1 < x.points.length; i++) {
      const proj = projectPointOnSegment(p, x.points[i]!, x.points[i + 1]!);
      if (proj.distance <= radius && (!best || proj.distance < best.d)) {
        best = { q: proj.point, d: proj.distance };
      }
    }
  }
  return best?.q ?? null;
}

/**
 * Lực hút khi kéo toà (giống SimCity / Cities: Skylines): chân dốc (đầu nối đường xe) của toà nằm gần
 * một đường xe trong bán kính `radius` thì trả về độ dời thêm để chân dốc rơi đúng vào làn xe gần
 * nhất (đường hai chiều: tim làn bên phía chân dốc; đường một chiều: tim đường). null = không hút.
 * @param sockets vị trí các chân dốc của toà SAU khi dời (toạ độ mặt bằng).
 */
export function magnetToRoad(
  sockets: readonly Point[],
  roads: readonly SitePath[],
  radius: number,
): Point | null {
  let best: { d: Point; len: number } | null = null;
  for (const s of sockets) {
    for (const r of roads) {
      if (!isRoadPath(r) || r.kind === 'ramp' || r.points.length < 2) continue;
      const carriage = r.width - 2 * sidewalkWidth(r);
      for (let i = 0; i + 1 < r.points.length; i++) {
        const a = r.points[i]!;
        const b = r.points[i + 1]!;
        const proj = projectPointOnSegment(s, a, b);
        if (proj.distance > radius + carriage / 2) continue;
        let target = proj.point;
        if (!r.oneWay && carriage >= 5) {
          // Làn bên phía chân dốc.
          const len = distance(a, b) || 1;
          const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
          const side = Math.sign((s.x - a.x) * n.x + (s.y - a.y) * n.y) || 1;
          target = add(target, { x: n.x * side * (carriage / 4), y: n.y * side * (carriage / 4) });
        }
        const d = sub(target, s);
        const len = Math.hypot(d.x, d.y);
        if (len <= radius && (!best || len < best.len)) best = { d, len };
      }
    }
  }
  return best && best.len > 1e-6 ? best.d : null;
}

/**
 * Cửa chính nằm xa mọi lối đi bộ (> `maxDist` m) — chỉ đường sẽ phải "đi tắt" qua chỗ không có lối.
 */
export function unlinkedEntrances(
  c: Campus,
  entrances: readonly { buildingId: Id; openingId: Id; site: Point }[],
  maxDist = 12,
): { buildingId: Id; openingId: Id }[] {
  const walk = siteOf(c).paths.filter(isWalkable);
  if (!walk.length)
    return entrances.map(({ buildingId, openingId }) => ({ buildingId, openingId }));
  return entrances
    .filter((e) => Math.min(...walk.map((w) => distToPolyline(e.site, w.points))) > maxDist)
    .map(({ buildingId, openingId }) => ({ buildingId, openingId }));
}

/* ------------------------------------------------------------------ */
/* Nhóm đối tượng: dời / xoay nhiều thứ cùng lúc (kể cả toà)           */
/* ------------------------------------------------------------------ */

/** Đường bao (theo hệ trục toà) của các toà — để tính tâm / chọn theo khung. */
export type FootprintOf = (buildingId: Id) => readonly Point[] | undefined;

export const sameSiteRef = (a: SiteRef, b: SiteRef) => a.type === b.type && a.id === b.id;

/** Bật / tắt `ref` trong vùng chọn. */
export function toggleRef(selection: readonly SiteRef[], ref: SiteRef): SiteRef[] {
  return selection.some((r) => sameSiteRef(r, ref))
    ? selection.filter((r) => !sameSiteRef(r, ref))
    : [...selection, ref];
}

/** Các điểm (toạ độ mặt bằng) của một đối tượng — toà: đường bao đã đặt. */
export function refPoints(c: Campus, ref: SiteRef, footprintOf: FootprintOf): Point[] {
  const s = siteOf(c);
  switch (ref.type) {
    case 'area':
      return s.areas.find((x) => x.id === ref.id)?.polygon ?? [];
    case 'path':
      return s.paths.find((x) => x.id === ref.id)?.points ?? [];
    case 'gate':
      return [s.gates.find((x) => x.id === ref.id)?.position].filter((p) => !!p) as Point[];
    case 'poi':
      return [s.pois.find((x) => x.id === ref.id)?.position].filter((p) => !!p) as Point[];
    case 'lobby': {
      const l = s.lobbies?.find((x) => x.id === ref.id);
      return l ? lobbyPolygon(l) : [];
    }
    case 'building': {
      const pl = c.buildings.find((x) => x.buildingId === ref.id);
      const fp = footprintOf(ref.id) ?? [];
      if (!pl) return [];
      return fp.length ? fp.map((p) => toSite(pl, p)) : [pl.position];
    }
    default:
      return [];
  }
}

/** Tâm hộp bao của vùng chọn (tâm xoay nhóm). */
export function selectionCenter(
  c: Campus,
  refs: readonly SiteRef[],
  footprintOf: FootprintOf,
): Point | null {
  const b = boundsOf(refs.flatMap((r) => refPoints(c, r, footprintOf)));
  return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : null;
}

/** Bản gốc của cả vùng chọn — kéo nhóm luôn tính từ vị trí ban đầu. */
export interface GroupOrigin {
  items: MoveOrigin[];
  buildings: { id: Id; position: Point }[];
}

export function groupOrigin(c: Campus, refs: readonly SiteRef[]): GroupOrigin {
  return {
    items: refs.flatMap((r) => {
      const o = moveOrigin(c, r);
      return o ? [o] : [];
    }),
    buildings: refs.flatMap((r) => {
      const pl = r.type === 'building' && c.buildings.find((x) => x.buildingId === r.id);
      return pl ? [{ id: pl.buildingId, position: pl.position }] : [];
    }),
  };
}

/** Dời cả nhóm đi `delta` (tính từ vị trí gốc). */
export function applyGroupMove(c: Campus, origin: GroupOrigin, delta: Point): Campus {
  let next = origin.items.reduce((acc, o) => applyMove(acc, o, delta), c);
  if (origin.buildings.length) {
    const pos = new Map(origin.buildings.map((b) => [b.id, b.position]));
    next = {
      ...next,
      buildings: next.buildings.map((pl) => {
        const p = pos.get(pl.buildingId);
        return p ? { ...pl, position: add(p, delta) } : pl;
      }),
    };
  }
  return next;
}

/**
 * Xoay các đối tượng quanh `pivot` một góc `deg` (độ, chiều kim đồng hồ). Khu vực / đường xoay các
 * đỉnh, cổng / điểm xoay vị trí, toà đổi cả vị trí lẫn góc xoay. Cầu nối đi theo cửa nên bỏ qua.
 */
export function rotateItems(
  c: Campus,
  refs: readonly SiteRef[],
  pivot: Point,
  deg: number,
): Campus {
  const rot = (p: Point) => rotatePoint(p, pivot, deg);
  const ids = (type: SiteRef['type']) =>
    new Set(refs.filter((r) => r.type === type).map((r) => r.id));
  const areas = ids('area');
  const paths = ids('path');
  const gates = ids('gate');
  const pois = ids('poi');
  const lobbies = ids('lobby');
  const buildings = ids('building');
  const s = siteOf(c);
  return {
    ...c,
    site: c.site && {
      ...s,
      areas: s.areas.map((a) => (areas.has(a.id) ? { ...a, polygon: a.polygon.map(rot) } : a)),
      paths: s.paths.map((x) => (paths.has(x.id) ? { ...x, points: x.points.map(rot) } : x)),
      gates: s.gates.map((g) => (gates.has(g.id) ? { ...g, position: rot(g.position) } : g)),
      pois: s.pois.map((x) => (pois.has(x.id) ? { ...x, position: rot(x.position) } : x)),
      ...(s.lobbies && {
        lobbies: s.lobbies.map((l) =>
          lobbies.has(l.id)
            ? {
                ...l,
                position: rot(l.position),
                outward: rotatePoint(l.outward, { x: 0, y: 0 }, deg),
              }
            : l,
        ),
      }),
    },
    buildings: c.buildings.map((pl) =>
      buildings.has(pl.buildingId)
        ? {
            ...pl,
            position: rot(pl.position),
            rotation: normalizeDegrees(pl.rotation + deg),
          }
        : pl,
    ),
  };
}

/** Xoá các đối tượng ngoài trời / cầu nối trong vùng chọn (toà không bị xoá). */
export function deleteItems(c: Campus, refs: readonly SiteRef[]): Campus {
  return refs.reduce((acc, r) => deleteItem(acc, r), c);
}

/**
 * Đối tượng trong khung chọn `box` (toạ độ mặt bằng).
 * - `contain`: nằm gọn trong khung (kéo từ trái sang phải).
 * - `cross`: chỉ cần chạm (kéo từ phải sang trái) — có đỉnh trong khung hoặc khung nằm trong khu vực.
 */
export function siteItemsInBox(
  c: Campus,
  box: BBox,
  mode: 'contain' | 'cross',
  footprintOf: FootprintOf,
  links: readonly { id: Id; from: Point; to: Point }[] = [],
): SiteRef[] {
  const inBox = (p: Point) =>
    p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
  const hits = (pts: readonly Point[], polygon = false) => {
    if (!pts.length) return false;
    if (mode === 'contain') return pts.every(inBox);
    if (pts.some(inBox)) return true;
    const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    return polygon && pts.length >= 3 && pointInPolygon(center, pts);
  };
  const s = siteOf(c);
  return [
    ...c.buildings
      .filter((pl) =>
        hits(refPoints(c, { type: 'building', id: pl.buildingId }, footprintOf), true),
      )
      .map((pl) => ({ type: 'building' as const, id: pl.buildingId })),
    ...s.areas
      .filter((a) => hits(a.polygon, true))
      .map((a) => ({ type: 'area' as const, id: a.id })),
    ...s.paths.filter((x) => hits(x.points)).map((x) => ({ type: 'path' as const, id: x.id })),
    ...(s.lobbies ?? [])
      .filter((l) => hits(lobbyPolygon(l), true))
      .map((l) => ({ type: 'lobby' as const, id: l.id })),
    ...s.gates.filter((g) => hits([g.position])).map((g) => ({ type: 'gate' as const, id: g.id })),
    ...s.pois.filter((x) => hits([x.position])).map((x) => ({ type: 'poi' as const, id: x.id })),
    ...links.filter((l) => hits([l.from, l.to])).map((l) => ({ type: 'link' as const, id: l.id })),
  ];
}

/* ------------------------------------------------------------------ */
/* Sảnh: tay nắm đổi kích thước                                        */
/* ------------------------------------------------------------------ */

/** Tay nắm của sảnh: giữa cạnh trước (chiều sâu), giữa cạnh trái / phải (bề ngang). */
export type LobbyHandle = 'front' | 'left' | 'right';

/** Vị trí các tay nắm của sảnh. */
export function lobbyHandles(l: SiteLobby): Record<LobbyHandle, Point> {
  const { at } = lobbyFrame(l);
  const h = l.width / 2;
  return {
    front: at(lobbyFullDepth(l), 0),
    left: at(l.depth / 2, h),
    right: at(l.depth / 2, -h),
  };
}

/**
 * Sảnh sau khi kéo tay nắm `handle` tới `p` (tính từ sảnh gốc `l`, bám bước `step` m; 0 = tự do):
 * cạnh trước đổi chiều sâu; cạnh bên đổi bề ngang, cạnh đối diện đứng yên.
 */
export function dragLobbyHandle(l: SiteLobby, handle: LobbyHandle, p: Point, step: number) {
  const { t, local } = lobbyFrame(l);
  const q = local(p);
  const snap = (v: number) => (step > 0 ? Math.round(v / step) * step : v);
  // Tay nắm trước nằm ở mép ngoài cả bệ (kể cả chỗ xe dừng khi có đón / trả ô tô).
  const extra = lobbyFullDepth(l) - l.depth;
  if (handle === 'front') return { depth: Math.max(LOBBY_MIN_SIZE, snap(q.d) - extra) };
  const h = l.width / 2;
  const fixed = handle === 'left' ? -h : h;
  const edge = snap(q.s);
  const width = Math.max(LOBBY_MIN_SIZE, handle === 'left' ? edge - fixed : fixed - edge);
  const mid = handle === 'left' ? fixed + width / 2 : fixed - width / 2;
  return { width, position: add(l.position, scale(t, mid)) };
}
