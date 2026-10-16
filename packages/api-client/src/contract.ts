/**
 * Hợp đồng REST API giữa client và server HWN.
 * Mock server (`@hwn/mock-api`) và server thật đều phải tuân theo file này.
 * Mọi đường dẫn tương đối với base URL (mặc định `/api`).
 */
import type {
  CampusFrom,
  CampusRoute,
  CampusTarget,
  Department,
  Floor,
  GeoPoint,
  Id,
  Location,
  Room,
  Route,
  TrafficSnapshot,
} from '@hwn/map-core';

export const API_PATHS = {
  campuses: '/campuses',
  campus: (campusId: Id) => `/campuses/${campusId}`,
  /** Bản đồ cơ sở ở một tầng chung: `?level=` (mặc định tầng mặt đất) → CampusMapView. */
  campusMap: (campusId: Id) => `/campuses/${campusId}/map`,
  /** POST — chỉ đường liên toà trong một cơ sở. */
  campusRoute: '/campus-route',
  buildings: '/buildings',
  building: (buildingId: Id) => `/buildings/${buildingId}`,
  floor: (buildingId: Id, floorId: Id) => `/buildings/${buildingId}/floors/${floorId}`,
  /** Danh mục khoa dùng chung cho mọi toà nhà. */
  catalogDepartments: '/departments',
  catalogDepartment: (departmentId: Id) => `/departments/${departmentId}`,
  /** @deprecated Khoa giờ dùng chung toàn viện — tương đương `/departments`. */
  departments: (buildingId: Id) => `/buildings/${buildingId}/departments`,
  department: (buildingId: Id, departmentId: Id) =>
    `/buildings/${buildingId}/departments/${departmentId}`,
  rooms: (buildingId: Id) => `/buildings/${buildingId}/rooms`,
  /** Tìm phòng trên mọi toà nhà. */
  allRooms: '/rooms',
  traffic: (buildingId: Id) => `/buildings/${buildingId}/traffic`,
  /** WebSocket: server đẩy `TrafficStreamMessage` định kỳ. */
  trafficStream: (buildingId: Id) => `/buildings/${buildingId}/traffic/stream`,
  trafficHistory: (buildingId: Id) => `/buildings/${buildingId}/traffic/history`,
  localize: '/localize',
  route: '/route',
} as const;

/** Dạng lỗi chuẩn server trả về (kèm HTTP status 4xx/5xx). */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/* --- Bản đồ ------------------------------------------------------- */

/**
 * PUT building/floor: client gửi kèm `version` đang có.
 * Server trả 409 `VERSION_CONFLICT` nếu đã có người khác lưu trước.
 */
export interface SaveFloorRequest {
  version: number;
  floor: Floor;
}

export interface SaveResult {
  version: number;
  updatedAt: string;
}

/**
 * POST /buildings — tạo toà nhà mới (trả về `Building`, version 1) với một tầng trống.
 * Có `campusId` thì toà được đặt luôn vào cơ sở đó (bên phải các toà đã có).
 *
 * Lưu ý: `Building.departments` server luôn trả về = danh mục khoa toàn viện; giá trị client gửi
 * lên khi lưu toà nhà bị bỏ qua (sửa khoa qua `/departments`).
 */
export interface CreateBuildingRequest {
  name: string;
  address?: string;
  campusId?: Id;
}

/* --- Cơ sở -------------------------------------------------------- */

/*
 * GET /campuses → CampusSummary[]
 * GET /campuses/:id → CampusView (cơ sở + thông tin rút gọn từng toà để vẽ mặt bằng tổng thể)
 * PUT /campuses/:id (body: Campus, kèm `version` đang có) → SaveResult; 409 VERSION_CONFLICT.
 *   Toà đang thuộc cơ sở khác được chuyển sang cơ sở này (cơ sở cũ tăng version).
 * DELETE /campuses/:id → 204; 409 CAMPUS_NOT_EMPTY nếu còn toà nhà.
 */
/** POST /campus-route — dùng POST để vị trí người dùng không nằm trên URL. */
export interface CampusRouteRequest {
  campusId: Id;
  from: CampusFrom;
  to: CampusTarget;
  accessibleOnly?: boolean;
  preferCovered?: boolean;
}

/**
 * Tuyến liên toà (theo chặng) + cùng tuyến đó đổi sang toạ độ mặt bằng tổng thể (`floorId` = `L<tầng>`)
 * để vẽ bằng RouteLayer. 422 NO_ROUTE nếu không có đường đi.
 */
export interface CampusRouteResponse {
  route: CampusRoute;
  siteRoute: Route;
}

export interface CreateCampusRequest {
  name: string;
  code?: string;
  address?: string;
  geo?: GeoPoint;
}

/* DELETE /buildings/:id — xoá toà nhà (204). Không xoá được toà nhà cuối cùng (409 LAST_BUILDING). */

/* --- Khoa phòng -------------------------------------------------- */

/**
 * Danh mục khoa toàn viện: GET/POST /departments, PUT/DELETE /departments/:id.
 * DELETE trả 409 DEPARTMENT_IN_USE nếu còn phòng (ở bất kỳ toà nào) thuộc khoa.
 */
export type DepartmentInput = Omit<Department, 'id'>;

export interface RoomListItem {
  room: Room;
  buildingId: Id;
  buildingName: string;
  floorId: Id;
  floorName: string;
  floorLevel: number;
  department: Department | null;
}

/**
 * GET buildings/:id/rooms?q=... hoặc GET /rooms?q=... (mọi toà nhà) — `q` tìm không phân biệt dấu
 * theo tên, mã, tag, tên khoa.
 */
export interface RoomSearchParams {
  q?: string;
  floorId?: Id;
  departmentId?: Id;
}

/* --- Định vị & chỉ đường ----------------------------------------- */

/** POST /localize — multipart/form-data. */
export const LOCALIZE_FIELDS = {
  image: 'image',
  /** Tuỳ chọn: giới hạn tìm kiếm trong một toà nhà. */
  buildingId: 'buildingId',
} as const;

/** POST /route — dùng POST để vị trí người dùng không nằm trên URL. */
export interface RouteRequest {
  buildingId: Id;
  from: Location;
  to: { roomId: Id } | { landmarkId: Id } | Location;
  accessibleOnly?: boolean;
}

/* --- Lưu lượng --------------------------------------------------- */

export interface TrafficParams {
  floorId?: Id;
}

export type TrafficResponse = TrafficSnapshot;

/** Thông điệp trên kênh WebSocket lưu lượng (JSON). */
export type TrafficStreamMessage =
  { type: 'snapshot'; data: TrafficSnapshot } | { type: 'error'; message: string };

export interface TrafficHistoryParams {
  /** Số giờ tính ngược từ hiện tại (mặc định 24). */
  hours?: number;
  /** Độ rộng mỗi khoảng thời gian, phút (mặc định 15). */
  bucketMinutes?: number;
}

export interface TrafficHistoryPoint {
  /** Đầu khoảng thời gian (ISO). */
  timestamp: string;
  /** Số người đang di chuyển trung bình trong khoảng. */
  totalActive: number;
  byFloor: Record<Id, number>;
}
