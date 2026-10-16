/** Các lớp vẽ phần ngoài trời của mặt bằng tổng thể (toạ độ mặt bằng, mét). Dùng bên trong <MapStage>. */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Circle, Group, Line, Path, Rect, RegularPolygon, Text } from 'react-konva';
import {
  DEFAULT_LINK_WIDTH,
  boundsOf,
  gateStyleOf,
  isGateOpen,
  pointInPolygon,
  polygonCentroid,
  polylineLength,
  rampCenterline,
  rampWalkLines,
  rampWalkWidth,
  sidewalkWidth,
  isStairLike,
  stepsFor,
  DEFAULT_RAMP_RISE,
  STEP_TREAD,
  siteAprons,
  SITE_RAMP_USES,
  type BBox,
  type Id,
  type Point,
  type SiteArea,
  type SiteAreaKind,
  type SitePath,
  type SitePlan,
  type SitePoiKind,
  type SiteRampUse,
  type SiteVehicleAccess,
} from '@hwn/map-core';
import { aroundMarker, centered, markerBox, placeLabels, type LabelRequest } from '../core/labels';
import { LANDMARK_STYLE } from '../core/landmarks';
import { flattenPoints } from '../core/route';
import { withAlpha, type MapTheme } from '../core/theme';
import { usePx, useViewportScale } from './MapStage';
import { GateGlyph } from './siteGates';
import {
  crosswalks,
  cutPolyline,
  entranceLinks,
  gateShape,
  marksAlong,
  midpointOf,
  roadMarks,
  offsetPolyline,
  parkingBays,
} from './siteGeometry';

export { gateShape } from './siteGeometry';

export const SITE_AREA_STYLE: Record<
  SiteAreaKind,
  { fill: string; stroke: string; label: string }
> = {
  road: { fill: '#9ca3af', stroke: '#6b7280', label: 'Đường' },
  parking: { fill: '#93c5fd', stroke: '#3b82f6', label: 'Bãi ô tô' },
  bike_parking: { fill: '#99f6e4', stroke: '#14b8a6', label: 'Bãi xe máy' },
  plaza: { fill: '#d6d3d1', stroke: '#a8a29e', label: 'Sân / sảnh' },
  dropoff: { fill: '#fde047', stroke: '#eab308', label: 'Đón / trả khách' },
  green: { fill: '#86efac', stroke: '#22c55e', label: 'Cây xanh' },
  water: { fill: '#7dd3fc', stroke: '#0ea5e9', label: 'Mặt nước' },
  restricted: { fill: '#fca5a5', stroke: '#ef4444', label: 'Khu hạn chế' },
  structure: { fill: '#cbd5e1', stroke: '#64748b', label: 'Công trình phụ' },
};

export const SITE_PATH_STYLE: Record<SitePath['kind'], { color: string; label: string }> = {
  vehicle: { color: '#6b7280', label: 'Đường xe' },
  ramp: { color: '#f59e0b', label: 'Dốc lên sảnh' },
  shared: { color: '#a8a29e', label: 'Đường chung (lòng đường + vỉa hè)' },
  pedestrian: { color: '#d9c6a5', label: 'Lối đi bộ' },
  covered: { color: '#f59e0b', label: 'Lối có mái che' },
  fence: { color: '#64748b', label: 'Hàng rào' },
  steps: { color: '#a8916f', label: 'Bậc thang (xe lăn không đi được)' },
  slope: { color: '#d9c6a5', label: 'Dốc xe lăn / dốc đi bộ' },
};

/** Màu mặt đường (lòng đường, bãi xe) và gạch lát lối đi bộ / vỉa hè. */
const ASPHALT = SITE_PATH_STYLE.vehicle.color;
const PAVING = '#d9c6a5';
const PAVING_EDGE = '#a8916f';
const PAVING_JOINT = '#bfa77f';
const CURB = '#e5e7eb';

const icon = (d: string) => d;

const CAR_ICON = icon(
  'M2.5 16v-3.5L5.5 7.5h9.5l3.5 5h3V16zM5 12.5h13.5M5.5 16a2 2 0 0 0 4 0M14.5 16a2 2 0 0 0 4 0',
);
const MOTORBIKE_ICON = icon(
  'M2 16.5a3 3 0 1 0 6 0a3 3 0 1 0-6 0M16 16.5a3 3 0 1 0 6 0a3 3 0 1 0-6 0M5 16.5l4-5h5l5 5M14 11.5l1.5-4H19M8 9h4',
);
/** Biểu tượng xe lăn (lưới 24 × 24). */
const WHEELCHAIR_ICON = icon(
  'M12 3.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M13 7v6h5l2 5.5M13 10h4.5M10 9.5a5.5 5.5 0 1 0 7 8',
);
const WALK_ICON = icon(
  'M11 4.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M12 8l-2 6 3 3v4M10 14l-2 7M12 8l3 3h3M12 8l-3 2-1 3',
);
const GATE_ICON = icon('M5 20V9l7-5 7 5v11M9 20v-6h6v6');

/** Loại xe được đi: màu viền đường + biểu tượng vẽ trên mặt đường. */
export const VEHICLE_ACCESS_STYLE: Record<
  SiteVehicleAccess,
  { color: string; icon: string; label: string }
> = {
  car: { color: '#3b82f6', icon: CAR_ICON, label: 'Đường ô tô' },
  motorbike: { color: '#14b8a6', icon: MOTORBIKE_ICON, label: 'Làn xe máy' },
};

/**
 * Dốc / làn xe theo khu được phục vụ: màu viền + biểu tượng trên huy hiệu, để phân biệt dốc lên
 * sảnh Cấp cứu, Khoa Khám bệnh… ngay trên bản đồ.
 */
export const SITE_RAMP_USE_STYLE: Record<
  SiteRampUse,
  { color: string; icon: string; label: string }
> = {
  emergency: {
    color: '#dc2626',
    icon: icon('M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z'),
    label: 'Cấp cứu',
  },
  outpatient: {
    color: '#2563eb',
    icon: icon('M6 3v5a4 4 0 0 0 8 0V3M10 12v3a4 4 0 0 0 8 0v-2M18 13a2 2 0 1 0 0-4a2 2 0 1 0 0 4'),
    label: 'Khoa Khám bệnh',
  },
  inpatient: {
    color: '#7c3aed',
    icon: icon(
      'M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 12a1.5 1.5 0 1 0 0-3a1.5 1.5 0 1 0 0 3',
    ),
    label: 'Nội trú',
  },
  lobby: { color: '#0d9488', icon: icon('M5 20V9l7-5 7 5v11M9 20v-6h6v6'), label: 'Sảnh chính' },
  service: {
    color: '#475569',
    icon: icon(
      'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4a2 2 0 1 0 0 4M17 19a2 2 0 1 0 0-4a2 2 0 1 0 0 4',
    ),
    label: 'Hậu cần',
  },
};

/** Dốc chưa ghi rõ phục vụ khu nào. */
const RAMP_DEFAULT_STYLE = {
  color: '#d97706',
  icon: icon('M3 18L21 7M3 18h18V7'),
  label: 'Dốc lên sảnh',
};

/** Màu + biểu tượng của dốc / làn xe theo khu phục vụ. */
export const rampStyle = (use: SiteRampUse | undefined) =>
  use ? SITE_RAMP_USE_STYLE[use] : RAMP_DEFAULT_STYLE;

/** Tên hiển thị của dốc: tên đã đặt, hoặc "Dốc <khu>". */
export const rampLabel = (p: Pick<SitePath, 'name' | 'use'>) =>
  p.name || (p.use ? `Dốc ${SITE_RAMP_USE_STYLE[p.use].label}` : RAMP_DEFAULT_STYLE.label);

/** Màu + biểu tượng (đường SVG trong khung 24×24) của điểm ngoài trời. */
export const SITE_POI_STYLE: Record<SitePoiKind, { color: string; icon: string; label: string }> = {
  atm: { ...LANDMARK_STYLE.atm, label: 'ATM' },
  shop: {
    color: '#db2777',
    icon: icon('M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2'),
    label: 'Bán hàng',
  },
  canteen: { ...LANDMARK_STYLE.canteen, label: 'Căng tin' },
  pharmacy: { ...LANDMARK_STYLE.pharmacy, label: 'Nhà thuốc' },
  parking: {
    color: '#2563eb',
    icon: icon('M8 20V4h5a4 4 0 0 1 0 8H8'),
    label: 'Bãi xe',
  },
  bus: {
    color: '#0d9488',
    icon: icon('M5 4h14v12H5zM5 11h14M8 16v3M16 16v3M8 13.5v.01M16 13.5v.01'),
    label: 'Xe buýt',
  },
  taxi: {
    color: '#ca8a04',
    icon: icon('M4 15l2-6h12l2 6v3H4zM4 15h16M7 18v2M17 18v2M10 6h4'),
    label: 'Taxi',
  },
  security: {
    color: '#1e3a8a',
    icon: icon('M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z'),
    label: 'Bảo vệ',
  },
  emergency: {
    color: '#dc2626',
    icon: icon('M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z'),
    label: 'Cấp cứu',
  },
  restroom: { ...LANDMARK_STYLE.restroom, label: 'Nhà vệ sinh' },
  info: { ...LANDMARK_STYLE.info, label: 'Thông tin' },
  bike: {
    color: '#0d9488',
    icon: MOTORBIKE_ICON,
    label: 'Xe đạp / xe máy',
  },
  ev: {
    color: '#059669',
    icon: icon('M13 3L6 13h5l-1 8 7-10h-5z'),
    label: 'Sạc xe điện',
  },
  other: { ...LANDMARK_STYLE.other, label: 'Khác' },
};

export const GATE_COLOR = '#334155';
export const GATE_CLOSED_COLOR = '#b91c1c';

/** Kiểu ô màu trong chú giải. */
export type SiteSwatch = 'line' | 'ramp' | 'paving' | 'covered' | 'shared' | 'fence';

/** Một mục chú giải cho đường (theo loại đường và loại xe). */
export interface SitePathLegendItem {
  key: string;
  label: string;
  color: string;
  swatch: SiteSwatch;
}

const SWATCH: Record<SitePath['kind'], SiteSwatch> = {
  vehicle: 'line',
  ramp: 'ramp',
  shared: 'shared',
  pedestrian: 'paving',
  covered: 'covered',
  fence: 'fence',
  steps: 'paving',
  slope: 'paving',
};

/** Chú giải các loại đường có trên bản đồ: đường chung / ô tô / xe máy, dốc, lối đi bộ, hàng rào… */
export function sitePathLegend(paths: readonly SitePath[]): SitePathLegendItem[] {
  const items = new Map<string, SitePathLegendItem>();
  for (const p of paths) {
    if (p.kind === 'ramp' || (p.kind === 'vehicle' && p.use)) {
      const st = rampStyle(p.use);
      const key = `ramp:${p.use ?? ''}`;
      items.set(key, {
        key,
        label: p.use ? `Dốc & làn xe – ${st.label}` : st.label,
        color: st.color,
        swatch: 'ramp',
      });
      if (p.kind === 'ramp' && p.walkway) {
        items.set('ramp-walk', {
          key: 'ramp-walk',
          label: 'Lối đi bộ trên dốc (xe lăn đi được)',
          color: PAVING,
          swatch: 'paving',
        });
      }
    } else if (p.kind === 'vehicle' && p.vehicles) {
      const st = VEHICLE_ACCESS_STYLE[p.vehicles];
      items.set(p.vehicles, { key: p.vehicles, label: st.label, color: st.color, swatch: 'line' });
    } else if (p.kind === 'vehicle') {
      items.set('vehicle', {
        key: 'vehicle',
        label: 'Đường xe (ô tô + xe máy)',
        color: ASPHALT,
        swatch: 'line',
      });
    } else {
      items.set(p.kind, {
        key: p.kind,
        label: SITE_PATH_STYLE[p.kind].label,
        color: SITE_PATH_STYLE[p.kind].color,
        swatch: SWATCH[p.kind],
      });
    }
  }
  const order = [
    'shared',
    'vehicle',
    'car',
    'motorbike',
    ...SITE_RAMP_USES.map((u) => `ramp:${u}`),
    'ramp:',
    'ramp-walk',
    'covered',
    'pedestrian',
    'slope',
    'steps',
    'fence',
  ];
  return [...items.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

/** Hộp bao của phần ngoài trời. */
export function sitePlanBounds(site: SitePlan | undefined): BBox | null {
  if (!site) return null;
  return boundsOf([
    ...site.areas.flatMap((a) => a.polygon),
    ...site.paths.flatMap((p) => p.points),
    ...site.gates.map((g) => g.position),
    ...site.pois.map((p) => p.position),
  ]);
}

/** Bề rộng hộp bao của khu vực (m) — giới hạn độ dài tên hiển thị bên trong. */
const areaWidth = (polygon: readonly Point[]) => {
  const b = boundsOf(polygon);
  return b ? (b.maxX - b.minX) * 1.15 : 0;
};

/** Bề rộng lòng đường (trừ vỉa hè của đường chung). */
const carriageway = (p: SitePath) => p.width - 2 * sidewalkWidth(p);

/**
 * Màu viền mặt đường: dốc / làn có khu phục vụ theo màu khu đó, đường dành riêng một loại xe theo
 * màu loại xe; null = không viền màu.
 */
const edgeColor = (p: SitePath): string | null =>
  p.kind === 'ramp' || p.use
    ? rampStyle(p.use).color
    : p.vehicles
      ? VEHICLE_ACCESS_STYLE[p.vehicles].color
      : null;

/** Giờ hiện tại, cập nhật mỗi phút (để cổng tự đổi trạng thái mở / đóng). */
function useClock(fixed?: Date): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (fixed) return;
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, [fixed]);
  return fixed ?? now;
}

const isLot = (a: SiteArea) =>
  (a.kind === 'parking' || a.kind === 'bike_parking') && a.polygon.length >= 3;

/** Vạch ngang đều dọc theo dải (gạch lát, khung mái…), dài `length` m, cách nhau `step` m. */
function ticks(points: readonly Point[], step: number, length: number) {
  return marksAlong(points, step).map((m) => {
    const n = { x: -m.dir.y * (length / 2), y: m.dir.x * (length / 2) };
    return [m.p.x - n.x, m.p.y - n.y, m.p.x + n.x, m.p.y + n.y];
  });
}

/** Lưới gạch lát của sân (theo hộp bao, cắt theo đa giác khi vẽ). */
function plazaGrid(polygon: readonly Point[], step: number): number[][] {
  const b = boundsOf(polygon);
  if (!b) return [];
  const out: number[][] = [];
  for (let x = Math.ceil(b.minX / step) * step; x < b.maxX; x += step) {
    out.push([x, b.minY, x, b.maxY]);
  }
  for (let y = Math.ceil(b.minY / step) * step; y < b.maxY; y += step) {
    out.push([b.minX, y, b.maxX, y]);
  }
  return out;
}

/** Cắt nét vẽ theo đa giác (dùng cho `clipFunc` của Group). */
const clipTo =
  (polygon: readonly Point[]) =>
  (ctx: {
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    closePath(): void;
  }) => {
    polygon.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  };

/**
 * Cắt nét vẽ ra ngoài các dải `bands` (vùng `box` nới rộng trừ đi các dải, luật even-odd) — để viền
 * chọn của sân không vắt ngang lòng dốc chạy qua sân.
 */
const clipOutside =
  (box: BBox, bands: readonly (readonly Point[])[]) =>
  (ctx: {
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    closePath(): void;
  }): [CanvasFillRule] => {
    const m = 100;
    clipTo([
      { x: box.minX - m, y: box.minY - m },
      { x: box.maxX + m, y: box.minY - m },
      { x: box.maxX + m, y: box.maxY + m },
      { x: box.minX - m, y: box.maxY + m },
    ])(ctx);
    bands.forEach((b) => clipTo(b)(ctx));
    return ['evenodd'];
  };

/** Viền gạch lát sẫm hai bên dốc (m) — cũng là mép sân chỗ dốc chạy qua. */
const RAMP_RIM = 0.15;
/** Bề rộng lòng dốc (phần trong viền màu khu phục vụ). */
const rampInner = (p: Pick<SitePath, 'width'>) => Math.max(p.width - 0.6, p.width * 0.7);

/** Đa giác bao dải rộng `width` chạy dọc đường gấp khúc. */
function bandPolygon(line: readonly Point[], width: number): Point[] {
  return [...offsetPolyline(line, width / 2), ...offsetPolyline(line, -width / 2).reverse()];
}

/** Dải rộng `width` dọc đường gấp khúc có thể chạm đa giác (so hộp bao). */
function bandTouches(line: readonly Point[], width: number, polygon: readonly Point[]): boolean {
  const a = boundsOf(line);
  const b = boundsOf(polygon);
  if (!a || !b) return false;
  const h = width / 2;
  return (
    a.minX - h <= b.maxX && b.minX <= a.maxX + h && a.minY - h <= b.maxY && b.minY <= a.maxY + h
  );
}

/**
 * Lòng dốc: viền màu khu phục vụ, mặt nhựa phủ nhẹ màu đó, vạch nhám chống trơn cắt ngang khi phóng
 * gần.
 */
function RampBody({
  ramp: p,
  line,
  detail,
}: {
  ramp: SitePath;
  line: readonly Point[];
  detail: boolean;
}) {
  const st = rampStyle(p.use);
  const pts = flattenPoints(line);
  const inner = rampInner(p);
  return (
    <>
      <Line points={pts} stroke={st.color} strokeWidth={p.width} lineJoin="round" />
      <Line points={pts} stroke={ASPHALT} strokeWidth={inner} lineJoin="round" />
      <Line points={pts} stroke={withAlpha(st.color, 0.16)} strokeWidth={inner} lineJoin="round" />
      {detail &&
        ticks(line, 0.5, inner - 0.4).map((t, i) => (
          <Line key={i} points={t} stroke="#f8fafc" strokeWidth={0.05} opacity={0.3} />
        ))}
    </>
  );
}

/** Đường gấp khúc kéo dài thêm `d` m ở đầu (vd. để viền phủ cả mép chân bậc). */
function extendStart(points: readonly Point[], d: number): Point[] {
  const [a, b] = points as [Point, Point];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return [
    { x: a.x - ((b.x - a.x) / len) * d, y: a.y - ((b.y - a.y) / len) * d },
    ...points.slice(1),
  ];
}

/**
 * Mặt bậc thang / dốc đi bộ (đầu → cuối là chiều đi lên): bậc thang có gờ mỗi bậc và bóng đổ đậm
 * dần về chân bậc; mặt dốc có vạch nhám, mũi tên chỉ chiều lên và biểu tượng xe lăn.
 */
function StairFace({ path, detail, icons }: { path: SitePath; detail: boolean; icons: boolean }) {
  const pts = path.points;
  const foot = pts[0]!;
  const top = pts[pts.length - 1]!;
  const len = Math.hypot(top.x - foot.x, top.y - foot.y);
  const straight = pts.length === 2 && len > 1e-6;
  const dir = straight ? { x: (top.x - foot.x) / len, y: (top.y - foot.y) / len } : { x: 1, y: 0 };
  const n = { x: -dir.y, y: dir.x };
  const half = Math.max(0, path.width / 2 - 0.05);
  const at = (d: number, s: number) => ({
    x: foot.x + dir.x * d + n.x * s,
    y: foot.y + dir.y * d + n.y * s,
  });
  const across = (d: number, h = half) => {
    const a = at(d, -h);
    const b = at(d, h);
    return [a.x, a.y, b.x, b.y];
  };
  const rect = (d0: number, d1: number) =>
    flattenPoints([at(d0, -half), at(d1, -half), at(d1, half), at(d0, half)]);
  const fill = (
    <Line
      points={flattenPoints(pts)}
      stroke={PAVING}
      strokeWidth={path.width}
      lineCap="butt"
      lineJoin="round"
    />
  );
  if (path.kind === 'steps') {
    const { count, run } = stepsFor(path.rise ?? DEFAULT_RAMP_RISE);
    const tread = straight ? Math.min(run / count, len / count) : 0;
    return (
      <Group>
        {fill}
        {straight
          ? Array.from({ length: count }, (_, k) => (
              <Fragment key={k}>
                {/* Bậc thấp tối hơn: nhìn ra chiều lên xuống. */}
                <Line
                  points={rect(k * tread, (k + 1) * tread)}
                  closed
                  fill={`rgba(60, 40, 20, ${(0.14 * (count - k)) / count})`}
                />
                <Line points={across(k * tread)} stroke={PAVING_EDGE} strokeWidth={0.06} />
              </Fragment>
            ))
          : ticks(pts, STEP_TREAD, path.width - 0.1).map((t, i) => (
              <Line key={i} points={t} stroke={PAVING_EDGE} strokeWidth={0.06} />
            ))}
      </Group>
    );
  }
  // Mặt dốc: vạch nhám ngang, mũi tên chỉ chiều lên đặt cách nhau ~3 m theo bề ngang.
  const lanes = Math.max(1, Math.round(path.width / 3));
  const a = Math.min(0.6, path.width * 0.25, len * 0.2);
  return (
    <Group>
      {fill}
      <Line
        points={flattenPoints(pts)}
        stroke="#93c5fd"
        strokeWidth={path.width}
        lineCap="butt"
        lineJoin="round"
        opacity={0.18}
      />
      {detail &&
        (straight
          ? Array.from({ length: Math.floor(len / 0.5) }, (_, k) => (
              <Line
                key={k}
                points={across((k + 0.5) * 0.5)}
                stroke={PAVING_JOINT}
                strokeWidth={0.05}
              />
            ))
          : ticks(pts, 0.5, path.width - 0.2).map((t, i) => (
              <Line key={i} points={t} stroke={PAVING_JOINT} strokeWidth={0.05} />
            )))}
      {straight &&
        a > 0.1 &&
        Array.from({ length: lanes }, (_, i) => {
          const s = (i + 0.5) * (path.width / lanes) - path.width / 2;
          const c = at(len * 0.3, s);
          return (
            <Group key={i} x={c.x} y={c.y} rotation={(Math.atan2(dir.y, dir.x) * 180) / Math.PI}>
              <Line
                points={[-a * 0.4, -a, a * 0.4, 0, -a * 0.4, a]}
                stroke="#475569"
                strokeWidth={0.12}
                lineCap="round"
                lineJoin="round"
              />
            </Group>
          );
        })}
      {straight && icons && path.width >= 1.2 && len >= 1.5 && (
        <Path
          data={WHEELCHAIR_ICON}
          x={at(len * 0.62, 0).x - 0.6}
          y={at(len * 0.62, 0).y - 0.6}
          scaleX={1.2 / 24}
          scaleY={1.2 / 24}
          stroke="#1d4ed8"
          strokeWidth={2}
          lineCap="round"
          lineJoin="round"
        />
      )}
    </Group>
  );
}

export interface SiteGroundProps {
  site: SitePlan;
  theme: MapTheme;
  /** Vẽ mờ (đang xem tầng không phải mặt đất). */
  dim?: boolean;
  /** Hiện tên đường, khu vực, điểm (khi đủ gần). Mặc định bật. */
  labels?: boolean;
  selectedId?: Id | null;
  highlightPoiId?: Id | null;
  /** Tâm cửa chính các toà (toạ độ mặt bằng) — lối đi gần nhất được nối vào cửa. */
  entrances?: readonly Point[];
  /** Thời điểm để xét cổng mở / đóng. Bỏ trống = giờ hiện tại (tự cập nhật). */
  now?: Date;
  /** Vùng (vd. các toà nhà) mà nhãn không được đè lên. */
  avoid?: readonly BBox[];
  /**
   * Đường bao các toà nhà (toạ độ mặt bằng) — mặt lát nối quanh sảnh không lát đè lên toà.
   * Nên giữ nguyên tham chiếu giữa các lần vẽ (useMemo) để không phải tính lại.
   */
  obstacles?: readonly (readonly Point[])[];
}

const NO_OBSTACLES: readonly (readonly Point[])[] = [];

const SELECT = '#f97316';
const BADGE = 18;
const RAMP_BADGE = 20;

/**
 * Khu vực, bãi xe, đường xe, đường chung có vỉa hè, dốc, lối đi bộ, hàng rào, cổng và điểm ngoài
 * trời. Vẽ theo lớp: mặt lát lối đi → viền đường → vỉa hè → bãi xe → lòng đường → vạch sơn → mái che
 * → hàng rào, cổng → biểu tượng, nhãn.
 */
export function SiteGround({
  site,
  theme,
  dim = false,
  labels = true,
  selectedId,
  highlightPoiId,
  entrances,
  now,
  avoid,
  obstacles = NO_OBSTACLES,
}: SiteGroundProps) {
  const px = usePx();
  const scale = useViewportScale();
  const time = useClock(now);
  const showLabels = labels && !dim && scale >= 4;
  const detail = scale >= 6;

  const { roads, ramps, walks, fences } = useMemo(
    () => ({
      roads: site.paths.filter((p) => p.kind === 'vehicle' || p.kind === 'shared'),
      ramps: site.paths.filter((p) => p.kind === 'ramp'),
      walks: site.paths.filter((p) => p.kind === 'pedestrian' || p.kind === 'covered'),
      fences: site.paths.filter((p) => p.kind === 'fence'),
    }),
    [site.paths],
  );
  /** Tim dốc đã làm mượt — dốc vẽ theo đường cong trơn, không gãy khúc. */
  const rampLines = useMemo(
    () => ramps.map((r) => ({ ramp: r, line: rampCenterline(r, site.paths) })),
    [ramps, site.paths],
  );
  /** Lối đi bộ đi kèm dốc (người đi bộ, xe lăn lên sảnh cùng dốc, tách làn xe). */
  const rampWalks = useMemo(
    () =>
      ramps.flatMap((r) =>
        rampWalkLines(r, site.paths).map((line, i) => ({
          key: `${r.id}:${i}`,
          ramp: r,
          line,
          width: rampWalkWidth(r),
        })),
      ),
    [ramps, site.paths],
  );
  const shared = roads.filter((p) => p.kind === 'shared');
  const covered = walks.filter((p) => p.kind === 'covered');
  /** Bậc thang, mặt dốc đi bộ (cạnh sảnh). */
  const stairs = site.paths.filter((p) => isStairLike(p) && p.points.length >= 2);
  const plainAreas = site.areas.filter(
    (a) => a.kind !== 'dropoff' && a.kind !== 'plaza' && !isLot(a),
  );
  /** Sân / sảnh: mặt lát cho người đi bộ, phủ lên đầu các lối đi để chỗ nối không lộ. */
  const plazas = site.areas.filter((a) => a.kind === 'plaza' && a.polygon.length >= 3);
  const dropoffs = site.areas.filter((a) => a.kind === 'dropoff' && a.polygon.length >= 3);
  /** Làn xe nằm trọn trên mặt sân / sảnh (xe chạy lên sảnh để đón / trả khách). */
  const plazaLanes = roads.filter(
    (p) =>
      p.kind === 'vehicle' &&
      p.points.length >= 2 &&
      p.points.every((q) => plazas.some((a) => pointInPolygon(q, a.polygon))),
  );
  /**
   * Đường xe cần vẽ lòng đường (bỏ làn chạy trên mặt sảnh — mặt sảnh dùng chung, viền / lòng đường
   * của làn đó lòi ra mép sảnh thành vạch tối).
   */
  const drawnRoads = roads.filter((p) => !plazaLanes.includes(p));
  /** Đường có viền màu (loại xe / khu phục vụ) và đường thường — vẽ đường thường sau cùng. */
  const edgedRoads = drawnRoads.filter((p) => edgeColor(p));
  const plainRoads = drawnRoads.filter((p) => !edgeColor(p));
  /** Mặt lát nối: lấp khoảng hở giữa sảnh và các lối đi để phần đi bộ liền một mặt. */
  const aprons = useMemo(() => siteAprons(site, obstacles), [site, obstacles]);

  const lots = useMemo(
    () =>
      site.areas.filter(isLot).map((a) => ({
        area: a,
        bays: parkingBays(a.polygon, a.kind === 'bike_parking' ? 'motorbike' : 'car'),
      })),
    [site.areas],
  );
  const marks = useMemo(
    () =>
      site.paths
        .filter((p) => (p.kind === 'vehicle' || p.kind === 'shared') && (p.oneWay || p.vehicles))
        .flatMap((p) => roadMarks(p, site.paths).map((m, i) => ({ ...m, path: p, i }))),
    [site.paths],
  );
  const zebras = useMemo(() => crosswalks(site.paths), [site.paths]);
  const gates = useMemo(
    () =>
      site.gates.map((g) => ({ gate: g, shape: gateShape(g, site.paths), style: gateStyleOf(g) })),
    [site.gates, site.paths],
  );
  const fenceLines = useMemo(() => {
    const holes = gates.map((g) => ({
      position: g.gate.position,
      half: g.shape.half + (g.gate.kind === 'pedestrian' ? 0.4 : 0.6),
    }));
    return fences.map((f) => ({ path: f, pieces: cutPolyline(f.points, holes) }));
  }, [fences, gates]);
  const links = useMemo(() => entranceLinks(entrances ?? [], site.paths), [entrances, site.paths]);

  const gateOpen = (g: (typeof gates)[number]) => isGateOpen(g.gate, time);
  const badgeAt = (g: (typeof gates)[number], s = scale) =>
    g.shape.outward
      ? {
          x: g.gate.position.x + (g.shape.outward.x * (BADGE + 4)) / s,
          y: g.gate.position.y + (g.shape.outward.y * (BADGE + 4)) / s,
        }
      : g.gate.position;
  const minute = time.getHours() * 60 + time.getMinutes();

  const placed = useMemo(() => {
    if (!showLabels) return [];
    const at = new Date(time);
    const poiR = (id: Id) => (id === highlightPoiId ? 14 : 11);
    const obstacles = [
      ...(avoid ?? []),
      ...gates.map((g) => markerBox(badgeAt(g), BADGE / 2, scale)),
      ...rampLines.map((r) => markerBox(midpointOf(r.line), RAMP_BADGE / 2, scale)),
      ...site.pois.map((p) => markerBox(p.position, poiR(p.id), scale)),
    ];
    const gateText = (g: (typeof gates)[number]) => {
      const s = g.gate.schedule;
      if (!s) return g.gate.name;
      if (!isGateOpen(g.gate, at)) return `${g.gate.name} · đóng (mở ${s.open})`;
      return scale >= 9 ? `${g.gate.name} · ${s.open}–${s.close}` : g.gate.name;
    };
    const pois = [...site.pois].sort(
      (a, b) => Number(b.id === highlightPoiId) - Number(a.id === highlightPoiId),
    );
    const requests: LabelRequest[] = [
      ...gates.map((g) => ({
        key: `g:${g.gate.id}`,
        text: gateText(g),
        anchor: badgeAt(g),
        candidates: aroundMarker(BADGE / 2),
        fontSize: 11,
        bold: true,
      })),
      ...pois.map((p) => ({
        key: `p:${p.id}`,
        text: p.name,
        anchor: p.position,
        candidates: aroundMarker(poiR(p.id)),
        fontSize: 11,
      })),
      ...site.areas
        .filter((a) => a.name && a.polygon.length >= 3)
        .map((a) => ({
          key: `a:${a.id}`,
          text: a.name!,
          anchor: polygonCentroid(a.polygon),
          candidates: centered(14),
          maxWidth: areaWidth(a.polygon),
          fontSize: 11,
          bold: true,
        })),
      ...(scale >= 6
        ? rampLines.map(({ ramp: r, line }) => ({
            key: `r:${r.id}`,
            text: rampLabel(r),
            anchor: midpointOf(line),
            candidates: aroundMarker(RAMP_BADGE / 2),
            fontSize: 10,
            bold: true,
          }))
        : []),
    ];
    return placeLabels(requests, obstacles, scale);
    // `minute` thay cho `time` để chỉ tính lại khi sang phút mới.
  }, [showLabels, gates, site.pois, site.areas, rampLines, scale, highlightPoiId, minute, avoid]);

  const labelColor = (key: string) => {
    const [type, id] = [key.slice(0, 1), key.slice(2)];
    if (type === 'a') {
      const area = site.areas.find((a) => a.id === id);
      return area ? SITE_AREA_STYLE[area.kind].stroke : theme.roomLabel;
    }
    if (type === 'r') return rampStyle(ramps.find((r) => r.id === id)?.use).color;
    if (type === 'g') {
      const g = gates.find((x) => x.gate.id === id);
      return g && !gateOpen(g) ? '#ef4444' : theme.roomLabel;
    }
    return theme.roomLabel;
  };

  return (
    <Group listening={false} opacity={dim ? 0.35 : 1}>
      {plainAreas.map((a) => {
        const st = SITE_AREA_STYLE[a.kind];
        return (
          <Line
            key={a.id}
            points={flattenPoints(a.polygon)}
            closed
            fill={withAlpha(st.fill, a.kind === 'structure' ? 0.55 : 0.35)}
            stroke={a.id === selectedId ? SELECT : st.stroke}
            strokeWidth={a.id === selectedId ? 2.5 : 1}
            dash={a.kind === 'restricted' ? [px(6), px(4)] : undefined}
            strokeScaleEnabled={false}
          />
        );
      })}

      {/* Lối đi bộ + lối nối vào cửa toà: dải gạch lát có viền (vẽ dưới đường xe). */}
      {links.map((l) => (
        <Line
          key={`le:${l.key}`}
          points={[l.from.x, l.from.y, l.to.x, l.to.y]}
          stroke={PAVING_EDGE}
          strokeWidth={2.7}
        />
      ))}
      {walks.map((p) => (
        <Line
          key={`we:${p.id}`}
          points={flattenPoints(p.points)}
          stroke={p.id === selectedId ? SELECT : PAVING_EDGE}
          strokeWidth={p.width + 0.3}
          lineCap="round"
          lineJoin="round"
        />
      ))}
      {/* Viền bậc thang / mặt dốc đi bộ: hai bên và mép chân (đỉnh nằm dưới sảnh). */}
      {stairs.map((p) => (
        <Line
          key={`te:${p.id}`}
          points={flattenPoints(extendStart(p.points, 0.15))}
          stroke={p.id === selectedId ? SELECT : PAVING_EDGE}
          strokeWidth={p.width + 0.3}
          lineCap="butt"
          lineJoin="round"
        />
      ))}
      {/*
       * Viền sân và mặt lát nối (dày bằng viền lối đi), vẽ dưới mọi mặt lát: phần nằm trong lối đi /
       * sân / mặt lát khác bị phủ lên, chỉ còn lộ ở mép ngoài của cả khối — viền lối đi chạy liền qua
       * góc bo sang mép sân, không có đường kẻ cắt ngang chỗ nối.
       */}
      {plazas.map((a) => (
        <Line
          key={`pe:${a.id}`}
          points={flattenPoints(a.polygon)}
          closed
          stroke={PAVING_EDGE}
          strokeWidth={0.3}
          lineJoin="round"
        />
      ))}
      {aprons.map((a) => (
        <Line
          key={`ae:${a.id}`}
          points={flattenPoints(a.polygon)}
          closed
          stroke={PAVING_EDGE}
          strokeWidth={0.3}
          lineJoin="round"
        />
      ))}
      {links.map((l) => (
        <Line
          key={`ls:${l.key}`}
          points={[l.from.x, l.from.y, l.to.x, l.to.y]}
          stroke={PAVING}
          strokeWidth={2.4}
        />
      ))}
      {walks.map((p) => (
        <Line
          key={`ws:${p.id}`}
          points={flattenPoints(p.points)}
          stroke={PAVING}
          strokeWidth={p.width}
          lineCap="round"
          lineJoin="round"
        />
      ))}
      {detail &&
        walks.map((p) => (
          <Fragment key={`wj:${p.id}`}>
            {ticks(p.points, 0.8, p.width - 0.2).map((t, i) => (
              <Line key={i} points={t} stroke={PAVING_JOINT} strokeWidth={0.06} />
            ))}
          </Fragment>
        ))}
      {stairs.map((p) => (
        <StairFace key={`tf:${p.id}`} path={p} detail={detail} icons={scale >= 5} />
      ))}

      {/*
       * Mặt đường vẽ theo lớp để mọi chỗ nối liền mạch, không lộ mép:
       * viền ngoài → lối đi bộ trên dốc → vỉa hè + bó vỉa đường chung → dốc → bãi xe → đường có
       * viền màu → lòng đường thường (sau cùng, phủ lên chân dốc và đầu các nhánh rẽ nằm trong lòng
       * đường) → vạch giữa. Đầu đường cắt vuông để khớp với mép đường bên ngoài / bãi xe.
       */}
      {drawnRoads.map((p) => (
        <Line
          key={`h:${p.id}`}
          points={flattenPoints(p.points)}
          stroke={p.id === selectedId ? SELECT : theme.labelHalo}
          strokeWidth={p.width + 0.8}
          lineCap="butt"
          lineJoin="round"
        />
      ))}
      {/* Viền dốc: gạch lát sẫm như mép lối đi (không dùng viền nền tối — lộ thành dải đen cạnh sân). */}
      {rampLines.map(({ ramp: p, line }) => (
        <Line
          key={`h:${p.id}`}
          points={flattenPoints(line)}
          stroke={p.id === selectedId ? SELECT : PAVING_EDGE}
          strokeWidth={p.width + RAMP_RIM * 2}
          lineCap="butt"
          lineJoin="round"
        />
      ))}

      {/* Lối đi bộ trên dốc: chân lối khuất dưới vỉa hè, đỉnh lối khuất dưới sảnh. */}
      {rampWalks.map((w) => (
        <Line
          key={`rwe:${w.key}`}
          points={flattenPoints(w.line)}
          stroke={w.ramp.id === selectedId ? SELECT : PAVING_EDGE}
          strokeWidth={w.width + 0.3}
          lineCap="butt"
          lineJoin="round"
        />
      ))}
      {rampWalks.map((w) => (
        <Line
          key={`rws:${w.key}`}
          points={flattenPoints(w.line)}
          stroke={PAVING}
          strokeWidth={w.width}
          lineCap="butt"
          lineJoin="round"
        />
      ))}
      {detail &&
        rampWalks.map((w) => (
          <Fragment key={`rwj:${w.key}`}>
            {ticks(w.line, 0.6, w.width - 0.2).map((t, i) => (
              <Line key={i} points={t} stroke={PAVING_JOINT} strokeWidth={0.06} />
            ))}
          </Fragment>
        ))}

      {shared.map((p) => (
        <Line
          key={`sw:${p.id}`}
          points={flattenPoints(p.points)}
          stroke={PAVING}
          strokeWidth={p.width}
          lineCap="butt"
          lineJoin="round"
        />
      ))}
      {detail &&
        shared.map((p) => {
          const sw = sidewalkWidth(p);
          const off = p.width / 2 - sw / 2;
          return (
            <Fragment key={`sj:${p.id}`}>
              {[off, -off].flatMap((d) =>
                ticks(offsetPolyline(p.points, d), 0.8, sw - 0.2).map((t, i) => (
                  <Line key={`${d}:${i}`} points={t} stroke={PAVING_JOINT} strokeWidth={0.06} />
                )),
              )}
            </Fragment>
          );
        })}
      {/*
       * Mặt lát nối quanh sảnh: phủ lên mép lối đi / vỉa hè / lối đi bộ trên dốc bên cạnh, nằm
       * dưới lòng đường, lòng dốc (mép răng cưa của lưới bị lòng đường che đi).
       */}
      {aprons.map((a) => (
        <Fragment key={a.id}>
          <Line points={flattenPoints(a.polygon)} closed fill={PAVING} />
          {detail && (
            <Group clipFunc={clipTo(a.polygon)}>
              {plazaGrid(a.polygon, 1.2).map((g, i) => (
                <Line key={i} points={g} stroke={PAVING_JOINT} strokeWidth={0.05} />
              ))}
            </Group>
          )}
        </Fragment>
      ))}

      {shared.map((p) => (
        <Line
          key={`cb:${p.id}`}
          points={flattenPoints(p.points)}
          stroke={CURB}
          strokeWidth={carriageway(p) + 0.35}
          lineCap="butt"
          lineJoin="round"
        />
      ))}

      {/*
       * Dốc: vắt qua vỉa hè (lối xe ra vào), viền + phủ nhẹ màu khu phục vụ, vạch nhám chống trơn
       * cắt ngang lòng dốc khi phóng gần. Phần chân dốc nằm trong lòng đường bị lòng đường phủ lên.
       */}
      {rampLines.map(({ ramp: p, line }) => (
        <RampBody key={`rp:${p.id}`} ramp={p} line={line} detail={detail} />
      ))}

      {/* Bãi xe: cùng mặt nhựa với đường để đường dẫn vào liền mạch, kẻ ô đỗ. */}
      {lots.map(({ area, bays }) => (
        <Fragment key={area.id}>
          <Line points={flattenPoints(area.polygon)} closed fill={ASPHALT} />
          <Group clipFunc={clipTo(area.polygon)}>
            {bays.map((b, i) => (
              <Line key={i} points={b} stroke="#f8fafc" strokeWidth={0.12} opacity={0.8} />
            ))}
          </Group>
          <Line
            points={flattenPoints(area.polygon)}
            closed
            stroke={area.id === selectedId ? SELECT : SITE_AREA_STYLE[area.kind].stroke}
            strokeWidth={area.id === selectedId ? 2.5 : 2}
            strokeScaleEnabled={false}
          />
        </Fragment>
      ))}

      {edgedRoads.map((p) => (
        <Line
          key={`e:${p.id}`}
          points={flattenPoints(p.points)}
          stroke={edgeColor(p)!}
          strokeWidth={carriageway(p)}
          lineCap="butt"
          lineJoin="round"
        />
      ))}
      {edgedRoads.map((p) => {
        const w = Math.max(carriageway(p) - 0.6, carriageway(p) * 0.7);
        return (
          <Fragment key={`c:${p.id}`}>
            <Line
              points={flattenPoints(p.points)}
              stroke={ASPHALT}
              strokeWidth={w}
              lineCap="butt"
              lineJoin="round"
            />
            {/* Làn đón trả khách của một khu: cùng màu phủ với dốc để cả vòng liền một màu. */}
            {p.use && (
              <Line
                points={flattenPoints(p.points)}
                stroke={withAlpha(rampStyle(p.use).color, 0.16)}
                strokeWidth={w}
                lineCap="butt"
                lineJoin="round"
              />
            )}
          </Fragment>
        );
      })}
      {plainRoads.map((p) => (
        <Line
          key={`c:${p.id}`}
          points={flattenPoints(p.points)}
          stroke={ASPHALT}
          strokeWidth={carriageway(p)}
          lineCap="butt"
          lineJoin="round"
        />
      ))}
      {roads.map(
        (p) =>
          !p.oneWay &&
          carriageway(p) >= 5 && (
            <Line
              key={`m:${p.id}`}
              points={flattenPoints(p.points)}
              stroke="#f8fafc"
              strokeWidth={0.15}
              dash={[2, 2]}
              opacity={0.8}
            />
          ),
      )}

      {/*
       * Sân / sảnh: mặt lát cho người đi bộ (phủ lên đầu lối đi, đỉnh lối đi bộ trên dốc). Không có
       * viền riêng — viền đã vẽ ở lớp dưới cùng với viền lối đi, nên chỗ sân giáp lối đi / mặt lát
       * nối không lộ đường kẻ. Dốc chạy qua sân thì khoét sân theo mép dốc: vẽ lại viền + lòng dốc
       * trong phạm vi sân, viền chọn của sân ôm theo mép dốc thay vì vắt ngang lòng dốc.
       */}
      {plazas.map((a) => {
        const crossing = rampLines.filter((r) =>
          bandTouches(r.line, r.ramp.width + RAMP_RIM * 2, a.polygon),
        );
        const selected = a.id === selectedId;
        return (
          <Fragment key={a.id}>
            <Line points={flattenPoints(a.polygon)} closed fill={PAVING} />
            {detail && (
              <Group clipFunc={clipTo(a.polygon)}>
                {plazaGrid(a.polygon, 1.2).map((g, i) => (
                  <Line key={i} points={g} stroke={PAVING_JOINT} strokeWidth={0.05} />
                ))}
              </Group>
            )}
            {crossing.length > 0 && (
              <Group clipFunc={clipTo(a.polygon)}>
                {crossing.map(({ ramp: p, line }) => (
                  <Fragment key={p.id}>
                    <Line
                      points={flattenPoints(line)}
                      stroke={p.id === selectedId ? SELECT : PAVING_EDGE}
                      strokeWidth={p.width + RAMP_RIM * 2}
                      lineCap="butt"
                      lineJoin="round"
                    />
                    <RampBody ramp={p} line={line} detail={detail} />
                  </Fragment>
                ))}
              </Group>
            )}
            {selected && (
              <Group
                clipFunc={clipOutside(
                  boundsOf(a.polygon)!,
                  crossing.map((r) => bandPolygon(r.line, r.ramp.width + RAMP_RIM * 2)),
                )}
              >
                <Line
                  points={flattenPoints(a.polygon)}
                  closed
                  stroke={SELECT}
                  strokeWidth={2.5}
                  strokeScaleEnabled={false}
                />
              </Group>
            )}
            {selected && crossing.length > 0 && (
              <Group clipFunc={clipTo(a.polygon)}>
                {crossing.flatMap(({ ramp: p, line }) =>
                  [1, -1].map((side) => (
                    <Line
                      key={`${p.id}:${side}`}
                      points={flattenPoints(offsetPolyline(line, side * (p.width / 2 + RAMP_RIM)))}
                      stroke={SELECT}
                      strokeWidth={2.5}
                      strokeScaleEnabled={false}
                      lineJoin="round"
                    />
                  )),
                )}
              </Group>
            )}
          </Fragment>
        );
      })}
      {/*
       * Mũi tên chiều xe chạy trên dốc (dốc lên: vào sảnh, dốc xuống: ra đường) — vẽ sau sân để
       * không bị mặt sân che cụt.
       */}
      {rampLines.map(({ ramp: p, line }) => {
        const len = polylineLength(line);
        // Đặt ở 3/4 dốc (phía sảnh) để không chồng lên huy hiệu ở giữa dốc.
        const at = len > 3 ? marksAlong(line, len * 1.5)[0] : undefined;
        if (!at) return null;
        const inner = rampInner(p);
        const a = Math.min(1.2, inner * 0.35);
        const flow = p.flow ?? 'up';
        const head = (dir: 1 | -1) => [
          dir * a * 0.35,
          -a * 0.55,
          dir * a,
          0,
          dir * a * 0.35,
          a * 0.55,
        ];
        return (
          <Group key={`ra:${p.id}`} x={at.p.x} y={at.p.y} rotation={at.angle}>
            <Line points={[-a, 0, a, 0]} stroke="#f8fafc" strokeWidth={0.2} lineCap="round" />
            {flow !== 'down' && (
              <Line
                points={head(1)}
                stroke="#f8fafc"
                strokeWidth={0.2}
                lineCap="round"
                lineJoin="round"
              />
            )}
            {flow !== 'up' && (
              <Line
                points={head(-1)}
                stroke="#f8fafc"
                strokeWidth={0.2}
                lineCap="round"
                lineJoin="round"
              />
            )}
          </Group>
        );
      })}

      {/* Thảm trước cửa toà. */}
      {links.map((l) => (
        <Rect
          key={`mat:${l.key}`}
          x={l.to.x}
          y={l.to.y}
          rotation={l.angle}
          offsetX={1.4}
          offsetY={1.7}
          width={1.4}
          height={3.4}
          fill={PAVING_JOINT}
          stroke={PAVING_EDGE}
          strokeWidth={1}
          strokeScaleEnabled={false}
        />
      ))}

      {/* Biểu tượng người đi bộ trên lối đi bộ của dốc. */}
      {scale >= 5 &&
        rampWalks.map((w) => {
          const at = midpointOf(w.line);
          const size = Math.min(w.width * 0.8, 1.4);
          return (
            <Path
              key={`rwi:${w.key}`}
              data={WALK_ICON}
              x={at.x - size / 2}
              y={at.y - size / 2}
              scaleX={size / 24}
              scaleY={size / 24}
              stroke="#6b5a40"
              strokeWidth={2}
              lineCap="round"
              lineJoin="round"
            />
          );
        })}

      {/*
       * Làn xe chạy trên mặt sảnh (sảnh là điểm đón / trả khách): vạch đứt hai mép chỗ xe dừng —
       * mũi tên chiều xe vẽ ở lớp ký hiệu bên dưới.
       */}
      {plazaLanes.map((p) =>
        [p.width / 2, -p.width / 2].map((d) => (
          <Line
            key={`pl:${p.id}:${d}`}
            points={flattenPoints(offsetPolyline(p.points, d))}
            stroke="#475569"
            strokeWidth={0.12}
            dash={[0.8, 0.6]}
            opacity={0.7}
          />
        )),
      )}
      {/* Khu đón / trả khách: kẻ sọc vàng trên mặt đường. */}
      {dropoffs.map((a) => {
        const b = boundsOf(a.polygon)!;
        const stripes: number[][] = [];
        for (let c = b.minX + b.minY; c <= b.maxX + b.maxY; c += 1.2) {
          stripes.push([c - b.minY, b.minY, c - b.maxY, b.maxY]);
        }
        return (
          <Fragment key={a.id}>
            <Group clipFunc={clipTo(a.polygon)}>
              <Line points={flattenPoints(a.polygon)} closed fill={withAlpha('#facc15', 0.18)} />
              {stripes.map((s, i) => (
                <Line key={i} points={s} stroke="#facc15" strokeWidth={0.22} opacity={0.85} />
              ))}
            </Group>
            <Line
              points={flattenPoints(a.polygon)}
              closed
              stroke={a.id === selectedId ? SELECT : '#facc15'}
              strokeWidth={a.id === selectedId ? 2.5 : 1.5}
              strokeScaleEnabled={false}
            />
          </Fragment>
        );
      })}

      {/* Mũi tên một chiều + biểu tượng ô tô / xe máy vẽ trên mặt đường. */}
      {marks.map((m) => {
        const w = carriageway(m.path);
        const both = !!m.path.oneWay && !!m.path.vehicles;
        const shift = both ? Math.min(1.5, w * 0.35) : 0;
        const size = Math.min(w * 0.55, 2.6);
        const access = m.path.vehicles ? VEHICLE_ACCESS_STYLE[m.path.vehicles] : null;
        // Trên mặt sảnh (nền gạch sáng) vẽ ký hiệu màu đậm cho dễ thấy.
        const ink = plazaLanes.includes(m.path) ? '#475569' : '#f8fafc';
        return (
          <Fragment key={`${m.path.id}:${m.i}`}>
            {m.path.oneWay && (
              <RegularPolygon
                x={m.p.x + m.dir.x * shift}
                y={m.p.y + m.dir.y * shift}
                sides={3}
                radius={Math.min(1, w * 0.28)}
                rotation={m.angle + 90}
                fill={ink}
                opacity={0.9}
              />
            )}
            {access && (
              <Path
                data={access.icon}
                x={m.p.x - m.dir.x * shift - size / 2}
                y={m.p.y - m.dir.y * shift - size / 2}
                scaleX={size / 24}
                scaleY={size / 24}
                stroke={ink}
                strokeWidth={2}
                lineCap="round"
                lineJoin="round"
                opacity={0.9}
              />
            )}
          </Fragment>
        );
      })}

      {/* Vạch qua đường cho người đi bộ. */}
      {zebras.map((z) => {
        const bars: number[] = [];
        for (let t = -z.length / 2 + 0.5; t <= z.length / 2 - 0.4; t += 0.9) bars.push(t);
        return (
          <Group key={z.key} x={z.p.x} y={z.p.y} rotation={z.angle}>
            {bars.map((t) => (
              <Rect
                key={t}
                x={t - 0.22}
                y={-z.span / 2}
                width={0.44}
                height={z.span}
                fill="#f8fafc"
                opacity={0.9}
              />
            ))}
          </Group>
        );
      })}

      {/* Mái che: tấm mái mờ, mép mái, khung kèo và cột hai bên. */}
      {links
        .filter((l) => l.covered)
        .map((l) => (
          <Line
            key={`lr:${l.key}`}
            points={[l.from.x, l.from.y, l.to.x, l.to.y]}
            stroke={withAlpha(SITE_PATH_STYLE.covered.color, 0.3)}
            strokeWidth={3.2}
          />
        ))}
      {covered.map((p) => {
        const roof = p.width / 2 + 0.4;
        return (
          <Fragment key={`r:${p.id}`}>
            <Line
              points={flattenPoints(p.points)}
              stroke={withAlpha(SITE_PATH_STYLE.covered.color, 0.3)}
              strokeWidth={roof * 2}
              lineJoin="miter"
            />
            {[roof, -roof].map((d) => (
              <Line
                key={d}
                points={flattenPoints(offsetPolyline(p.points, d))}
                stroke={p.id === selectedId ? SELECT : SITE_PATH_STYLE.covered.color}
                strokeWidth={1.5}
                strokeScaleEnabled={false}
              />
            ))}
            {detail &&
              ticks(p.points, 2.5, roof * 2).map((t, i) => (
                <Line
                  key={`k${i}`}
                  points={t}
                  stroke={SITE_PATH_STYLE.covered.color}
                  strokeWidth={0.08}
                  opacity={0.7}
                />
              ))}
            {detail &&
              [roof - 0.25, -(roof - 0.25)].flatMap((d) =>
                marksAlong(offsetPolyline(p.points, d), 5).map((m, i) => (
                  <Rect
                    key={`c${d}:${i}`}
                    x={m.p.x - 0.2}
                    y={m.p.y - 0.2}
                    width={0.4}
                    height={0.4}
                    fill="#b45309"
                  />
                )),
              )}
          </Fragment>
        );
      })}

      {/* Hàng rào: chừa lối ở chỗ có cổng; trụ rào khi phóng gần. */}
      {fenceLines.map(({ path, pieces }) =>
        pieces.map((piece, i) => (
          <Fragment key={`f:${path.id}:${i}`}>
            <Line
              points={flattenPoints(piece)}
              stroke={path.id === selectedId ? SELECT : '#475569'}
              strokeWidth={Math.max(path.width + 0.15, px(2.5))}
              lineJoin="miter"
            />
            <Line
              points={flattenPoints(piece)}
              stroke="#cbd5e1"
              strokeWidth={Math.max(path.width * 0.4, px(1))}
              dash={[0.25, 0.35]}
              lineJoin="miter"
            />
            {detail &&
              marksAlong(piece, 3).map((m, j) => (
                <Rect
                  key={j}
                  x={m.p.x - 0.25}
                  y={m.p.y - 0.25}
                  width={0.5}
                  height={0.5}
                  fill="#475569"
                />
              ))}
          </Fragment>
        )),
      )}

      {/* Cổng: trụ + cánh theo kiểu và trạng thái mở / đóng; biểu tượng đặt phía ngoài. */}
      {gates.map((g) => {
        const { gate, shape } = g;
        const open = gateOpen(g);
        const color = gate.id === selectedId ? SELECT : open ? GATE_COLOR : GATE_CLOSED_COLOR;
        const badge = badgeAt(g);
        const badgeIcon =
          gate.kind === 'pedestrian'
            ? WALK_ICON
            : shape.access
              ? VEHICLE_ACCESS_STYLE[shape.access].icon
              : gate.kind === 'vehicle'
                ? CAR_ICON
                : GATE_ICON;
        return (
          <Fragment key={gate.id}>
            <GateGlyph
              gate={gate}
              style={g.style}
              shape={shape}
              open={open}
              pillarColor={gate.id === selectedId ? SELECT : GATE_COLOR}
            />
            <Group x={badge.x} y={badge.y}>
              <Rect
                x={-px(BADGE / 2)}
                y={-px(BADGE / 2)}
                width={px(BADGE)}
                height={px(BADGE)}
                cornerRadius={px(4)}
                fill={color}
                stroke="#ffffff"
                strokeWidth={1.5}
                strokeScaleEnabled={false}
              />
              <Path
                data={badgeIcon}
                x={-px(6.5)}
                y={-px(6.5)}
                scaleX={px(13) / 24}
                scaleY={px(13) / 24}
                stroke="#ffffff"
                strokeWidth={2.2}
                strokeScaleEnabled={false}
                lineCap="round"
                lineJoin="round"
              />
            </Group>
          </Fragment>
        );
      })}

      {/* Huy hiệu dốc: màu + biểu tượng khu phục vụ (Cấp cứu, Khoa Khám bệnh…). */}
      {scale >= 2.5 &&
        rampLines.map(({ ramp: p, line }) => {
          const st = rampStyle(p.use);
          const at = midpointOf(line);
          const r = px(RAMP_BADGE / 2);
          return (
            <Group key={`rb:${p.id}`} x={at.x} y={at.y}>
              <Rect
                x={-r}
                y={-r}
                width={r * 2}
                height={r * 2}
                cornerRadius={px(6)}
                fill={st.color}
                stroke={p.id === selectedId ? SELECT : '#ffffff'}
                strokeWidth={p.id === selectedId ? 3 : 2}
                strokeScaleEnabled={false}
              />
              <Path
                data={st.icon}
                x={-r * 0.65}
                y={-r * 0.65}
                scaleX={(r * 1.3) / 24}
                scaleY={(r * 1.3) / 24}
                stroke="#ffffff"
                strokeWidth={2.2}
                strokeScaleEnabled={false}
                lineCap="round"
                lineJoin="round"
              />
            </Group>
          );
        })}

      {site.pois.map((p) => {
        const st = SITE_POI_STYLE[p.kind] ?? SITE_POI_STYLE.other;
        const big = p.id === highlightPoiId;
        const r = px(big ? 14 : 11);
        return (
          <Group key={p.id} x={p.position.x} y={p.position.y}>
            {big && <Circle radius={r * 1.6} fill={withAlpha(st.color, 0.25)} />}
            <Circle
              radius={r}
              fill={st.color}
              stroke={p.id === selectedId ? SELECT : '#ffffff'}
              strokeWidth={p.id === selectedId ? 3 : 2}
              strokeScaleEnabled={false}
            />
            <Path
              data={st.icon}
              x={-r * 0.6}
              y={-r * 0.6}
              scaleX={(r * 1.2) / 24}
              scaleY={(r * 1.2) / 24}
              stroke="#ffffff"
              strokeWidth={2.2}
              strokeScaleEnabled={false}
              lineCap="round"
              lineJoin="round"
            />
          </Group>
        );
      })}

      {placed.map((l) => (
        <Text
          key={l.key}
          text={l.text}
          x={l.x}
          y={l.y}
          width={l.width}
          height={l.height}
          align="center"
          verticalAlign="middle"
          wrap="none"
          fontSize={px(l.key.startsWith('r:') ? 10 : 11)}
          fontStyle={l.key.startsWith('p:') ? 'normal' : 'bold'}
          fill={labelColor(l.key)}
          stroke={theme.labelHalo}
          strokeWidth={px(3)}
          fillAfterStrokeEnabled
        />
      ))}
    </Group>
  );
}

/** Cầu nối giữa các toà (đoạn nối hai cửa). */
export function SiteLinks({
  links,
  theme,
  selectedId,
}: {
  links: readonly {
    id: Id;
    name: string;
    from: Point;
    to: Point;
    covered: boolean;
    /** Bề rộng sàn cầu (m), mặc định `DEFAULT_LINK_WIDTH`. */
    width?: number;
  }[];
  theme: MapTheme;
  selectedId?: Id | null;
}) {
  const px = usePx();
  return (
    <Group listening={false}>
      {links.map((l) => {
        const mid = { x: (l.from.x + l.to.x) / 2, y: (l.from.y + l.to.y) / 2 };
        const w = l.width ?? DEFAULT_LINK_WIDTH;
        return (
          <Fragment key={l.id}>
            <Line
              points={flattenPoints([l.from, l.to])}
              stroke={theme.labelHalo}
              strokeWidth={w + 1}
              lineCap="round"
            />
            <Line
              points={flattenPoints([l.from, l.to])}
              stroke={l.id === selectedId ? '#f97316' : '#8b5cf6'}
              strokeWidth={w}
              lineCap="round"
              dash={l.covered ? undefined : [1, 0.6]}
            />
            <Text
              text={l.name}
              x={mid.x - px(70)}
              y={mid.y - px(20)}
              width={px(140)}
              align="center"
              fontSize={px(11)}
              fontStyle="bold"
              fill="#7c3aed"
              stroke={theme.labelHalo}
              strokeWidth={px(3)}
              fillAfterStrokeEnabled
            />
          </Fragment>
        );
      })}
    </Group>
  );
}
