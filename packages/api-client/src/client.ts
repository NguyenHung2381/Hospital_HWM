import axios, { AxiosError, type AxiosInstance } from 'axios';
import type {
  Building,
  BuildingSummary,
  Campus,
  CampusMapView,
  CampusSummary,
  CampusView,
  Department,
  Floor,
  Id,
  LocalizeResult,
  Route,
} from '@hwn/map-core';
import {
  API_PATHS,
  LOCALIZE_FIELDS,
  type ApiErrorBody,
  type CreateBuildingRequest,
  type CampusRouteRequest,
  type CampusRouteResponse,
  type CreateCampusRequest,
  type DepartmentInput,
  type RoomListItem,
  type RoomSearchParams,
  type RouteRequest,
  type SaveFloorRequest,
  type SaveResult,
  type TrafficHistoryParams,
  type TrafficHistoryPoint,
  type TrafficParams,
  type TrafficResponse,
} from './contract';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseURL: string;
  /** Lấy token đăng nhập (app admin). */
  getToken?: () => string | null | undefined;
  timeoutMs?: number;
}

interface RequestOptions {
  signal?: AbortSignal;
}

function toApiError(error: unknown): ApiError {
  if (error instanceof AxiosError) {
    const body = error.response?.data as Partial<ApiErrorBody> | undefined;
    if (error.response) {
      return new ApiError(
        error.response.status,
        body?.code ?? 'HTTP_ERROR',
        body?.message ?? error.message,
        body?.details,
      );
    }
    if (error.code === AxiosError.ERR_CANCELED) {
      return new ApiError(0, 'CANCELED', 'Yêu cầu đã bị huỷ');
    }
    return new ApiError(0, 'NETWORK_ERROR', 'Không kết nối được tới máy chủ');
  }
  return new ApiError(0, 'UNKNOWN', error instanceof Error ? error.message : String(error));
}

/** Đổi baseURL (có thể là đường dẫn tương đối như "/api") + path thành URL WebSocket tuyệt đối. */
export function toWebSocketUrl(
  baseURL: string,
  path: string,
  origin = globalThis.location?.href,
): string {
  const url = new URL(baseURL.replace(/\/$/, '') + path, origin ?? 'http://localhost');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function createApiClient(options: ApiClientOptions) {
  const http: AxiosInstance = axios.create({
    baseURL: options.baseURL,
    timeout: options.timeoutMs ?? 20_000,
    // Dùng fetch thay cho XHR để mock dự phòng (chặn window.fetch) bắt được request.
    adapter: 'fetch',
  });

  http.interceptors.request.use((config) => {
    const token = options.getToken?.();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });
  http.interceptors.response.use(undefined, (error: unknown) => Promise.reject(toApiError(error)));

  return {
    http,

    campuses: {
      list: (o?: RequestOptions) =>
        http.get<CampusSummary[]>(API_PATHS.campuses, o).then((r) => r.data),
      get: (campusId: Id, o?: RequestOptions) =>
        http.get<CampusView>(API_PATHS.campus(campusId), o).then((r) => r.data),
      /** Bản đồ cơ sở ở tầng chung `level` (bỏ trống = tầng mặt đất). */
      map: (campusId: Id, level?: number, o?: RequestOptions) =>
        http
          .get<CampusMapView>(API_PATHS.campusMap(campusId), {
            params: level === undefined ? {} : { level },
            ...o,
          })
          .then((r) => r.data),
      /** Chỉ đường liên toà. */
      route: (request: CampusRouteRequest, o?: RequestOptions) =>
        http.post<CampusRouteResponse>(API_PATHS.campusRoute, request, o).then((r) => r.data),
      create: (input: CreateCampusRequest) =>
        http.post<Campus>(API_PATHS.campuses, input).then((r) => r.data),
      /** Lưu cơ sở (gửi kèm `version` đang có). */
      save: (campus: Campus) =>
        http.put<SaveResult>(API_PATHS.campus(campus.id), campus).then((r) => r.data),
      remove: (campusId: Id) => http.delete<void>(API_PATHS.campus(campusId)).then(() => undefined),
    },

    /** Danh mục khoa dùng chung cho mọi toà nhà. */
    departmentCatalog: {
      list: (o?: RequestOptions) =>
        http.get<Department[]>(API_PATHS.catalogDepartments, o).then((r) => r.data),
      create: (input: DepartmentInput) =>
        http.post<Department>(API_PATHS.catalogDepartments, input).then((r) => r.data),
      update: (department: Department) =>
        http
          .put<Department>(API_PATHS.catalogDepartment(department.id), department)
          .then((r) => r.data),
      remove: (departmentId: Id) =>
        http.delete<void>(API_PATHS.catalogDepartment(departmentId)).then(() => undefined),
    },

    buildings: {
      list: (o?: RequestOptions) =>
        http.get<BuildingSummary[]>(API_PATHS.buildings, o).then((r) => r.data),
      get: (buildingId: Id, o?: RequestOptions) =>
        http.get<Building>(API_PATHS.building(buildingId), o).then((r) => r.data),
      create: (input: CreateBuildingRequest) =>
        http.post<Building>(API_PATHS.buildings, input).then((r) => r.data),
      remove: (buildingId: Id) =>
        http.delete<void>(API_PATHS.building(buildingId)).then(() => undefined),
      save: (building: Building) =>
        http.put<SaveResult>(API_PATHS.building(building.id), building).then((r) => r.data),
      saveFloor: (buildingId: Id, version: number, floor: Floor) =>
        http
          .put<SaveResult>(API_PATHS.floor(buildingId, floor.id), {
            version,
            floor,
          } satisfies SaveFloorRequest)
          .then((r) => r.data),
    },

    /** @deprecated Dùng `departmentCatalog` — khoa giờ dùng chung toàn viện. */
    departments: {
      list: (buildingId: Id, o?: RequestOptions) =>
        http.get<Department[]>(API_PATHS.departments(buildingId), o).then((r) => r.data),
      create: (buildingId: Id, input: DepartmentInput) =>
        http.post<Department>(API_PATHS.departments(buildingId), input).then((r) => r.data),
      update: (buildingId: Id, department: Department) =>
        http
          .put<Department>(API_PATHS.department(buildingId, department.id), department)
          .then((r) => r.data),
      remove: (buildingId: Id, departmentId: Id) =>
        http.delete<void>(API_PATHS.department(buildingId, departmentId)).then(() => undefined),
    },

    rooms: {
      search: (buildingId: Id, params: RoomSearchParams = {}, o?: RequestOptions) =>
        http.get<RoomListItem[]>(API_PATHS.rooms(buildingId), { params, ...o }).then((r) => r.data),
      /** Tìm trên mọi toà nhà (kết quả có `buildingId`, `buildingName`). */
      searchAll: (params: Pick<RoomSearchParams, 'q'> = {}, o?: RequestOptions) =>
        http.get<RoomListItem[]>(API_PATHS.allRooms, { params, ...o }).then((r) => r.data),
    },

    /** Gửi ảnh chụp để server xác định vị trí người dùng. */
    localize: (image: Blob, params: { buildingId?: Id } = {}, o?: RequestOptions) => {
      const form = new FormData();
      form.append(LOCALIZE_FIELDS.image, image, 'capture.jpg');
      if (params.buildingId) form.append(LOCALIZE_FIELDS.buildingId, params.buildingId);
      return http
        .post<LocalizeResult>(API_PATHS.localize, form, {
          ...o,
          // Để fetch tự đặt "multipart/form-data; boundary=…" (ngoài trình duyệt axios
          // giữ nhầm header mặc định application/x-www-form-urlencoded).
          headers: { 'Content-Type': false },
        })
        .then((r) => r.data);
    },

    route: (request: RouteRequest, o?: RequestOptions) =>
      http.post<Route>(API_PATHS.route, request, o).then((r) => r.data),

    traffic: {
      snapshot: (buildingId: Id, params: TrafficParams = {}, o?: RequestOptions) =>
        http
          .get<TrafficResponse>(API_PATHS.traffic(buildingId), { params, ...o })
          .then((r) => r.data),
      history: (buildingId: Id, params: TrafficHistoryParams = {}, o?: RequestOptions) =>
        http
          .get<TrafficHistoryPoint[]>(API_PATHS.trafficHistory(buildingId), { params, ...o })
          .then((r) => r.data),
      /** URL WebSocket (ws:// hoặc wss://) của kênh lưu lượng, tính từ baseURL. */
      streamUrl: (buildingId: Id) =>
        toWebSocketUrl(options.baseURL, API_PATHS.trafficStream(buildingId)),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
