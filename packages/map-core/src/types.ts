/**
 * Mô hình dữ liệu bản đồ trong nhà HWN — hợp đồng dữ liệu chung giữa server, app người dùng và app admin.
 *
 * Quy ước toạ độ:
 * - Đơn vị: mét.
 * - Mỗi tầng có hệ trục 2D riêng: x hướng sang phải, y hướng xuống dưới (giống canvas).
 * - Khi dựng 3D: x -> X, y -> Z, cao độ tầng (`Floor.elevation`) -> Y.
 */

import type { BuildingExterior } from './campus';

export type Id = string;

export interface Point {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ */
/* Kết cấu                                                             */
/* ------------------------------------------------------------------ */

/**
 * Loại tường:
 * - `brick`: tường gạch · `concrete`: tường bê tông chịu lực · `partition`: vách ngăn nhẹ (thạch cao)
 * - `glass`: vách kính · `railing`: lan can / tường lửng (thấp, nhìn qua được)
 */
export type WallKind = 'brick' | 'concrete' | 'partition' | 'glass' | 'railing';

export interface Wall {
  id: Id;
  start: Point;
  end: Point;
  /** Độ dày (m). */
  thickness: number;
  /** Chiều cao (m). */
  height: number;
  /** Loại tường. Mặc định: `brick`. */
  kind?: WallKind;
}

export type OpeningType = 'door' | 'window' | 'entrance';

/**
 * Kiểu cánh cửa (cho cửa đi & cửa chính):
 * - `single`: 1 cánh mở quay · `double`: 2 cánh mở quay · `sliding`: cửa lùa 1 cánh
 * - `automatic`: cửa tự động trượt 2 cánh · `opening`: lối đi không cánh
 */
export type DoorStyle = 'single' | 'double' | 'sliding' | 'automatic' | 'opening';

/** Cửa đi / cửa sổ / cửa ra vào — luôn gắn vào một bức tường. */
export interface Opening {
  id: Id;
  type: OpeningType;
  wallId: Id;
  /** Khoảng cách (m) từ `wall.start` tới TÂM ô cửa, dọc theo tường. */
  offset: number;
  /** Độ rộng ô cửa (m). */
  width: number;
  /** Chiều cao ô cửa (m). */
  height: number;
  /** Độ cao bậu cửa so với sàn (m) — 0 với cửa đi. */
  sillHeight: number;
  /** Kiểu cánh (cửa đi/cửa chính). Mặc định: `single` cho cửa đi, `double` cho cửa chính. */
  style?: DoorStyle;
  /** Bản lề (hoặc phía cánh lùa) ở đầu `end` của ô cửa thay vì đầu `start`. */
  hingeAtEnd?: boolean;
  /**
   * Cánh mở sang phía bên kia tường. Mặc định cánh mở về phía pháp tuyến trái của tường
   * (vector (-dy, dx) với d = end - start).
   */
  opensOtherSide?: boolean;
}

export type ConnectorType = 'elevator' | 'stairs' | 'escalator';

export type ConnectorDirection = 'up' | 'down' | 'both';

/**
 * Loại thang máy:
 * - `passenger`: thang máy thường (khách) · `priority`: ưu tiên (người già, khuyết tật, phụ nữ mang thai)
 * - `bed`: thang chở giường bệnh / cáng · `service`: thang dịch vụ, chở hàng (nhân viên)
 */
export type ElevatorKind = 'passenger' | 'priority' | 'bed' | 'service';

/**
 * Phương tiện di chuyển giữa các tầng (thang máy, thang bộ, thang cuốn).
 * Mỗi tầng lưu một bản ghi riêng; các bản ghi có cùng `linkId` (trên các tầng khác nhau)
 * được coi là nối thông với nhau.
 */
export interface Connector {
  id: Id;
  type: ConnectorType;
  name: string;
  /** Đa giác chiếm chỗ trên mặt bằng. */
  polygon: Point[];
  linkId: Id;
  /** Chiều di chuyển rời khỏi tầng này — chủ yếu dùng cho thang cuốn. */
  direction: ConnectorDirection;
  /**
   * Hướng đi LÊN của thang bộ/thang cuốn trên mặt bằng (độ; 0 = trục +x, 90 = trục +y, theo
   * chiều kim đồng hồ vì trục y hướng xuống). Bỏ trống = dọc theo cạnh dài, về phía x/y tăng.
   */
  heading?: number;
  /** Loại thang máy (chỉ với `type: 'elevator'`). Mặc định: `passenger`. */
  elevatorKind?: ElevatorKind;
}

/* ------------------------------------------------------------------ */
/* Khoa phòng                                                          */
/* ------------------------------------------------------------------ */

export interface Department {
  id: Id;
  name: string;
  code: string;
  /** Màu hiển thị dạng hex, ví dụ `#3b82f6`. */
  color: string;
  description?: string;
}

export interface Room {
  id: Id;
  name: string;
  /** Mã phòng hiển thị cho người dùng, ví dụ `P.101`. */
  code: string;
  polygon: Point[];
  /** Khoa quản lý phòng (null nếu là khu vực chung). */
  departmentId: Id | null;
  /** Từ khoá phụ để tìm kiếm, ví dụ "siêu âm", "lấy máu". */
  tags: string[];
  /**
   * Điểm đích đến bên trong phòng (vd. quầy tiếp đón, bàn khám) — tuyến chỉ đường kết thúc tại
   * đây. Bỏ trống = một điểm gần tâm phòng.
   */
  destination?: Point;
}

/* ------------------------------------------------------------------ */
/* Mốc                                                                 */
/* ------------------------------------------------------------------ */

export type LandmarkKind =
  | 'info'
  | 'kiosk'
  | 'cashier'
  | 'pharmacy'
  | 'restroom'
  | 'atm'
  | 'water'
  | 'waiting'
  | 'canteen'
  | 'other';

/**
 * Mốc độc lập trên mặt bằng, không gắn với phòng: quầy thông tin, máy lấy số, ATM, nhà vệ sinh,
 * ghế chờ… Người dùng tìm kiếm và được chỉ đường tới mốc như tới phòng.
 */
export interface Landmark {
  id: Id;
  name: string;
  kind: LandmarkKind;
  position: Point;
  /** Từ khoá phụ để tìm kiếm. */
  tags: string[];
  description?: string;
}

/* ------------------------------------------------------------------ */
/* Ghi chú bản vẽ                                                      */
/* ------------------------------------------------------------------ */

/**
 * Đường ghi kích thước giữa hai điểm. Đường kích thước song song với đoạn `start`-`end`, dời đi
 * `offset` (m) theo pháp tuyến trái của đoạn (vector (-dy, dx) với d = end - start).
 */
export interface DimensionAnnotation {
  id: Id;
  kind: 'dimension';
  start: Point;
  end: Point;
  offset: number;
}

/** Chú thích chữ tự do; `position` là tâm khối chữ. */
export interface TextAnnotation {
  id: Id;
  kind: 'text';
  position: Point;
  /** Nội dung (có thể nhiều dòng). */
  text: string;
  /** Chiều cao chữ (m) — chữ to / nhỏ theo bản vẽ khi phóng to thu nhỏ. */
  size: number;
  /** Góc xoay (độ, theo chiều kim đồng hồ). Bỏ trống = 0. */
  rotation?: number;
}

/** Ghi chú trên bản vẽ — chỉ editor dùng, không ảnh hưởng chỉ đường hay app người dùng. */
export type Annotation = DimensionAnnotation | TextAnnotation;

/* ------------------------------------------------------------------ */
/* Nội thất & thiết bị                                                 */
/* ------------------------------------------------------------------ */

export type FurnitureKind =
  | 'bed'
  | 'icuBed'
  | 'crib'
  | 'stretcher'
  | 'examTable'
  | 'chair'
  | 'chairRow'
  | 'desk'
  | 'counter'
  | 'cabinet'
  | 'dentalChair'
  | 'ultrasound'
  | 'xray'
  | 'ct'
  | 'ivPole'
  | 'sink'
  | 'toilet';

/**
 * Ký hiệu nội thất / thiết bị đặt trên mặt bằng: hình chữ nhật `width` × `depth` (m) có tâm ở
 * `position`. Mặt "lưng" (đầu giường, lưng ghế…) ở cạnh trên khi chưa xoay (phía -y).
 */
export interface Furniture {
  id: Id;
  kind: FurnitureKind;
  position: Point;
  width: number;
  depth: number;
  /** Góc xoay (độ, theo chiều kim đồng hồ). Bỏ trống = 0. */
  rotation?: number;
}

/* ------------------------------------------------------------------ */
/* Đồ thị đi lại (dùng để tìm đường)                                   */
/* ------------------------------------------------------------------ */

export type NavNodeKind = 'corridor' | 'door' | 'room' | 'connector' | 'entrance';

export interface NavNode {
  id: Id;
  kind: NavNodeKind;
  position: Point;
  /**
   * Đối tượng mà nút đại diện:
   * - `room` -> Room.id, `connector` -> Connector.id, `door`/`entrance` -> Opening.id.
   */
  refId?: Id;
}

export interface NavEdge {
  id: Id;
  from: Id;
  to: Id;
  /** Chi phí tuỳ chỉnh; mặc định = khoảng cách Euclid giữa hai nút. */
  weight?: number;
  /** false nếu không phù hợp cho xe lăn / cáng. Mặc định true. */
  accessible?: boolean;
}

export interface NavGraph {
  nodes: NavNode[];
  edges: NavEdge[];
}

/* ------------------------------------------------------------------ */
/* Tầng & toà nhà                                                      */
/* ------------------------------------------------------------------ */

/** Ảnh mặt bằng làm nền để vẽ đè trong editor. */
export interface FloorBackground {
  url: string;
  /** Số mét trên mỗi pixel của ảnh. */
  metersPerPixel: number;
  offset: Point;
  /** Góc xoay (độ). */
  rotation: number;
  opacity: number;
}

export interface Floor {
  id: Id;
  name: string;
  /** Số thứ tự tầng (0 = trệt, -1 = hầm 1, ...). Duy nhất trong toà nhà. */
  level: number;
  /** Cao độ sàn (m) so với mặt đất. */
  elevation: number;
  /** Chiều cao tầng (m). */
  height: number;
  walls: Wall[];
  openings: Opening[];
  connectors: Connector[];
  rooms: Room[];
  /** Mốc độc lập trên tầng (dữ liệu cũ có thể không có). */
  landmarks?: Landmark[];
  /** Đường ghi kích thước, chú thích chữ (dữ liệu cũ có thể không có). */
  annotations?: Annotation[];
  /** Nội thất, thiết bị (giường, ghế chờ, máy chụp…) — dữ liệu cũ có thể không có. */
  furniture?: Furniture[];
  navGraph: NavGraph;
  background?: FloorBackground;
}

export interface Building {
  id: Id;
  name: string;
  address?: string;
  floors: Floor[];
  departments: Department[];
  /**
   * Phần ngoài trời của toà (sảnh, làn đón trả khách, dốc lên sảnh…) theo hệ trục của toà, ở cao độ
   * mặt đất — xem `BuildingExterior`. Dữ liệu cũ có thể không có.
   */
  exterior?: BuildingExterior;
  /**
   * Hướng Bắc trên mặt bằng: góc (độ) lệch so với phía TRÊN bản vẽ, theo chiều kim đồng hồ.
   * 0 = Bắc hướng lên trên, 90 = Bắc hướng sang phải. Bỏ trống = 0. Dùng để xoay bản đồ theo la bàn.
   */
  northAngle?: number;
  /** Tăng mỗi lần lưu — dùng để phát hiện xung đột khi nhiều người cùng sửa. */
  version: number;
  updatedAt: string;
}

export interface BuildingSummary {
  id: Id;
  name: string;
  address?: string;
  /** Cơ sở chứa toà (không có nếu toà chưa được gán vào cơ sở nào). */
  campusId?: Id;
  floorCount: number;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Định vị & chỉ đường                                                 */
/* ------------------------------------------------------------------ */

export interface Location {
  floorId: Id;
  position: Point;
}

export interface LocalizeResult extends Location {
  buildingId: Id;
  /** Hướng nhìn của camera (độ, 0 = trục +x, theo chiều kim đồng hồ). */
  heading?: number;
  /** Độ tin cậy 0..1. */
  confidence: number;
}

export interface RouteSegment {
  floorId: Id;
  /** Các điểm của đường đi trên tầng này, theo thứ tự. */
  path: Point[];
  /** Có mặt nếu đoạn này kết thúc bằng việc chuyển tầng. */
  transition?: {
    connectorId: Id;
    connectorType: ConnectorType;
    toFloorId: Id;
  };
}

export type RouteInstructionType =
  | 'start'
  | 'straight'
  | 'turn-left'
  | 'turn-right'
  | 'take-elevator'
  | 'take-stairs'
  | 'take-escalator'
  | 'enter-room'
  | 'arrive';

export interface RouteInstruction {
  type: RouteInstructionType;
  text: string;
  floorId: Id;
  /** Quãng đường (m) của bước này. */
  distance: number;
}

export interface Route {
  buildingId: Id;
  from: Location;
  to: Location & { roomId?: Id; landmarkId?: Id };
  /** Tổng quãng đường (m). */
  distance: number;
  /** Thời gian ước tính (giây). */
  estimatedSeconds: number;
  segments: RouteSegment[];
  instructions: RouteInstruction[];
  /** Cửa đi vào phòng đích (khi điểm đến là phòng hoặc mốc nằm trong phòng). */
  entry?: RouteEntry;
}

export interface RouteEntry {
  floorId: Id;
  position: Point;
  /** Opening.id của cửa. */
  openingId?: Id;
  roomId: Id;
  /** Nhãn ngắn, vd. "Cửa P.206". */
  label: string;
}

/* ------------------------------------------------------------------ */
/* Lưu lượng                                                           */
/* ------------------------------------------------------------------ */

export interface EdgeTraffic {
  floorId: Id;
  edgeId: Id;
  /** Số người đang di chuyển trên cạnh này. */
  count: number;
}

export interface TrafficSnapshot {
  buildingId: Id;
  timestamp: string;
  totalActive: number;
  edges: EdgeTraffic[];
}
