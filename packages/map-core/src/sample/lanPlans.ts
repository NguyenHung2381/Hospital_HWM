/**
 * Mặt bằng thật của bệnh viện, lấy từ bộ bản vẽ "Hệ thống LAN – mặt bằng không dây" (PDF, 14 trang).
 *
 * Mỗi trang bản vẽ được cắt thành một ảnh PNG trong `apps/admin/public/plans/` và gắn làm ảnh nền
 * (`Floor.background`) cho đúng tầng của đúng toà. Tường, vách, cột, cửa, thang bộ / cuốn / máy và
 * dốc trích tự động từ nét vector của bản vẽ (xem `planStructure.ts`); phòng và đồ thị chỉ đường
 * chưa có — vẽ tiếp trong trang Vẽ toà nhà. Sơ đồ tổng thể làm ảnh nền khuôn viên (`Campus.background`);
 * nhà cầu và khu bể nước trên đó vẽ thành phần ngoài trời của cơ sở (`lanSitePlan`).
 *
 * Số liệu căn chỉnh (tự động, xem `scripts/plans/README.md`):
 * - Tỉ lệ (m / pixel): đo từ các đường ghi kích thước (mm) trên từng trang. Trang không có kích thước
 *   (khoa chống nhiễm khuẩn, dinh dưỡng, khoa lây) lấy tỉ lệ bằng cách khớp với sơ đồ tổng thể.
 * - Vị trí các tầng trong toà: khớp ảnh tầng với tầng tham chiếu (tầng 1) theo lưới cột.
 * - Vị trí, góc xoay các toà trên khuôn viên: khớp tầng tham chiếu với sơ đồ tổng thể.
 * Sai số cỡ 0,5–1 m — chỉnh lại trong bảng "Ảnh nền" của editor nếu cần.
 *
 * Cao độ sàn lấy theo cốt ghi trên bản vẽ (±0.00, +4.50, +9.00, +16.2, +19.8, +23.4); tầng bán âm
 * và các khoa một / hai tầng dùng giá trị ước lượng.
 */
import type {
  BuildingExterior,
  BuildingPlacement,
  Campus,
  SiteArea,
  SitePath,
  SitePlan,
} from '../campus';
import type { Building, Connector, FloorBackground, Floor, Point, Wall } from '../types';
import { linkPlanConnectors, planStructure } from './planStructure';

export const LAN_CAMPUS_ID = 'campus_lan';

/** Thư mục ảnh mặt bằng (phục vụ từ `public/` của app admin). */
export const PLAN_IMAGE_BASE = '/plans/';

interface PlanFloor {
  key: string;
  name: string;
  level: number;
  elevation: number;
  height: number;
  /** Tên file ảnh trong `PLAN_IMAGE_BASE`. */
  image: string;
  metersPerPixel: number;
  offset: { x: number; y: number };
}

interface PlanBuilding {
  id: string;
  name: string;
  placement: Pick<BuildingPlacement, 'position' | 'rotation'>;
  floors: PlanFloor[];
}

// @generated-plans-start
const PLAN_BUILDINGS: PlanBuilding[] = [
  {
    id: 'bld_lan_main',
    name: 'Nhà chính – khối khám & điều trị',
    placement: { position: { x: -1.33, y: 52.03 }, rotation: 0 },
    floors: [
      {
        key: 'ban-am',
        name: 'Tầng bán âm',
        level: -1,
        elevation: -3.0,
        height: 3.0,
        image: 'nha-chinh-ban-am.png',
        metersPerPixel: 0.020411,
        offset: { x: 57.6, y: 5.6 },
      },
      {
        key: 't1',
        name: 'Tầng 1',
        level: 0,
        elevation: 0,
        height: 4.5,
        image: 'nha-chinh-t1.png',
        metersPerPixel: 0.049317,
        offset: { x: 0.0, y: 0.0 },
      },
      {
        key: 't2',
        name: 'Tầng 2',
        level: 1,
        elevation: 4.5,
        height: 4.5,
        image: 'nha-chinh-t2.png',
        metersPerPixel: 0.048149,
        offset: { x: 0.8, y: 6.0 },
      },
      {
        key: 't3',
        name: 'Tầng 3',
        level: 2,
        elevation: 9.0,
        height: 3.6,
        image: 'nha-chinh-t3.png',
        metersPerPixel: 0.047785,
        offset: { x: 4.8, y: 11.4 },
      },
      {
        key: 't4',
        name: 'Tầng 4',
        level: 3,
        elevation: 12.6,
        height: 3.6,
        image: 'nha-chinh-t4.png',
        metersPerPixel: 0.04783,
        offset: { x: 2.4, y: 7.4 },
      },
      {
        key: 't5',
        name: 'Tầng 5',
        level: 4,
        elevation: 16.2,
        height: 3.6,
        image: 'nha-chinh-t5.png',
        metersPerPixel: 0.020205,
        offset: { x: 62.6, y: 25.2 },
      },
      {
        key: 't6',
        name: 'Tầng 6',
        level: 5,
        elevation: 19.8,
        height: 3.6,
        image: 'nha-chinh-t6.png',
        metersPerPixel: 0.020205,
        offset: { x: 62.6, y: 25.2 },
      },
      {
        key: 't7',
        name: 'Tầng 7',
        level: 6,
        elevation: 23.4,
        height: 3.6,
        image: 'nha-chinh-t7.png',
        metersPerPixel: 0.020205,
        offset: { x: 62.6, y: 25.2 },
      },
    ],
  },
  {
    id: 'bld_lan_cnk',
    name: 'Khoa Chống nhiễm khuẩn',
    placement: { position: { x: 121.93, y: 5.28 }, rotation: 0 },
    floors: [
      {
        key: 't1',
        name: 'Tầng 1',
        level: 0,
        elevation: 0,
        height: 4.2,
        image: 'khoa-chong-nhiem-khuan.png',
        metersPerPixel: 0.01999,
        offset: { x: 0.0, y: 0.0 },
      },
    ],
  },
  {
    id: 'bld_lan_dd',
    name: 'Khoa Dinh dưỡng',
    placement: { position: { x: 31.82, y: 6.0 }, rotation: 0 },
    floors: [
      {
        key: 't1',
        name: 'Tầng 1',
        level: 0,
        elevation: 0,
        height: 4.2,
        image: 'khoa-dinh-duong.png',
        metersPerPixel: 0.019997,
        offset: { x: 0.0, y: 0.0 },
      },
    ],
  },
  {
    id: 'bld_lan_gpbl',
    name: 'Khoa Giải phẫu bệnh lý',
    placement: { position: { x: 219.08, y: 53.38 }, rotation: 270 },
    floors: [
      {
        key: 't1',
        name: 'Tầng 1',
        level: 0,
        elevation: 0,
        height: 4.2,
        image: 'khoa-giai-phau-benh.png',
        metersPerPixel: 0.01999,
        offset: { x: 0.0, y: 0.0 },
      },
    ],
  },
  {
    id: 'bld_lan_lay',
    name: 'Khoa Lây (Truyền nhiễm)',
    placement: { position: { x: 222.0, y: 83.24 }, rotation: 0 },
    floors: [
      {
        key: 't1',
        name: 'Tầng 1',
        level: 0,
        elevation: 0,
        height: 3.6,
        image: 'khoa-lay-t1.png',
        metersPerPixel: 0.019997,
        offset: { x: 0.0, y: 0.0 },
      },
      {
        key: 't2',
        name: 'Tầng 2',
        level: 1,
        elevation: 3.6,
        height: 3.6,
        image: 'khoa-lay-t2.png',
        metersPerPixel: 0.019992,
        offset: { x: 0.0, y: 0.8 },
      },
    ],
  },
];
const OVERVIEW = { image: 'tong-the.png', metersPerPixel: 0.069129 };
// @generated-plans-end

const background = (
  image: string,
  metersPerPixel: number,
  offset = { x: 0, y: 0 },
): FloorBackground => ({
  url: PLAN_IMAGE_BASE + image,
  metersPerPixel,
  offset,
  rotation: 0,
  opacity: 0.6,
});

const planFloor = (buildingId: string, f: PlanFloor): Floor => ({
  id: `${buildingId}_${f.key}`,
  name: f.name,
  level: f.level,
  elevation: f.elevation,
  height: f.height,
  ...planStructure(f.image, `${buildingId}_${f.key}`, f.height),
  rooms: [],
  landmarks: [],
  annotations: [],
  furniture: [],
  navGraph: { nodes: [], edges: [] },
  background: background(f.image, f.metersPerPixel, f.offset),
});

interface Courtyard {
  name: string;
  /** Khung sân trong (hệ trục toà, m). */
  min: Point;
  max: Point;
}

/**
 * Sân trong (lộ thiên, thấp hơn sàn tầng 1) của từng toà, đo trên bản vẽ tầng 1. Thang bộ vẽ trong
 * sân là BẬC TỪ SÂN LÊN TẦNG 1 chứ không phải thang nối tầng.
 */
const COURTYARDS: Record<string, Courtyard[]> = {
  bld_lan_main: [
    { name: 'sân trong 1', min: { x: 31, y: 40 }, max: { x: 66, y: 71 } },
    { name: 'sân trong 2', min: { x: 81.5, y: 40 }, max: { x: 119.5, y: 66 } },
    { name: 'sân trong 3', min: { x: 136, y: 39 }, max: { x: 171, y: 71 } },
  ],
};

/**
 * Thang bộ có tâm nằm trong sân trong → bậc thang ngoài trời (`SitePath` loại `steps`, vẽ từ chân
 * dưới sân lên tới mép sàn). Hướng đi lên: dọc chiều dài vế thang (cạnh 1 → 2 của khung do
 * `features.py` sinh ra), chân bậc ở đầu gần tâm sân hơn.
 */
function courtyardSteps(
  floorId: string,
  connectors: Connector[],
  courtyards: readonly Courtyard[],
): { steps: SitePath[]; rest: Connector[] } {
  const steps: SitePath[] = [];
  const rest: Connector[] = [];
  const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  for (const c of connectors) {
    const [p0, p1, p2, p3] = c.polygon;
    const center = c.polygon.reduce((s, p) => ({ x: s.x + p.x / 4, y: s.y + p.y / 4 }), {
      x: 0,
      y: 0,
    });
    const yard = courtyards.find(
      (y) =>
        center.x >= y.min.x - 1 &&
        center.x <= y.max.x + 1 &&
        center.y >= y.min.y - 1 &&
        center.y <= y.max.y + 1,
    );
    if (c.type !== 'stairs' || c.polygon.length !== 4 || !p0 || !p1 || !p2 || !p3 || !yard) {
      rest.push(c);
      continue;
    }
    // hai đầu vế thang: tâm cạnh 0-1 và tâm cạnh 2-3
    const a = mid(p0, p1);
    const b = mid(p2, p3);
    const hub = mid(yard.min, yard.max);
    const d = (p: Point) => Math.hypot(p.x - hub.x, p.y - hub.y);
    const [foot, top] = d(a) <= d(b) ? [a, b] : [b, a];
    steps.push({
      id: `${floorId}_s${steps.length}`,
      kind: 'steps',
      name: `Bậc từ ${yard.name} lên tầng 1`,
      points: [foot, top],
      width: Math.round(Math.hypot(p1.x - p0.x, p1.y - p0.y) * 100) / 100,
      accessible: false,
      // Bản vẽ không ghi cốt sân: để chênh cao mặc định (= bệ toà trong cảnh 3D) cho đỉnh bậc khớp
      // sàn tầng 1. Sửa trong lớp Sảnh & dốc khi biết cốt thật.
    });
  }
  return { steps, rest };
}

/** Tia từ `p` theo hướng `d` (vector đơn vị) có cắt tường nào trong `max` m. */
function rayHitsWall(p: Point, d: Point, walls: readonly Wall[], max = 80): boolean {
  for (const w of walls) {
    const ex = w.end.x - w.start.x;
    const ey = w.end.y - w.start.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-9) continue;
    const qx = w.start.x - p.x;
    const qy = w.start.y - p.y;
    const t = (qx * ey - qy * ex) / den;
    const u = (qx * d.y - qy * d.x) / den;
    if (t > 0 && t <= max && u >= 0 && u <= 1) return true;
  }
  return false;
}

/** Điểm nằm ngoài toà: có ít nhất một trong bốn hướng đi thẳng ra mà không gặp tường. */
const outdoors = (p: Point, walls: readonly Wall[]) =>
  [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ].some((d) => !rayHitsWall(p, d, walls));

/** Trục dài của đa giác (theo phương sai các đỉnh): hai đầu trên trục và bề rộng ngang trục. */
function longAxis(poly: readonly Point[]): { a: Point; b: Point; width: number } {
  const n = poly.length;
  const c = poly.reduce((s, p) => ({ x: s.x + p.x / n, y: s.y + p.y / n }), { x: 0, y: 0 });
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of poly) {
    sxx += (p.x - c.x) ** 2;
    syy += (p.y - c.y) ** 2;
    sxy += (p.x - c.x) * (p.y - c.y);
  }
  const ang = Math.atan2(2 * sxy, sxx - syy) / 2;
  const u = { x: Math.cos(ang), y: Math.sin(ang) };
  const along = poly.map((p) => (p.x - c.x) * u.x + (p.y - c.y) * u.y);
  const across = poly.map((p) => -(p.x - c.x) * u.y + (p.y - c.y) * u.x);
  const lo = Math.min(...along);
  const hi = Math.max(...along);
  const mid = (Math.min(...across) + Math.max(...across)) / 2;
  const at = (t: number): Point => ({
    x: c.x + u.x * t - u.y * mid,
    y: c.y + u.y * t + u.x * mid,
  });
  return { a: at(lo), b: at(hi), width: Math.max(...across) - Math.min(...across) };
}

/**
 * Thang bộ / dốc ở tầng trệt không nối với tầng nào và nằm ngoài tường bao → bậc tam cấp / mặt dốc
 * ở lối vào (`SitePath` loại `steps` / `slope`); chân ở đầu xa tâm toà hơn.
 */
function entranceSteps(
  ground: Floor,
  floorsOfLink: ReadonlyMap<string, number>,
): { paths: SitePath[]; rest: Connector[] } {
  const paths: SitePath[] = [];
  const rest: Connector[] = [];
  const xs = ground.walls.flatMap((w) => [w.start.x, w.end.x]);
  const ys = ground.walls.flatMap((w) => [w.start.y, w.end.y]);
  const hub = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
  const count = { steps: 0, slope: 0 };
  for (const c of ground.connectors) {
    const lone = (floorsOfLink.get(c.linkId) ?? 1) <= 1;
    const kind = c.type === 'stairs' ? 'steps' : c.type === 'ramp' ? 'slope' : null;
    if (!kind || !lone || c.polygon.length < 3) {
      rest.push(c);
      continue;
    }
    // Vế thang do features.py sinh: cạnh 0-1 là một đầu vế, cạnh 2-3 là đầu kia.
    const [p0, p1, p2, p3] = c.polygon;
    const axis =
      kind === 'steps' && c.polygon.length === 4 && p0 && p1 && p2 && p3
        ? {
            a: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 },
            b: { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 },
            width: Math.hypot(p1.x - p0.x, p1.y - p0.y),
          }
        : longAxis(c.polygon);
    const center = { x: (axis.a.x + axis.b.x) / 2, y: (axis.a.y + axis.b.y) / 2 };
    if (!outdoors(center, ground.walls)) {
      rest.push(c);
      continue;
    }
    const d = (p: Point) => Math.hypot(p.x - hub.x, p.y - hub.y);
    const [foot, top] = d(axis.a) >= d(axis.b) ? [axis.a, axis.b] : [axis.b, axis.a];
    const n = ++count[kind];
    paths.push({
      id: `${ground.id}_e${paths.length}`,
      kind,
      name: kind === 'steps' ? `Bậc tam cấp ${n}` : `Dốc lối vào ${n}`,
      points: [foot, top],
      width: Math.round(axis.width * 100) / 100,
      accessible: kind === 'slope',
    });
  }
  return { paths, rest };
}

/** Số tầng mà mỗi nhóm thang (`linkId`) đi qua. */
function floorsPerLink(floors: readonly Floor[]): Map<string, number> {
  const sets = new Map<string, Set<string>>();
  for (const f of floors) {
    for (const c of f.connectors) sets.set(c.linkId, (sets.get(c.linkId) ?? new Set()).add(f.id));
  }
  return new Map([...sets].map(([k, v]) => [k, v.size]));
}

/**
 * Các toà theo bản vẽ — ảnh nền, tường, vách, cột, cửa, thang, dốc, bậc từ sân trong lên tầng 1
 * (`exterior`); chưa có phòng / đồ thị chỉ đường.
 */
export function createLanPlanBuildings(): Building[] {
  const now = new Date().toISOString();
  return PLAN_BUILDINGS.map((b) => {
    const floors = b.floors.map((f) => planFloor(b.id, f));
    const ground = floors.find((f) => f.level === 0);
    const paths: SitePath[] = [];
    const yards = COURTYARDS[b.id];
    if (ground && yards) {
      const { steps, rest } = courtyardSteps(ground.id, ground.connectors, yards);
      ground.connectors = rest;
      paths.push(...steps);
    }
    linkPlanConnectors(floors);
    const floorsOf = floorsPerLink(floors);
    // Ô có dấu X chỉ có ở một tầng là hộp kỹ thuật, không phải thang máy.
    if (floors.length > 1) {
      for (const f of floors) {
        f.connectors = f.connectors.filter(
          (c) => c.type !== 'elevator' || (floorsOf.get(c.linkId) ?? 1) > 1,
        );
      }
    }
    if (ground) {
      const entrance = entranceSteps(ground, floorsOf);
      ground.connectors = entrance.rest;
      paths.push(...entrance.paths);
    }
    linkPlanConnectors(floors); // đánh số lại sau khi bỏ / chuyển
    const exterior: BuildingExterior | undefined = paths.length ? { areas: [], paths } : undefined;
    return {
      id: b.id,
      name: b.name,
      floors,
      departments: [],
      ...(exterior ? { exterior } : {}),
      version: 1,
      updatedAt: now,
    };
  });
}

/** Toạ độ pixel trên ảnh sơ đồ tổng thể (`OVERVIEW.image`, 4097 × 2434) → m trên mặt bằng tổng thể. */
const site = (x: number, y: number): Point => ({
  x: Math.round(x * OVERVIEW.metersPerPixel * 100) / 100,
  y: Math.round(y * OVERVIEW.metersPerPixel * 100) / 100,
});

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  site(x0, y0),
  site(x1, y0),
  site(x1, y1),
  site(x0, y1),
];

/**
 * Phần ngoài trời theo sơ đồ tổng thể (đo tay trên ảnh, sai số ~0,5 m). Bản vẽ LAN chỉ có các toà,
 * nhà cầu và khu bể nước — chưa có đường xe, bãi xe, cổng, hàng rào.
 * - Nhà cầu (hành lang có mái, đi ở cốt sân) → lối đi bộ có mái che, vẽ từ cửa toà này sang cửa toà kia.
 * - Khu bể nước cạnh khoa Giải phẫu bệnh: bệ công trình + bể + nhà kỹ thuật trên bể.
 */
function lanSitePlan(): SitePlan {
  const covered = (id: string, name: string, width: number, ...pts: Point[]): SitePath => ({
    id: `lan_${id}`,
    kind: 'covered',
    name,
    points: pts,
    width,
  });
  const area = (id: string, kind: SiteArea['kind'], name: string, polygon: Point[]): SiteArea => ({
    id: `lan_${id}`,
    kind,
    name,
    polygon,
  });
  return {
    areas: [
      area('tank_site', 'structure', 'Khu bể nước', [
        site(2661, 105),
        site(2699, 89),
        site(2996, 89),
        site(2996, 641),
        site(2704, 641),
        site(2661, 600),
      ]),
      area('tank', 'water', 'Bể nước', rect(2721, 239, 2971, 530)),
      area('tank_house', 'structure', 'Nhà kỹ thuật bể nước', rect(2719, 105, 2973, 192)),
    ],
    paths: [
      covered('bridge_dd', 'Nhà cầu sang khoa Dinh dưỡng', 3, site(900, 1182), site(900, 620)),
      covered(
        'bridge_cnk',
        'Nhà cầu sang khoa Chống nhiễm khuẩn',
        3,
        site(1973, 1182),
        site(1973, 620),
      ),
      covered(
        'bridge_dd_cnk',
        'Nhà cầu Dinh dưỡng – Chống nhiễm khuẩn',
        2.6,
        site(1069, 602),
        site(1788, 602),
      ),
      covered(
        'bridge_lay',
        'Nhà cầu sang khoa Truyền nhiễm',
        3,
        site(2739, 1296),
        site(3254, 1296),
      ),
    ],
    gates: [],
    pois: [],
  };
}

/** Cơ sở chứa các toà theo bản vẽ, nền là sơ đồ tổng thể. */
export function createLanPlanCampus(): Campus {
  return {
    id: LAN_CAMPUS_ID,
    name: 'Bệnh viện – mặt bằng theo bản vẽ LAN',
    code: 'BV',
    buildings: PLAN_BUILDINGS.map((b) => ({ buildingId: b.id, ...structuredClone(b.placement) })),
    background: background(OVERVIEW.image, OVERVIEW.metersPerPixel),
    site: lanSitePlan(),
    links: [],
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}
