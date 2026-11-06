import { palette } from '@hwn/theme';

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
  /**
   * Màu nét của ảnh mặt bằng làm nền (bản vẽ scan / PDF): giấy trắng thành trong suốt, nét đen tô
   * màu này — nhạt, khác màu tường để phân biệt phần đã vẽ với bản vẽ gốc.
   */
  planInk: string;
}

export const lightMapTheme: MapTheme = {
  background: palette.gray50,
  floor: palette.white,
  wall: palette.gray700,
  window: '#7dd3fc',
  door: palette.gray400,
  entrance: palette.primary,
  roomFill: palette.gray200,
  roomStroke: palette.gray300,
  roomLabel: palette.gray900,
  roomHighlight: palette.accent,
  connectorFill: '#ede9fe',
  connectorStroke: palette.purpleSolid,
  navEdge: '#a855f7',
  navNode: '#7e22ce',
  route: palette.primary,
  routeCasing: palette.white,
  location: palette.blueSolid,
  destination: palette.error,
  labelHalo: palette.white,
  wall3d: palette.gray200,
  glass: '#7dd3fc',
  planInk: '#c2410c',
};

export const darkMapTheme: MapTheme = {
  background: palette.gray900,
  floor: palette.gray800,
  wall: palette.gray300,
  window: '#38bdf8',
  door: palette.gray500,
  entrance: palette.primaryLight,
  roomFill: palette.gray700,
  roomStroke: palette.gray600,
  roomLabel: palette.gray100,
  roomHighlight: palette.accentLight,
  connectorFill: '#2e1065',
  connectorStroke: '#a78bfa',
  navEdge: '#c084fc',
  navNode: '#e9d5ff',
  route: palette.primaryLight,
  routeCasing: palette.gray900,
  location: palette.secondary,
  destination: palette.error,
  labelHalo: palette.gray900,
  wall3d: palette.gray600,
  glass: '#38bdf8',
  planInk: '#60a5fa',
};

/** Thêm độ trong suốt vào màu hex `#rrggbb`. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
