import {
  add,
  connectorHeading,
  directionOf,
  dot,
  polygonCentroid,
  scale,
  sub,
  type Connector,
  type ConnectorType,
  type ElevatorKind,
  type Point,
} from '@hwn/map-core';

/** Tên loại thang, dùng cho nhãn chuyển tầng (2D & 3D). */
export const CONNECTOR_LABEL: Record<ConnectorType, string> = {
  elevator: 'Thang máy',
  stairs: 'Thang bộ',
  escalator: 'Thang cuốn',
  ramp: 'Dốc',
};

export const ELEVATOR_KINDS: { value: ElevatorKind; label: string }[] = [
  { value: 'passenger', label: 'Thang máy thường' },
  { value: 'priority', label: 'Thang máy ưu tiên' },
  { value: 'bed', label: 'Thang máy chở bệnh nhân (giường)' },
  { value: 'service', label: 'Thang máy dịch vụ / chở hàng' },
];

/** Loại thang máy thực tế (mặc định thang thường). */
export const elevatorKindOf = (c: Pick<Connector, 'elevatorKind'>): ElevatorKind =>
  c.elevatorKind ?? 'passenger';

/**
 * Màu riêng cho từng loại thang máy (2D & 3D). `null` = dùng màu thang của theme.
 * Các màu đủ đậm để đọc được trên cả nền sáng lẫn nền tối.
 */
export const ELEVATOR_KIND_COLOR: Record<ElevatorKind, string | null> = {
  passenger: null,
  priority: '#2563eb',
  bed: '#0d9488',
  service: '#d97706',
};

/** Màu viền/ký hiệu của thang (theo loại thang máy). */
export const connectorColor = (
  c: Pick<Connector, 'type' | 'elevatorKind'>,
  themeStroke: string,
): string => (c.type === 'elevator' ? ELEVATOR_KIND_COLOR[elevatorKindOf(c)] : null) ?? themeStroke;

/**
 * Hệ trục của thang theo hướng đi lên: `dir` chạy từ chân thang lên đỉnh, `normal` vuông góc.
 * `tMin..tMax` là phạm vi của thang dọc `dir`, `halfWidth` là nửa bề ngang.
 */
export interface ConnectorFrame {
  center: Point;
  dir: Point;
  normal: Point;
  tMin: number;
  tMax: number;
  halfWidth: number;
}

export function connectorFrame(c: Pick<Connector, 'polygon' | 'heading'>): ConnectorFrame {
  const center = polygonCentroid(c.polygon);
  const dir = directionOf(connectorHeading(c));
  const normal = { x: -dir.y, y: dir.x };
  let tMin = Infinity;
  let tMax = -Infinity;
  let halfWidth = 0;
  for (const p of c.polygon) {
    const rel = sub(p, center);
    const t = dot(rel, dir);
    tMin = Math.min(tMin, t);
    tMax = Math.max(tMax, t);
    halfWidth = Math.max(halfWidth, Math.abs(dot(rel, normal)));
  }
  return { center, dir, normal, tMin, tMax, halfWidth };
}

/** Điểm trong hệ trục thang: `t` dọc hướng đi lên, `s` theo bề ngang. */
export const framePoint = (f: ConnectorFrame, t: number, s: number): Point =>
  add(f.center, add(scale(f.dir, t), scale(f.normal, s)));

/** Hình chữ nhật từ `t0` tới `t1` dọc thang, phủ hết bề ngang. */
export const frameRect = (f: ConnectorFrame, t0: number, t1: number, inset = 0): Point[] => [
  framePoint(f, t0, -f.halfWidth + inset),
  framePoint(f, t1, -f.halfWidth + inset),
  framePoint(f, t1, f.halfWidth - inset),
  framePoint(f, t0, f.halfWidth - inset),
];

/** Các vạch bậc thang (vuông góc với hướng đi lên), cách nhau `step` m. */
export function stepLines(f: ConnectorFrame, step: number): [Point, Point][] {
  const lines: [Point, Point][] = [];
  for (let t = f.tMin + step; t < f.tMax - 1e-6; t += step) {
    lines.push([framePoint(f, t, -f.halfWidth), framePoint(f, t, f.halfWidth)]);
  }
  return lines;
}

/** Mũi tên chỉ hướng đi (đảo chiều nếu `reverse`) dọc tâm thang, chừa `margin` ở hai đầu. */
export function arrowLine(f: ConnectorFrame, reverse = false, margin = 0.4): [Point, Point] {
  const len = f.tMax - f.tMin;
  const m = Math.min(margin, len / 4);
  const a = framePoint(f, f.tMin + m, 0);
  const b = framePoint(f, f.tMax - m, 0);
  return reverse ? [b, a] : [a, b];
}

/** Đa giác mũi tên phẳng (thân + đầu) — dùng cho 3D. */
export function arrowPolygon(f: ConnectorFrame, reverse = false): Point[] {
  const len = f.tMax - f.tMin;
  const m = Math.min(0.35, len / 5);
  const shaft = Math.min(0.18, f.halfWidth * 0.3);
  const head = Math.min(0.55, f.halfWidth * 0.85);
  const headLen = Math.min(1.1, len * 0.35);
  const t0 = f.tMin + m;
  const t1 = f.tMax - m;
  const pts = [
    framePoint(f, t0, -shaft),
    framePoint(f, t1 - headLen, -shaft),
    framePoint(f, t1 - headLen, -head),
    framePoint(f, t1, 0),
    framePoint(f, t1 - headLen, head),
    framePoint(f, t1 - headLen, shaft),
    framePoint(f, t0, shaft),
  ];
  if (!reverse) return pts;
  // Đảo chiều: phản chiếu qua tâm đoạn dọc thang.
  const midT = (t0 + t1) / 2;
  return pts.map((p) => {
    const rel = sub(p, f.center);
    const t = dot(rel, f.dir);
    const s = dot(rel, f.normal);
    return framePoint(f, 2 * midT - t, s);
  });
}

/** Nhãn & chiều mũi tên hiển thị tại tầng này. */
export function connectorArrowInfo(c: Pick<Connector, 'type' | 'direction'>): {
  label: string;
  reverse: boolean;
} | null {
  if (c.type === 'elevator') return null;
  if (c.type === 'escalator' && c.direction === 'down') return { label: 'XUỐNG', reverse: true };
  return { label: 'LÊN', reverse: false };
}
