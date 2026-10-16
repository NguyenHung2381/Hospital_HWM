/** Danh sách lựa chọn loại đối tượng ngoài trời (cho ô chọn trong editor). */
import type {
  BuildingLink,
  LobbyEdgeKind,
  LobbyRampShape,
  LobbySide,
  SiteAreaKind,
  SiteGateKind,
  SiteGateStyle,
  SitePathKind,
  SitePoiKind,
  SiteRampUse,
  SiteVehicleAccess,
} from '@hwn/map-core';
import { EXTERIOR_AREA_KINDS, EXTERIOR_PATH_KINDS, SITE_RAMP_USES } from '@hwn/map-core';
import {
  SITE_AREA_STYLE,
  SITE_PATH_STYLE,
  SITE_POI_STYLE,
  SITE_RAMP_USE_STYLE,
} from '@hwn/map-render';

export const AREA_KINDS = (Object.keys(SITE_AREA_STYLE) as SiteAreaKind[]).map((value) => ({
  value,
  label: SITE_AREA_STYLE[value].label,
}));
export const PATH_KINDS = (Object.keys(SITE_PATH_STYLE) as SitePathKind[]).map((value) => ({
  value,
  label: SITE_PATH_STYLE[value].label,
}));
export const POI_KINDS = (Object.keys(SITE_POI_STYLE) as SitePoiKind[]).map((value) => ({
  value,
  label: SITE_POI_STYLE[value].label,
}));
export const GATE_KINDS: { value: SiteGateKind; label: string }[] = [
  { value: 'both', label: 'Xe + người đi bộ' },
  { value: 'vehicle', label: 'Chỉ xe' },
  { value: 'pedestrian', label: 'Chỉ người đi bộ' },
];
export const GATE_STYLES: { value: SiteGateStyle; label: string }[] = [
  { value: 'barrier', label: 'Thanh chắn (barie)' },
  { value: 'double', label: 'Cổng 2 cánh' },
  { value: 'sliding', label: 'Cổng kéo / cửa xếp' },
  { value: 'open', label: 'Lối mở (không cánh)' },
];
export const VEHICLE_KINDS: { value: SiteVehicleAccess | 'all'; label: string }[] = [
  { value: 'all', label: 'Ô tô + xe máy' },
  { value: 'car', label: 'Chỉ ô tô' },
  { value: 'motorbike', label: 'Chỉ xe máy' },
];
/** Dốc / làn xe phục vụ khu nào (Cấp cứu, Khoa Khám bệnh…). */
export const RAMP_USES: { value: SiteRampUse | 'none'; label: string }[] = [
  { value: 'none', label: 'Dùng chung (không ghi rõ)' },
  ...SITE_RAMP_USES.map((value) => ({ value, label: SITE_RAMP_USE_STYLE[value].label })),
];

/** Lối đi bộ đi kèm dốc (theo chiều đi lên dốc, nhìn trên bản đồ). */
export const RAMP_WALK_SIDES: { value: 'left' | 'right' | 'both' | 'none'; label: string }[] = [
  { value: 'none', label: 'Không — dốc chỉ cho xe' },
  { value: 'right', label: 'Bên phải (theo chiều đi lên)' },
  { value: 'left', label: 'Bên trái (theo chiều đi lên)' },
  { value: 'both', label: 'Hai bên' },
];

/** Chiều xe chạy trên dốc (dốc luôn vẽ từ chân dốc lên sảnh). */
export const RAMP_FLOWS: { value: 'up' | 'down' | 'both'; label: string }[] = [
  { value: 'up', label: 'Lên — từ đường vào sảnh' },
  { value: 'down', label: 'Xuống — từ sảnh ra đường' },
  { value: 'both', label: 'Hai chiều' },
];

export const LINK_KINDS: { value: BuildingLink['kind']; label: string }[] = [
  { value: 'bridge', label: 'Cầu nối trên cao' },
  { value: 'corridor', label: 'Hành lang nối' },
  { value: 'tunnel', label: 'Hầm nối' },
];

/** Loại khu vực vẽ được trong phần Sảnh & dốc của toà. */
export const EXTERIOR_AREA_OPTIONS = AREA_KINDS.filter((k) =>
  EXTERIOR_AREA_KINDS.includes(k.value),
).map((k) => (k.value === 'plaza' ? { ...k, label: 'Sảnh (sân lát gạch)' } : k));

/** Loại đường vẽ được trong phần Sảnh & dốc của toà. */
export const EXTERIOR_PATH_OPTIONS = PATH_KINDS.filter((k) =>
  EXTERIOR_PATH_KINDS.includes(k.value),
).map((k) => (k.value === 'vehicle' ? { ...k, label: 'Làn xe (làn đón trả khách)' } : k));

/** Kiểu một cạnh của sảnh. */
export const LOBBY_EDGE_KINDS: { value: LobbyEdgeKind; label: string }[] = [
  { value: 'none', label: 'Không có (thềm đứng)' },
  { value: 'steps', label: 'Bậc thang cả cạnh' },
  { value: 'ramp', label: 'Mặt dốc thoải cả cạnh' },
  { value: 'steps_ramp', label: 'Bậc thang + dốc xe lăn' },
];

/** Dốc xe lăn ở đầu nào của cạnh "bậc + dốc" (nhìn từ trong sảnh ra). */
export const LOBBY_RAMP_AT: { value: 'left' | 'right'; label: string }[] = [
  { value: 'right', label: 'Đầu bên phải' },
  { value: 'left', label: 'Đầu bên trái' },
];

/** Hình dốc ô tô lên làn đón. */
export const LOBBY_RAMP_SHAPES: { value: LobbyRampShape; label: string }[] = [
  { value: 'curve', label: 'Cong chữ S' },
  { value: 'straight', label: 'Thẳng vuông góc ra đường' },
  { value: 'inline', label: 'Thẳng nối dài làn đón (180°)' },
];

/** Tên các cạnh của sảnh (nhìn từ cửa ra). */
export const LOBBY_SIDE_LABEL: Record<LobbySide, string> = {
  front: 'Cạnh trước',
  left: 'Cạnh trái',
  right: 'Cạnh phải',
};
