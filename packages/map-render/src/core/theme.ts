/** Bảng màu dùng chung cho 2D và 3D. Canvas/WebGL không đọc được CSS variables nên phải truyền giá trị cụ thể. */
export interface MapTheme {
  background: string;
  floor: string;
  wall: string;
  window: string;
  door: string;
  entrance: string;
  roomFill: string;
  roomStroke: string;
  roomLabel: string;
  roomHighlight: string;
  connectorFill: string;
  connectorStroke: string;
  navEdge: string;
  navNode: string;
  route: string;
  routeCasing: string;
  location: string;
  destination: string;
  labelHalo: string;
  /** Tường trong chế độ 3D. */
  wall3d: string;
  glass: string;
}

export const lightMapTheme: MapTheme = {
  background: '#f8fafc',
  floor: '#ffffff',
  wall: '#334155',
  window: '#7dd3fc',
  door: '#94a3b8',
  entrance: '#16a34a',
  roomFill: '#e2e8f0',
  roomStroke: '#cbd5e1',
  roomLabel: '#0f172a',
  roomHighlight: '#f97316',
  connectorFill: '#ede9fe',
  connectorStroke: '#7c3aed',
  navEdge: '#a855f7',
  navNode: '#7e22ce',
  route: '#0f766e',
  routeCasing: '#ffffff',
  location: '#2563eb',
  destination: '#dc2626',
  labelHalo: '#ffffff',
  wall3d: '#e2e8f0',
  glass: '#7dd3fc',
};

export const darkMapTheme: MapTheme = {
  background: '#0b1120',
  floor: '#111827',
  wall: '#cbd5e1',
  window: '#38bdf8',
  door: '#64748b',
  entrance: '#4ade80',
  roomFill: '#1e293b',
  roomStroke: '#334155',
  roomLabel: '#e2e8f0',
  roomHighlight: '#fb923c',
  connectorFill: '#2e1065',
  connectorStroke: '#a78bfa',
  navEdge: '#c084fc',
  navNode: '#e9d5ff',
  route: '#2dd4bf',
  routeCasing: '#042f2e',
  location: '#60a5fa',
  destination: '#f87171',
  labelHalo: '#0b1120',
  wall3d: '#475569',
  glass: '#38bdf8',
};

/** Thêm độ trong suốt vào màu hex `#rrggbb`. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
