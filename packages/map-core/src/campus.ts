/**
 * Cơ sở (campus) và mặt bằng tổng thể: nhiều toà nhà đặt trên cùng một hệ toạ độ.
 *
 * - Mỗi toà vẫn giữ hệ trục riêng (mét) để vẽ / chỉ đường như cũ.
 * - `BuildingPlacement` đặt toà lên mặt bằng tổng thể: điểm (0, 0) của toà nằm tại `position`,
 *   rồi xoay `rotation` độ quanh điểm đó (chiều kim đồng hồ vì trục y hướng xuống — giống Konva).
 * - Cơ sở là một tài liệu riêng (có `version`), lưu độc lập với dữ liệu từng toà.
 */
import {
  add,
  boundsOf,
  distance,
  normalizeDegrees,
  offsetPolyline,
  smoothPolyline,
  pointInPolygon,
  polygonCentroid,
  rotatePoint,
  segmentIntersection,
  sub,
  type BBox,
} from './geometry';
import type { Building, Department, Floor, FloorBackground, Id, OpeningType, Point } from './types';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface BuildingPlacement {
  buildingId: Id;
  /** Vị trí trên mặt bằng tổng thể (m) của gốc toạ độ của toà. */
  position: Point;
  /** Góc xoay (độ, chiều kim đồng hồ) quanh `position`. */
  rotation: number;
  /**
   * Cộng vào số tầng của toà để khớp với tầng chung của cơ sở (vd. toà trên dốc có tầng trệt
   * đánh số 2 → `levelOffset = -1`). Bỏ trống = 0.
   */
  levelOffset?: number;
}

/* ------------------------------------------------------------------ */
/* Ngoài trời                                                          */
/* ------------------------------------------------------------------ */

export type SiteAreaKind =
  | 'road'
  | 'parking'
  | 'bike_parking'
  | 'plaza'
  | 'dropoff'
  | 'green'
  | 'water'
  | 'restricted'
  | 'structure';

/** Khu vực ngoài trời (đa giác, toạ độ mặt bằng tổng thể). */
export interface SiteArea {
  id: Id;
  kind: SiteAreaKind;
  name?: string;
  polygon: Point[];
  /** Sân / sảnh, khu đón trả khách: cao độ bệ so với mặt đường (m). Bỏ trống = `DEFAULT_RAMP_RISE`. */
  rise?: number;
}

/**
 * Đường ngoài trời (đường gấp khúc theo tim đường):
 * - `vehicle`: đường xe — chỉ để vẽ, người đi bộ không được chỉ đi trên đó.
 * - `ramp`: dốc cho xe lên sảnh — vẽ theo chiều đi LÊN dốc (điểm đầu thấp, điểm cuối cao);
 *   cũng chỉ để vẽ như đường xe.
 * - `pedestrian`: lối đi bộ · `covered`: lối đi bộ có mái che.
 * - `shared`: đường chung — lòng đường ở giữa cho xe, vỉa hè hai bên cho người đi bộ.
 * - `fence`: hàng rào (vd. bao quanh khuôn viên) — chỉ để vẽ; cổng đặt trên hàng rào tạo lối qua.
 * - `steps`: bậc thang cho người đi bộ — vẽ theo chiều đi LÊN (điểm đầu thấp, điểm cuối cao), bề
 *   rộng `width` là bề ngang bậc; xe lăn không đi được.
 * - `slope`: mặt dốc thoải cho người đi bộ / xe lăn — cũng vẽ theo chiều đi lên.
 */
export type SitePathKind =
  'vehicle' | 'ramp' | 'pedestrian' | 'covered' | 'shared' | 'fence' | 'steps' | 'slope';

/** Bậc thang / mặt dốc đi bộ (đầu → cuối là chiều đi lên, đầu cắt vuông). */
export const isStairLike = (p: Pick<SitePath, 'kind'>) => p.kind === 'steps' || p.kind === 'slope';

/** Loại xe được đi trên đường xe / dốc. Bỏ trống = cả ô tô và xe máy. */
export type SiteVehicleAccess = 'car' | 'motorbike';

/**
 * Dốc / làn xe dành cho khu nào — để người xem biết dốc nào lên sảnh Cấp cứu, dốc nào lên Khoa
 * Khám bệnh… (vẽ màu + biểu tượng riêng).
 */
export type SiteRampUse = 'emergency' | 'outpatient' | 'inpatient' | 'lobby' | 'service';

export const SITE_RAMP_USES: readonly SiteRampUse[] = [
  'emergency',
  'outpatient',
  'inpatient',
  'lobby',
  'service',
];

/** Lối đi bộ trên dốc: bên trái / phải lòng dốc (theo chiều đi LÊN, nhìn trên bản đồ) hoặc cả hai. */
export type RampWalkSide = 'left' | 'right' | 'both';

/** Chiều xe chạy trên dốc: chỉ lên (vào sảnh), chỉ xuống (ra đường) hoặc hai chiều. */
export type RampFlow = 'up' | 'down' | 'both';

/** Đường dành cho xe (không phải lối đi bộ). */
export const isRoadPath = (p: Pick<SitePath, 'kind'>) =>
  p.kind === 'vehicle' || p.kind === 'ramp' || p.kind === 'shared';

export interface SitePath {
  id: Id;
  kind: SitePathKind;
  name?: string;
  points: Point[];
  /** Bề rộng (m) để vẽ. */
  width: number;
  /** Đường xe một chiều theo thứ tự các điểm. */
  oneWay?: boolean;
  /** Chỉ dành cho ô tô / chỉ xe máy (đường xe, dốc). Bỏ trống = cả hai. */
  vehicles?: SiteVehicleAccess;
  /** Dốc / làn xe phục vụ khu nào (Cấp cứu, Khoa Khám bệnh…). Bỏ trống = dùng chung. */
  use?: SiteRampUse;
  /** false nếu không phù hợp xe lăn (bậc thang, dốc gắt). Mặc định true. */
  accessible?: boolean;
  /**
   * Đường chung: bề rộng vỉa hè MỖI bên (m). Bỏ trống = tự tính theo bề rộng đường.
   * Dốc có lối đi bộ: bề rộng lối đi bộ (m), mặc định 1.5.
   */
  sidewalk?: number;
  /**
   * Dốc: lối đi bộ đi kèm (có bó vỉa ngăn với làn xe) để người đi bộ / xe lăn lên sảnh cùng dốc.
   * Lối đi bộ nằm NGOÀI bề rộng `width` của lòng dốc. Bỏ trống = dốc chỉ cho xe.
   */
  walkway?: RampWalkSide;
  /** Dốc: chiều xe chạy (mũi tên trên bản đồ). Bỏ trống = chỉ đi lên. */
  flow?: RampFlow;
  /**
   * Dốc, bậc thang, mặt dốc đi bộ: độ chênh cao từ chân lên đỉnh (m). Bỏ trống =
   * `DEFAULT_RAMP_RISE`.
   */
  rise?: number;
}

/** Độ chênh cao mặc định của dốc = cao độ bệ sảnh (m). */
export const DEFAULT_RAMP_RISE = 0.45;

/** Độ chênh cao thực tế của dốc (m). */
export const rampRise = (p: Pick<SitePath, 'rise'>): number =>
  p.rise !== undefined && p.rise >= 0 ? p.rise : DEFAULT_RAMP_RISE;

/**
 * Tim dốc đã làm mượt (dốc thường cong) — dùng chung cho vẽ 2D / 3D và chỉ đường. Đầu dốc trùng đầu
 * một đường khác (vd. làn đón trả khách) được bẻ cho tiếp tuyến với đường đó để chỗ nối không bị xiên.
 */
export function rampCenterline(
  p: Pick<SitePath, 'points'>,
  paths: readonly Pick<SitePath, 'kind' | 'points'>[] = [],
): Point[] {
  const pts = [...p.points];
  /** Hướng đi vào đường khác tại đầu mút `end` của nó (null nếu không có đường nào bắt đầu ở đó). */
  const into = (end: Point): Point | null => {
    for (const q of paths) {
      if (q === p || q.kind === 'fence' || q.points.length < 2) continue;
      const n = q.points.length;
      const [a, b] =
        distance(q.points[0]!, end) < 0.05
          ? [q.points[0]!, q.points[1]!]
          : distance(q.points[n - 1]!, end) < 0.05
            ? [q.points[n - 1]!, q.points[n - 2]!]
            : [null, null];
      if (!a || !b) continue;
      const len = distance(a, b) || 1;
      return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    }
    return null;
  };
  if (pts.length >= 2) {
    const n = pts.length;
    const top = pts[n - 1]!;
    const d = into(top);
    if (d) {
      const l = Math.min(1.5, distance(pts[n - 2]!, top) * 0.5);
      pts.splice(n - 1, 0, { x: top.x - d.x * l, y: top.y - d.y * l });
    }
    const start = pts[0]!;
    const d0 = into(start);
    if (d0) {
      const l = Math.min(1.5, distance(pts[1]!, start) * 0.5);
      pts.splice(1, 0, { x: start.x - d0.x * l, y: start.y - d0.y * l });
    }
  }
  return smoothPolyline(pts);
}

/** Bề rộng lối đi bộ trên dốc (0 nếu dốc chỉ cho xe). */
export const rampWalkWidth = (p: Pick<SitePath, 'kind' | 'walkway' | 'sidewalk'>): number =>
  p.kind === 'ramp' && p.walkway ? Math.min(Math.max(p.sidewalk ?? 1.5, 0.8), 4) : 0;

/** Tim các lối đi bộ trên dốc (vẽ từ chân dốc lên), toạ độ mặt bằng tổng thể. */
export function rampWalkLines(
  p: Pick<SitePath, 'kind' | 'walkway' | 'sidewalk' | 'width' | 'points'>,
  paths: readonly Pick<SitePath, 'kind' | 'points'>[] = [],
): Point[][] {
  const w = rampWalkWidth(p);
  if (!w || p.points.length < 2) return [];
  const d = p.width / 2 + w / 2;
  const sides = p.walkway === 'both' ? [d, -d] : p.walkway === 'right' ? [d] : [-d];
  const center = rampCenterline(p, paths);
  return sides.map((k) => offsetPolyline(center, k));
}

/** Bề rộng vỉa hè mỗi bên của đường chung (0 với các loại đường khác). */
export const sidewalkWidth = (p: Pick<SitePath, 'kind' | 'width' | 'sidewalk'>): number =>
  p.kind === 'shared'
    ? Math.max(0, Math.min(p.sidewalk ?? Math.min(2, p.width * 0.2), (p.width - 2.5) / 2))
    : 0;

export type SiteGateKind = 'vehicle' | 'pedestrian' | 'both';

/**
 * Kiểu cánh cổng: `barrier` thanh chắn · `double` cổng 2 cánh mở quay · `sliding` cổng kéo (cửa xếp)
 * · `open` lối không cánh.
 */
export type SiteGateStyle = 'barrier' | 'double' | 'sliding' | 'open';

/** Giờ mở cổng trong ngày, dạng `HH:MM` (giờ đóng nhỏ hơn giờ mở = mở qua đêm). */
export interface SiteGateSchedule {
  open: string;
  close: string;
}

export interface SiteGate {
  id: Id;
  name: string;
  kind: SiteGateKind;
  position: Point;
  /** Mặc định: cổng đi bộ 2 cánh, cổng xe thanh chắn. */
  style?: SiteGateStyle;
  /** Bỏ trống = mở cả ngày. */
  schedule?: SiteGateSchedule;
}

/** Kiểu cánh thực tế của cổng (có mặc định theo loại cổng). */
export const gateStyleOf = (g: Pick<SiteGate, 'kind' | 'style'>): SiteGateStyle =>
  g.style ?? (g.kind === 'pedestrian' ? 'double' : 'barrier');

/** `HH:MM` → số phút từ 0h; null nếu sai định dạng. */
export function parseClock(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 24 && min < 60 && h * 60 + min <= 24 * 60 ? h * 60 + min : null;
}

/** Cổng có đang mở vào thời điểm `at` (giờ địa phương) không. Giờ sai định dạng = coi như mở. */
export function isGateOpen(g: Pick<SiteGate, 'schedule'>, at: Date): boolean {
  if (!g.schedule) return true;
  const open = parseClock(g.schedule.open);
  const close = parseClock(g.schedule.close);
  if (open === null || close === null || open === close) return true;
  const now = at.getHours() * 60 + at.getMinutes();
  return open < close ? now >= open && now < close : now >= open || now < close;
}

export type SitePoiKind =
  | 'atm'
  | 'shop'
  | 'canteen'
  | 'pharmacy'
  | 'parking'
  | 'bus'
  | 'taxi'
  | 'security'
  | 'emergency'
  | 'restroom'
  | 'info'
  | 'bike'
  | 'ev'
  | 'other';

/** Điểm ngoài trời: cây ATM, ki-ốt bán hàng, điểm đón taxi… — tìm kiếm và chỉ đường tới được. */
export interface SitePoi {
  id: Id;
  name: string;
  kind: SitePoiKind;
  position: Point;
  tags: string[];
  description?: string;
}

/** Phần ngoài trời của mặt bằng tổng thể. */
export interface SitePlan {
  areas: SiteArea[];
  paths: SitePath[];
  gates: SiteGate[];
  pois: SitePoi[];
  /**
   * Sảnh (một đối tượng gồm bệ sảnh + bậc / dốc ở các cạnh + làn đón ô tô) — các phần của sảnh được
   * sinh ra khi vẽ / chỉ đường (`withLobbyParts`), không lưu trong `areas` / `paths`.
   */
  lobbies?: SiteLobby[];
}

/** Cạnh của sảnh (cạnh còn lại sát tường toà): nhìn từ cửa ra ngoài. */
export type LobbySide = 'front' | 'left' | 'right';

export const LOBBY_SIDES: readonly LobbySide[] = ['front', 'left', 'right'];

/**
 * Một cạnh của sảnh: `none` thềm đứng (không lên xuống được) · `steps` bậc thang cả cạnh · `ramp`
 * cả cạnh là mặt dốc thoải · `steps_ramp` bậc thang ở giữa, dốc xe lăn ở một đầu.
 */
export type LobbyEdgeKind = 'none' | 'steps' | 'ramp' | 'steps_ramp';

export interface LobbyEdge {
  kind: LobbyEdgeKind;
  /** `steps_ramp`: dốc xe lăn ở đầu bên trái / phải (nhìn từ trong sảnh ra qua cạnh này). */
  rampAt?: 'left' | 'right';
}

/**
 * Hình dốc ô tô lên làn đón: `curve` cong chữ S (chân dốc dạt sang hai bên) · `straight` thẳng vuông
 * góc ra đường, bo góc tròn chỗ nhập vào đầu làn đón · `inline` thẳng nối dài làn đón (180°, dọc
 * theo tường), chân dốc ở hai bên sảnh.
 */
export type LobbyRampShape = 'curve' | 'straight' | 'inline';

/** Làn đón ô tô trước sảnh: làn một chiều + dốc lên / dốc xuống. */
export interface LobbyDropoff {
  /** Lối đi bộ có bó vỉa đi kèm hai dốc. Mặc định có. */
  walkway?: boolean;
  /** Hình hai dốc. Bỏ trống = cong chữ S. */
  shape?: LobbyRampShape;
  /** Khoảng cách từ tường tới chân dốc (m). Bỏ trống = tự tính. */
  reach?: number;
  /**
   * Dốc cong, dốc thẳng 180°: khoảng cách từ tâm sảnh tới mỗi chân dốc, dọc theo tường (m). Bỏ trống
   * = 12.5. Dốc thẳng vuông góc không dùng (chân dốc thẳng hàng với đầu làn đón).
   */
  spread?: number;
}

/** Sảnh: bệ lát gạch sát tường toà, mỗi cạnh có thể có bậc / dốc, tuỳ chọn có làn đón ô tô. */
export interface SiteLobby {
  id: Id;
  name?: string;
  /** Sảnh phục vụ khu nào (màu + biểu tượng của dốc, làn đón). */
  use?: SiteRampUse;
  /** Tâm cạnh sảnh sát tường (thường là tâm cửa chính). */
  position: Point;
  /** Hướng từ tường ra ngoài (vector đơn vị). */
  outward: Point;
  /** Bề ngang dọc theo tường (m). */
  width: number;
  /** Chiều sâu tính từ tường (m). */
  depth: number;
  /** Cao độ bệ sảnh so với mặt đường (m). Bỏ trống = `DEFAULT_RAMP_RISE`. */
  rise?: number;
  /**
   * Bậc / dốc ở từng cạnh. Bỏ trống = không có. Có làn đón ô tô thì bậc / dốc cạnh trước nằm ở mép
   * ngoài làn đón, giữa hai dốc ô tô (kèm lối qua làn đón vào sảnh).
   */
  edges?: Partial<Record<LobbySide, LobbyEdge>>;
  /** Làn đón ô tô + dốc lên / xuống trước sảnh. Bỏ trống = không có. */
  dropoff?: LobbyDropoff;
}

export const emptySitePlan = (): SitePlan => ({ areas: [], paths: [], gates: [], pois: [] });

/**
 * Phần ngoài trời gắn liền với một toà — sảnh, làn đón / trả khách, dốc lên sảnh, lối đi bộ, mái
 * sảnh… vẽ ở trang Vẽ toà nhà theo HỆ TRỤC CỦA TOÀ (cùng mặt bằng tầng trệt). Giống "lô đất" của
 * công trình trong SimCity / Cities: Skylines: dời / xoay toà trên mặt bằng tổng thể thì phần này đi
 * theo; ở Khuôn viên chỉ cần vẽ đường nối vào các đầu nối của toà (chân dốc, đầu lối đi bộ — xem
 * `exteriorSockets`).
 */
export interface BuildingExterior {
  areas: SiteArea[];
  paths: SitePath[];
  /** Sảnh của toà (xem `SiteLobby`). */
  lobbies?: SiteLobby[];
}

export const emptyExterior = (): BuildingExterior => ({ areas: [], paths: [] });

/** Một đầu của lối nối: một ô cửa (cửa đi / cửa chính) trên một tầng của toà. */
export interface LinkEnd {
  buildingId: Id;
  floorId: Id;
  openingId: Id;
}

/** Cầu nối / hầm / hành lang nối thẳng hai toà (không đi ra ngoài trời). */
export interface BuildingLink {
  id: Id;
  name: string;
  kind: 'bridge' | 'tunnel' | 'corridor';
  a: LinkEnd;
  b: LinkEnd;
  accessible: boolean;
  covered: boolean;
  /**
   * Cao độ sàn cầu so với mặt đất (m) — dùng khi dựng 3D. Bỏ trống = cao độ sàn tầng có cửa đầu cầu
   * (xem `linkElevation`).
   */
  elevation?: number;
  /** Chiều cao thông thuỷ dưới mái (m). Bỏ trống = `DEFAULT_LINK_HEIGHT`. */
  height?: number;
  /** Bề rộng sàn cầu (m). Bỏ trống = `DEFAULT_LINK_WIDTH`. */
  width?: number;
}

export const DEFAULT_LINK_HEIGHT = 3;
export const DEFAULT_LINK_WIDTH = 2.6;

/**
 * Cao độ sàn cầu (m): giá trị đã nhập, hoặc trung bình cao độ sàn hai tầng có cửa đầu cầu.
 * @param floorElevation cao độ sàn của một tầng (null nếu chưa biết).
 */
export function linkElevation(
  link: Pick<BuildingLink, 'elevation' | 'a' | 'b'>,
  floorElevation: (buildingId: Id, floorId: Id) => number | null | undefined,
): number {
  if (link.elevation !== undefined && Number.isFinite(link.elevation)) return link.elevation;
  const ends = [link.a, link.b]
    .map((e) => floorElevation(e.buildingId, e.floorId))
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return ends.length ? ends.reduce((a, b) => a + b, 0) / ends.length : 0;
}

export interface Campus {
  id: Id;
  name: string;
  /** Mã ngắn, ví dụ `CS1`. */
  code?: string;
  address?: string;
  /** Toạ độ GPS (để mở bản đồ ngoài, gợi ý cơ sở gần nhất). */
  geo?: GeoPoint;
  /** Hướng Bắc trên mặt bằng tổng thể — cùng quy ước với `Building.northAngle`. */
  northAngle?: number;
  /** Các toà thuộc cơ sở và vị trí của chúng. Mỗi toà thuộc tối đa một cơ sở. */
  buildings: BuildingPlacement[];
  /** Ảnh vệ tinh / bản vẽ quy hoạch làm nền mặt bằng tổng thể. */
  background?: FloorBackground;
  /** Đường, lối đi, bãi xe, cổng, điểm ngoài trời (dữ liệu cũ có thể không có). */
  site?: SitePlan;
  /** Cầu nối giữa các toà (dữ liệu cũ có thể không có). */
  links?: BuildingLink[];
  version: number;
  updatedAt: string;
}

export interface CampusSummary {
  id: Id;
  name: string;
  code?: string;
  address?: string;
  geo?: GeoPoint;
  buildingIds: Id[];
  updatedAt: string;
}

/** Thông tin rút gọn của một toà để vẽ mặt bằng tổng thể mà không cần tải cả toà. */
export interface CampusBuildingInfo {
  id: Id;
  name: string;
  floorCount: number;
  /** Đường bao tầng trệt, theo hệ trục riêng của toà. */
  footprint: Point[];
  /** Cửa đi / cửa chính (theo hệ trục của toà) — để nối ra lối đi ngoài trời và làm cầu nối. */
  doors?: CampusDoor[];
  /** Số thứ tự các tầng của toà (chưa cộng `levelOffset`). */
  levels?: number[];
  /** Sảnh, làn đón, dốc… của toà (theo hệ trục của toà) — để ghép vào mặt bằng tổng thể. */
  exterior?: BuildingExterior;
}

export interface CampusDoor {
  openingId: Id;
  floorId: Id;
  level: number;
  type: OpeningType;
  /** Tâm ô cửa theo hệ trục của toà. */
  position: Point;
  /** Cửa nằm trên tường ngoài (một phía nhìn ra ngoài toà) — chỉ cửa này mới làm đầu cầu nối được. */
  exterior?: boolean;
}

/**
 * GET /campuses/:id/map?level= — bản đồ cơ sở ở một tầng: tầng tương ứng của mọi toà (theo số tầng
 * chung đã cộng `levelOffset`) + phần ngoài trời.
 */
export interface CampusMapView {
  campus: CampusView;
  level: number;
  /** Các tầng chung có trong cơ sở (tăng dần). */
  levels: number[];
  /** Tầng chung ứng với mặt đất — phần ngoài trời vẽ đầy đủ ở tầng này. */
  groundLevel: number;
  floors: { buildingId: Id; floor: Floor }[];
  departments: Department[];
}

/** GET /campuses/:id — cơ sở kèm thông tin rút gọn các toà (phần thêm này bị bỏ qua khi lưu). */
export interface CampusView extends Campus {
  buildingInfo: CampusBuildingInfo[];
}

/* ------------------------------------------------------------------ */
/* Hình học                                                            */
/* ------------------------------------------------------------------ */

/** Tầng dùng làm mặt bằng của toà trên bản đồ tổng thể: tầng thấp nhất không phải tầng hầm. */
export function groundFloor(building: Pick<Building, 'floors'>): Floor | undefined {
  const sorted = [...building.floors].sort((a, b) => a.level - b.level);
  return sorted.find((f) => f.level >= 0) ?? sorted[sorted.length - 1];
}

/** Bao lồi (thuật toán monotone chain), theo chiều kim đồng hồ trên canvas. */
export function convexHull(points: readonly Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 1e-9) {
        out.pop();
      }
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/** Đường bao tầng trệt của toà (bao lồi của tường, phòng, thang). Rỗng nếu tầng chưa vẽ gì. */
export function buildingFootprint(building: Pick<Building, 'floors'>): Point[] {
  const floor = groundFloor(building);
  if (!floor) return [];
  const points = [
    ...floor.walls.flatMap((w) => [w.start, w.end]),
    ...floor.rooms.flatMap((r) => r.polygon),
    ...floor.connectors.flatMap((c) => c.polygon),
  ];
  return convexHull(points);
}

/** Đổi điểm theo hệ trục của toà sang toạ độ trên mặt bằng tổng thể. */
export const toSite = (placement: BuildingPlacement, p: Point): Point =>
  add(placement.position, rotatePoint(p, { x: 0, y: 0 }, placement.rotation));

/** Đổi điểm trên mặt bằng tổng thể về hệ trục của toà. */
export const fromSite = (placement: BuildingPlacement, p: Point): Point =>
  rotatePoint(sub(p, placement.position), { x: 0, y: 0 }, -placement.rotation);

/** Đường bao của toà trên mặt bằng tổng thể. */
export const placedFootprint = (placement: BuildingPlacement, footprint: readonly Point[]) =>
  footprint.map((p) => toSite(placement, p));

/**
 * Đổi góc xoay mà giữ nguyên vị trí của điểm `pivot` (theo hệ trục của toà) trên mặt bằng —
 * dùng để xoay toà quanh tâm của nó thay vì quanh gốc toạ độ.
 */
export function rotatePlacement(
  placement: BuildingPlacement,
  pivot: Point,
  rotation: number,
): BuildingPlacement {
  const fixed = toSite(placement, pivot);
  const next = { ...placement, rotation: normalizeDegrees(rotation) };
  return { ...next, position: sub(fixed, rotatePoint(pivot, { x: 0, y: 0 }, next.rotation)) };
}

/** Tâm đường bao (hoặc gốc toạ độ nếu toà chưa vẽ gì). */
export const footprintCenter = (footprint: readonly Point[]): Point =>
  footprint.length >= 3 ? polygonCentroid(footprint) : { x: 0, y: 0 };

/** Hộp bao của mọi toà đã đặt trên mặt bằng tổng thể. */
export function campusBounds(
  campus: Pick<Campus, 'buildings'>,
  footprints: ReadonlyMap<Id, readonly Point[]>,
): BBox | null {
  return boundsOf(
    campus.buildings.flatMap((pl) => {
      const fp = footprints.get(pl.buildingId) ?? [];
      return fp.length ? placedFootprint(pl, fp) : [pl.position];
    }),
  );
}

/** Vị trí đặt toà mới: bên phải các toà đã có, cách 10 m (khớp lưới 1 m). */
export function nextPlacementPosition(
  campus: Pick<Campus, 'buildings'>,
  footprints: ReadonlyMap<Id, readonly Point[]>,
  gap = 10,
): Point {
  const b = campusBounds(campus, footprints);
  return b ? { x: Math.ceil(b.maxX + gap), y: Math.floor(b.minY) } : { x: 0, y: 0 };
}

/** Hai đa giác (lồi hoặc không) có chồng lên nhau không. */
export function polygonsOverlap(a: readonly Point[], b: readonly Point[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const hit = segmentIntersection(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!);
      if (hit) return true;
    }
  }
  return pointInPolygon(a[0]!, b) || pointInPolygon(b[0]!, a);
}

/* ------------------------------------------------------------------ */
/* Kiểm tra                                                            */
/* ------------------------------------------------------------------ */

export type CampusIssueCode =
  | 'EMPTY_NAME'
  | 'UNKNOWN_BUILDING'
  | 'DUPLICATE_BUILDING'
  | 'INVALID_GEO'
  | 'BUILDINGS_OVERLAP'
  | 'LINK_MISSING_DOOR'
  | 'LINK_SAME_BUILDING'
  | 'LINK_DUPLICATE'
  | 'LINK_LEVEL_MISMATCH'
  | 'LINK_INTERIOR_DOOR'
  | 'INVALID_SITE_SHAPE'
  | 'INVALID_GATE_SCHEDULE';

export interface CampusIssue {
  severity: 'error' | 'warning';
  code: CampusIssueCode;
  message: string;
  buildingId?: Id;
  /** Đối tượng ngoài trời / cầu nối gặp vấn đề. */
  refId?: Id;
}

/**
 * Kiểm tra dữ liệu cơ sở.
 * @param buildings thông tin các toà đã biết (tên + đường bao) — để kiểm tra tham chiếu và chồng lấn.
 */
export function validateCampus(
  campus: Campus,
  buildings: ReadonlyMap<Id, Pick<CampusBuildingInfo, 'name' | 'footprint' | 'doors'>>,
): { valid: boolean; issues: CampusIssue[] } {
  const issues: CampusIssue[] = [];
  if (!campus.name.trim()) {
    issues.push({ severity: 'error', code: 'EMPTY_NAME', message: 'Cơ sở chưa có tên' });
  }
  if (
    campus.geo &&
    !(Math.abs(campus.geo.lat) <= 90 && Math.abs(campus.geo.lng) <= 180) // NaN cũng bị loại
  ) {
    issues.push({ severity: 'error', code: 'INVALID_GEO', message: 'Toạ độ GPS không hợp lệ' });
  }
  const seen = new Set<Id>();
  for (const pl of campus.buildings) {
    if (seen.has(pl.buildingId)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_BUILDING',
        message: `Toà "${buildings.get(pl.buildingId)?.name ?? pl.buildingId}" được đặt nhiều lần`,
        buildingId: pl.buildingId,
      });
    }
    seen.add(pl.buildingId);
    if (!buildings.has(pl.buildingId)) {
      issues.push({
        severity: 'error',
        code: 'UNKNOWN_BUILDING',
        message: `Không tìm thấy toà nhà "${pl.buildingId}"`,
        buildingId: pl.buildingId,
      });
    }
  }
  const placed = campus.buildings
    .map((pl) => ({ pl, info: buildings.get(pl.buildingId) }))
    .filter((x) => x.info && x.info.footprint.length >= 3)
    .map((x) => ({ ...x, shape: placedFootprint(x.pl, x.info!.footprint) }));
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!;
      const b = placed[j]!;
      if (polygonsOverlap(a.shape, b.shape)) {
        issues.push({
          severity: 'warning',
          code: 'BUILDINGS_OVERLAP',
          message: `Toà "${a.info!.name}" chồng lên toà "${b.info!.name}"`,
          buildingId: b.pl.buildingId,
        });
      }
    }
  }
  for (const link of campus.links ?? []) {
    if (link.a.buildingId === link.b.buildingId) {
      issues.push({
        severity: 'error',
        code: 'LINK_SAME_BUILDING',
        message: `Lối nối "${link.name}" phải nối hai toà khác nhau`,
        refId: link.id,
      });
    }
    const levels: number[] = [];
    for (const end of [link.a, link.b]) {
      const info = buildings.get(end.buildingId);
      const pl = campus.buildings.find((x) => x.buildingId === end.buildingId);
      const door = info?.doors?.find((d) => d.openingId === end.openingId);
      if (!pl || (info?.doors && !door)) {
        issues.push({
          severity: 'error',
          code: 'LINK_MISSING_DOOR',
          message: `Lối nối "${link.name}" trỏ tới cửa không còn tồn tại (toà "${info?.name ?? end.buildingId}")`,
          refId: link.id,
          buildingId: end.buildingId,
        });
        continue;
      }
      if (!door) continue;
      levels.push(campusLevel(pl, door.level));
      if (door.exterior === false) {
        issues.push({
          severity: 'warning',
          code: 'LINK_INTERIOR_DOOR',
          message: `Đầu cầu "${link.name}" ở toà "${info?.name ?? end.buildingId}" là cửa bên trong toà — nên dùng cửa trên tường ngoài`,
          refId: link.id,
          buildingId: end.buildingId,
        });
      }
    }
    if (levels.length === 2 && levels[0] !== levels[1]) {
      issues.push({
        severity: 'warning',
        code: 'LINK_LEVEL_MISMATCH',
        message: `Hai đầu cầu "${link.name}" ở hai tầng khác nhau (tầng ${levels[0]} và ${levels[1]})`,
        refId: link.id,
      });
    }
  }
  const linkKey = (l: BuildingLink) =>
    [`${l.a.buildingId}:${l.a.openingId}`, `${l.b.buildingId}:${l.b.openingId}`].sort().join('|');
  const linkKeys = new Set<string>();
  for (const link of campus.links ?? []) {
    const k = linkKey(link);
    if (linkKeys.has(k)) {
      issues.push({
        severity: 'warning',
        code: 'LINK_DUPLICATE',
        message: `Cầu "${link.name}" trùng với một cầu khác (cùng hai cửa)`,
        refId: link.id,
      });
    }
    linkKeys.add(k);
  }
  const site = campus.site;
  if (site) {
    for (const a of site.areas) {
      if (a.polygon.length < 3) {
        issues.push({
          severity: 'error',
          code: 'INVALID_SITE_SHAPE',
          message: `Khu vực "${a.name || a.kind}" cần ít nhất 3 đỉnh`,
          refId: a.id,
        });
      }
    }
    for (const g of site.gates) {
      if (
        g.schedule &&
        (parseClock(g.schedule.open) === null || parseClock(g.schedule.close) === null)
      ) {
        issues.push({
          severity: 'error',
          code: 'INVALID_GATE_SCHEDULE',
          message: `Giờ mở / đóng của cổng "${g.name}" phải có dạng HH:MM`,
          refId: g.id,
        });
      }
    }
    for (const p of site.paths) {
      if (p.points.length < 2) {
        issues.push({
          severity: 'error',
          code: 'INVALID_SITE_SHAPE',
          message: `Đường "${p.name || p.kind}" cần ít nhất 2 điểm`,
          refId: p.id,
        });
      }
    }
  }
  return { valid: !issues.some((i) => i.severity === 'error'), issues };
}

/** Tâm các cửa đi / cửa chính của toà (theo hệ trục của toà). */
export function buildingDoors(building: Pick<Building, 'floors'>): CampusDoor[] {
  return building.floors.flatMap((floor) =>
    floor.openings.flatMap((o) => {
      if (o.type === 'window') return [];
      const wall = floor.walls.find((w) => w.id === o.wallId);
      if (!wall) return [];
      const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) || 1;
      const t = o.offset / len;
      const position = {
        x: wall.start.x + (wall.end.x - wall.start.x) * t,
        y: wall.start.y + (wall.end.y - wall.start.y) * t,
      };
      return [
        {
          openingId: o.id,
          floorId: floor.id,
          level: floor.level,
          type: o.type,
          position,
          exterior: o.type === 'entrance' || doorOutward(floor, wall, position) !== null,
        },
      ];
    }),
  );
}

/** Các hướng dò (độ, lệch so với pháp tuyến của tường) để tìm phía "ngoài toà" của một cửa. */
const OUTWARD_PROBES = [0, 30, -30, 60, -60];
/** Tia dò dài hơn mọi toà thực tế. */
const PROBE_LENGTH = 2000;

/**
 * Hướng (vector đơn vị, hệ trục của toà) từ cửa nhìn ra ngoài toà, hoặc null nếu cửa nằm bên trong
 * (cả hai phía đều bị tường khác chắn — cửa phòng, cửa hành lang…).
 * Một phía là "ngoài" khi có tia xuất phát từ cửa theo phía đó không cắt bức tường nào khác của tầng.
 */
export function doorOutward(
  floor: Pick<Floor, 'walls'>,
  wall: Pick<Floor['walls'][number], 'id' | 'start' | 'end'>,
  position: Point,
): Point | null {
  const d = sub(wall.end, wall.start);
  const len = Math.hypot(d.x, d.y);
  if (len === 0) return null;
  const others = floor.walls.filter((w) => w.id !== wall.id);
  for (const sign of [1, -1]) {
    const n = { x: (-d.y / len) * sign, y: (d.x / len) * sign };
    // Lùi ra khỏi mặt tường một chút để không cắt các tường nối vào hai đầu ô cửa.
    const start = add(position, { x: n.x * 0.05, y: n.y * 0.05 });
    const free = OUTWARD_PROBES.some((deg) => {
      const dir = rotatePoint(n, { x: 0, y: 0 }, deg);
      const end = add(start, { x: dir.x * PROBE_LENGTH, y: dir.y * PROBE_LENGTH });
      return !others.some((w) => segmentIntersection(start, end, w.start, w.end) !== null);
    });
    if (free) return n;
  }
  return null;
}

/** Thông tin rút gọn của toà để vẽ mặt bằng tổng thể. */
export const campusBuildingInfo = (building: Building): CampusBuildingInfo => ({
  id: building.id,
  name: building.name,
  floorCount: building.floors.length,
  footprint: buildingFootprint(building),
  doors: buildingDoors(building),
  levels: [...new Set(building.floors.map((f) => f.level))].sort((a, b) => a - b),
  ...(building.exterior ? { exterior: building.exterior } : {}),
});

/* ------------------------------------------------------------------ */
/* Tầng chung của cơ sở                                                */
/* ------------------------------------------------------------------ */

/** Số tầng chung (của cơ sở) của tầng `level` thuộc toà đặt theo `placement`. */
export const campusLevel = (placement: Pick<BuildingPlacement, 'levelOffset'>, level: number) =>
  level + (placement.levelOffset ?? 0);

/** Tầng của toà ứng với tầng chung `level` của cơ sở. */
export const floorAtLevel = (
  building: Pick<Building, 'floors'>,
  placement: Pick<BuildingPlacement, 'levelOffset'>,
  level: number,
): Floor | undefined => building.floors.find((f) => campusLevel(placement, f.level) === level);

/** Các tầng chung có trong cơ sở (tăng dần). */
export function campusLevels(
  campus: Pick<Campus, 'buildings'>,
  levelsOf: (buildingId: Id) => readonly number[] | undefined,
): number[] {
  const set = new Set<number>();
  for (const pl of campus.buildings) {
    for (const l of levelsOf(pl.buildingId) ?? []) set.add(campusLevel(pl, l));
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Tầng chung ứng với mặt đất: tầng thấp nhất không phải hầm, phổ biến nhất giữa các toà
 * (hoà thì lấy tầng thấp hơn). Mặc định 1 — quy ước "Tầng 1" là tầng trệt.
 */
export function campusGroundLevel(
  campus: Pick<Campus, 'buildings'>,
  levelsOf: (buildingId: Id) => readonly number[] | undefined,
): number {
  const votes = new Map<number, number>();
  for (const pl of campus.buildings) {
    const levels = [...(levelsOf(pl.buildingId) ?? [])].sort((a, b) => a - b);
    const ground = levels.find((l) => l >= 0) ?? levels[levels.length - 1];
    if (ground === undefined) continue;
    const l = campusLevel(pl, ground);
    votes.set(l, (votes.get(l) ?? 0) + 1);
  }
  let best: { level: number; n: number } | null = null;
  for (const [level, n] of votes) {
    if (!best || n > best.n || (n === best.n && level < best.level)) best = { level, n };
  }
  return best?.level ?? 1;
}

/** Tâm (toạ độ mặt bằng tổng thể) của một ô cửa. */
export function doorSitePosition(
  campus: Pick<Campus, 'buildings'>,
  info: ReadonlyMap<Id, Pick<CampusBuildingInfo, 'doors'>>,
  end: Pick<LinkEnd, 'buildingId' | 'openingId'>,
): Point | undefined {
  const pl = campus.buildings.find((x) => x.buildingId === end.buildingId);
  const door = info.get(end.buildingId)?.doors?.find((d) => d.openingId === end.openingId);
  return pl && door ? toSite(pl, door.position) : undefined;
}

/** Liên kết mở bản đồ ngoài (Google Maps) tới toạ độ / địa chỉ của cơ sở. */
export function externalMapUrl(campus: Pick<Campus, 'geo' | 'address' | 'name'>): string | null {
  const query = campus.geo
    ? `${campus.geo.lat},${campus.geo.lng}`
    : campus.address
      ? `${campus.name}, ${campus.address}`
      : null;
  return query
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
    : null;
}
