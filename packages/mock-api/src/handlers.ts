import { delay, http, HttpResponse, ws, type HttpHandler, type WebSocketHandler } from 'msw';
import {
  API_PATHS,
  LOCALIZE_FIELDS,
  type ApiErrorBody,
  type CreateBuildingRequest,
  type CampusRouteRequest,
  type CreateCampusRequest,
  type DepartmentInput,
  type RoomListItem,
  type RouteRequest,
  type SaveFloorRequest,
  type TrafficResponse,
  type TrafficStreamMessage,
} from '@hwn/api-client';
import {
  buildingFootprint,
  campusBuildingInfo,
  campusGroundLevel,
  campusLevels,
  campusRouteToSiteRoute,
  CampusRouteError,
  findCampusRoute,
  floorAtLevel,
  createId,
  findRoute,
  nextPlacementPosition,
  RouteError,
  searchRooms,
  validateBuilding,
  validateCampus,
  type Building,
  type BuildingSummary,
  type Campus,
  type CampusBuildingInfo,
  type CampusMapView,
  type CampusSummary,
  type CampusView,
  type Department,
  type Floor,
  type LocalizeResult,
} from '@hwn/map-core';
import { db } from './db';
import { TrafficSimulator } from './traffic';

const STREAM_INTERVAL_MS = 2000;

/** Mỗi toà nhà một bộ mô phỏng, dùng chung cho REST và WebSocket. */
const simulators = new Map<string, TrafficSimulator>();
function simulatorFor(buildingId: string): TrafficSimulator {
  let sim = simulators.get(buildingId);
  if (!sim) {
    sim = new TrafficSimulator(() => db.getBuilding(buildingId));
    simulators.set(buildingId, sim);
  }
  return sim;
}

const apiError = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json<ApiErrorBody>({ code, message, details }, { status });

const notFound = (what: string) => apiError(404, 'NOT_FOUND', `Không tìm thấy ${what}`);

const versionConflict = (current: Building) =>
  apiError(409, 'VERSION_CONFLICT', 'Bản đồ đã được người khác cập nhật. Hãy tải lại.', {
    currentVersion: current.version,
  });

const summarize = (b: Building): BuildingSummary => ({
  id: b.id,
  name: b.name,
  address: b.address,
  campusId: db.campusOf(b.id)?.id,
  floorCount: b.floors.length,
  updatedAt: b.updatedAt,
});

/** Phòng tìm được → một dòng kết quả của API tìm phòng. */
const toRoomItem = (
  building: Building,
  { floor, room, department }: ReturnType<typeof searchRooms>[number],
): RoomListItem => ({
  room,
  buildingId: building.id,
  buildingName: building.name,
  floorId: floor.id,
  floorName: floor.name,
  floorLevel: floor.level,
  department: department ?? null,
});

const emptyFloor = (): Floor => ({
  id: createId('floor'),
  name: 'Tầng 1',
  level: 1,
  elevation: 0,
  height: 3.6,
  walls: [],
  openings: [],
  connectors: [],
  rooms: [],
  landmarks: [],
  navGraph: { nodes: [], edges: [] },
});

const summarizeCampus = (c: Campus): CampusSummary => ({
  id: c.id,
  name: c.name,
  code: c.code,
  address: c.address,
  geo: c.geo,
  buildingIds: c.buildings.map((pl) => pl.buildingId),
  updatedAt: c.updatedAt,
});

/** Thông tin rút gọn của mọi toà (theo ID) — để kiểm tra và vẽ mặt bằng tổng thể. */
const buildingInfoMap = () =>
  new Map<string, CampusBuildingInfo>(db.listBuildings().map((b) => [b.id, campusBuildingInfo(b)]));

const campusView = (c: Campus): CampusView => {
  const info = buildingInfoMap();
  return {
    ...c,
    buildingInfo: c.buildings.flatMap((pl) => info.get(pl.buildingId) ?? []),
  };
};

/** Phòng (ở mọi toà) đang thuộc khoa `id`. */
const roomsOfDepartment = (id: string) =>
  db
    .listBuildings()
    .flatMap((b) => b.floors.flatMap((f) => f.rooms))
    .filter((r) => r.departmentId === id);

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Tạo danh sách handler MSW.
 * @param baseURL tiền tố API, phải trùng với `baseURL` của api-client (mặc định `/api`).
 */
export function createHandlers(baseURL = '/api'): Array<HttpHandler | WebSocketHandler> {
  const url = (path: string) => `${baseURL}${path}`;
  const P = API_PATHS;
  // WebSocket: khớp mọi host, chỉ theo đường dẫn (baseURL có thể là "/api" hoặc URL đầy đủ).
  const basePath = new URL(baseURL, 'http://localhost').pathname.replace(/\/$/, '');
  const trafficStream = ws.link(`*${basePath}${P.trafficStream(':buildingId')}`);

  return [
    /* --- Toà nhà & tầng ------------------------------------------- */

    http.get(url(P.buildings), async () => {
      await delay();
      return HttpResponse.json(db.listBuildings().map(summarize));
    }),

    http.post(url(P.buildings), async ({ request }) => {
      await delay();
      const body = (await request.json()) as CreateBuildingRequest;
      const name = body.name?.trim();
      if (!name) return apiError(400, 'NAME_REQUIRED', 'Thiếu tên toà nhà');
      const campus = body.campusId ? db.getCampus(body.campusId) : undefined;
      if (body.campusId && !campus) return notFound('cơ sở');
      const building: Building = {
        id: createId('bld'),
        name,
        address: body.address?.trim() || undefined,
        floors: [emptyFloor()],
        departments: db.departments(),
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      db.putBuilding(building);
      if (campus) {
        const footprints = new Map(
          campus.buildings.flatMap((pl) => {
            const b = db.getBuilding(pl.buildingId);
            return b ? [[b.id, buildingFootprint(b)] as const] : [];
          }),
        );
        campus.buildings.push({
          buildingId: building.id,
          position: nextPlacementPosition(campus, footprints),
          rotation: 0,
        });
        db.touchCampus(campus);
      }
      return HttpResponse.json(building, { status: 201 });
    }),

    http.delete(url(P.building(':buildingId')), async ({ params }) => {
      await delay();
      const id = params.buildingId as string;
      if (!db.getBuilding(id)) return notFound('toà nhà');
      if (db.listBuildings().length <= 1) {
        return apiError(409, 'LAST_BUILDING', 'Không thể xoá toà nhà cuối cùng');
      }
      db.removeBuilding(id);
      simulators.delete(id);
      return new HttpResponse(null, { status: 204 });
    }),

    http.get(url(P.building(':buildingId')), async ({ params }) => {
      await delay();
      const building = db.getBuilding(params.buildingId as string);
      return building ? HttpResponse.json(building) : notFound('toà nhà');
    }),

    http.put(url(P.building(':buildingId')), async ({ params, request }) => {
      await delay();
      const current = db.getBuilding(params.buildingId as string);
      if (!current) return notFound('toà nhà');
      // Khoa lấy theo danh mục chung, bỏ qua danh sách client gửi lên.
      const incoming: Building = {
        ...((await request.json()) as Building),
        departments: db.departments(),
      };
      if (incoming.version !== current.version) return versionConflict(current);
      const validation = validateBuilding(incoming);
      if (!validation.valid) {
        return apiError(422, 'INVALID_MAP', 'Dữ liệu bản đồ không hợp lệ', validation.issues);
      }
      const saved: Building = {
        ...incoming,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
      };
      db.putBuilding(saved);
      return HttpResponse.json({ version: saved.version, updatedAt: saved.updatedAt });
    }),

    http.put(url(P.floor(':buildingId', ':floorId')), async ({ params, request }) => {
      await delay();
      const current = db.getBuilding(params.buildingId as string);
      if (!current) return notFound('toà nhà');
      const body = (await request.json()) as SaveFloorRequest;
      if (body.version !== current.version) return versionConflict(current);
      if (body.floor.id !== params.floorId) {
        return apiError(400, 'ID_MISMATCH', 'ID tầng không khớp với đường dẫn');
      }
      const exists = current.floors.some((f) => f.id === body.floor.id);
      const next: Building = {
        ...current,
        floors: exists
          ? current.floors.map((f) => (f.id === body.floor.id ? body.floor : f))
          : [...current.floors, body.floor],
      };
      const validation = validateBuilding(next);
      if (!validation.valid) {
        return apiError(422, 'INVALID_MAP', 'Dữ liệu bản đồ không hợp lệ', validation.issues);
      }
      db.putBuilding(next);
      db.touch(next);
      return HttpResponse.json({ version: next.version, updatedAt: next.updatedAt });
    }),

    /* --- Khoa (danh mục toàn viện) ------------------------------------ */
    // Đường dẫn cũ theo toà nhà (/buildings/:id/departments) dùng chung logic, chỉ kiểm tra thêm toà.

    ...[P.catalogDepartments, P.departments(':buildingId')].map((path) =>
      http.get(url(path), async ({ params }) => {
        await delay();
        if (params.buildingId && !db.getBuilding(params.buildingId as string)) {
          return notFound('toà nhà');
        }
        return HttpResponse.json(db.departments());
      }),
    ),

    ...[P.catalogDepartments, P.departments(':buildingId')].map((path) =>
      http.post(url(path), async ({ params, request }) => {
        await delay();
        if (params.buildingId && !db.getBuilding(params.buildingId as string)) {
          return notFound('toà nhà');
        }
        const input = (await request.json()) as DepartmentInput;
        if (!input.name?.trim()) return apiError(400, 'VALIDATION', 'Tên khoa không được để trống');
        const department: Department = { ...input, name: input.name.trim(), id: createId('dept') };
        db.departments().push(department);
        db.saveDepartments();
        return HttpResponse.json(department, { status: 201 });
      }),
    ),

    ...[P.catalogDepartment(':departmentId'), P.department(':buildingId', ':departmentId')].map(
      (path) =>
        http.put(url(path), async ({ params, request }) => {
          await delay();
          if (params.buildingId && !db.getBuilding(params.buildingId as string)) {
            return notFound('toà nhà');
          }
          const list = db.departments();
          const index = list.findIndex((d) => d.id === params.departmentId);
          if (index < 0) return notFound('khoa');
          const department = {
            ...((await request.json()) as Department),
            id: params.departmentId as string,
          };
          if (!department.name?.trim()) {
            return apiError(400, 'VALIDATION', 'Tên khoa không được để trống');
          }
          list[index] = department;
          db.saveDepartments();
          return HttpResponse.json(department);
        }),
    ),

    ...[P.catalogDepartment(':departmentId'), P.department(':buildingId', ':departmentId')].map(
      (path) =>
        http.delete(url(path), async ({ params }) => {
          await delay();
          if (params.buildingId && !db.getBuilding(params.buildingId as string)) {
            return notFound('toà nhà');
          }
          const id = params.departmentId as string;
          const list = db.departments();
          const index = list.findIndex((d) => d.id === id);
          if (index < 0) return notFound('khoa');
          const inUse = roomsOfDepartment(id);
          if (inUse.length) {
            return apiError(409, 'DEPARTMENT_IN_USE', `Khoa đang quản lý ${inUse.length} phòng`, {
              roomIds: inUse.map((r) => r.id),
            });
          }
          list.splice(index, 1);
          db.saveDepartments();
          return new HttpResponse(null, { status: 204 });
        }),
    ),

    /* --- Cơ sở ------------------------------------------------------- */

    http.get(url(P.campuses), async () => {
      await delay();
      return HttpResponse.json(db.listCampuses().map(summarizeCampus));
    }),

    http.get(url(P.campus(':campusId')), async ({ params }) => {
      await delay();
      const campus = db.getCampus(params.campusId as string);
      return campus ? HttpResponse.json(campusView(campus)) : notFound('cơ sở');
    }),

    http.get(url(P.campusMap(':campusId')), async ({ params, request }) => {
      await delay();
      const campus = db.getCampus(params.campusId as string);
      if (!campus) return notFound('cơ sở');
      const view = campusView(campus);
      const levelsOf = (id: string) => view.buildingInfo.find((i) => i.id === id)?.levels;
      const levels = campusLevels(campus, levelsOf);
      const groundLevel = campusGroundLevel(campus, levelsOf);
      const requested = new URL(request.url).searchParams.get('level');
      const level = requested === null ? groundLevel : Number(requested);
      const floors = campus.buildings.flatMap((pl) => {
        const b = db.getBuilding(pl.buildingId);
        const floor = b && floorAtLevel(b, pl, level);
        return floor ? [{ buildingId: pl.buildingId, floor }] : [];
      });
      const body: CampusMapView = {
        campus: view,
        level,
        levels,
        groundLevel,
        floors,
        departments: db.departments(),
      };
      return HttpResponse.json(body);
    }),

    http.post(url(P.campusRoute), async ({ request }) => {
      await delay();
      const body = (await request.json()) as CampusRouteRequest;
      const campus = db.getCampus(body.campusId);
      if (!campus) return notFound('cơ sở');
      const buildings = new Map(
        campus.buildings.flatMap((pl) => {
          const b = db.getBuilding(pl.buildingId);
          return b ? [[b.id, b] as const] : [];
        }),
      );
      try {
        const route = findCampusRoute(campus, buildings, body.from, body.to, {
          accessibleOnly: body.accessibleOnly,
          preferCovered: body.preferCovered,
        });
        return route
          ? HttpResponse.json({
              route,
              siteRoute: campusRouteToSiteRoute(route, campus, buildings),
            })
          : apiError(422, 'NO_ROUTE', 'Không tìm được đường đi tới điểm đến');
      } catch (error) {
        if (error instanceof CampusRouteError || error instanceof RouteError) {
          return apiError(422, error.code, error.message);
        }
        throw error;
      }
    }),

    http.post(url(P.campuses), async ({ request }) => {
      await delay();
      const body = (await request.json()) as CreateCampusRequest;
      const campus: Campus = {
        id: createId('campus'),
        name: body.name?.trim() ?? '',
        code: body.code?.trim() || undefined,
        address: body.address?.trim() || undefined,
        geo: body.geo,
        buildings: [],
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      const validation = validateCampus(campus, buildingInfoMap());
      if (!validation.valid) {
        return apiError(422, 'INVALID_CAMPUS', validation.issues[0]!.message, validation.issues);
      }
      db.putCampus(campus);
      return HttpResponse.json(campus, { status: 201 });
    }),

    http.put(url(P.campus(':campusId')), async ({ params, request }) => {
      await delay();
      const current = db.getCampus(params.campusId as string);
      if (!current) return notFound('cơ sở');
      const body = (await request.json()) as Campus & { buildingInfo?: unknown };
      // Bỏ phần thông tin rút gọn (chỉ đọc) nếu client gửi kèm.
      const incoming: Campus = { ...body };
      delete (incoming as { buildingInfo?: unknown }).buildingInfo;
      if (incoming.version !== current.version) {
        return apiError(
          409,
          'VERSION_CONFLICT',
          'Cơ sở đã được người khác cập nhật. Hãy tải lại.',
          {
            currentVersion: current.version,
          },
        );
      }
      const validation = validateCampus(incoming, buildingInfoMap());
      if (!validation.valid) {
        return apiError(422, 'INVALID_CAMPUS', 'Dữ liệu cơ sở không hợp lệ', validation.issues);
      }
      // Toà chuyển từ cơ sở khác sang: gỡ khỏi cơ sở cũ.
      const ids = new Set(incoming.buildings.map((pl) => pl.buildingId));
      for (const other of db.listCampuses()) {
        if (other.id === current.id || !other.buildings.some((pl) => ids.has(pl.buildingId))) {
          continue;
        }
        other.buildings = other.buildings.filter((pl) => !ids.has(pl.buildingId));
        db.touchCampus(other);
      }
      const saved: Campus = {
        ...incoming,
        id: current.id,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
      };
      db.putCampus(saved);
      return HttpResponse.json({ version: saved.version, updatedAt: saved.updatedAt });
    }),

    http.delete(url(P.campus(':campusId')), async ({ params }) => {
      await delay();
      const campus = db.getCampus(params.campusId as string);
      if (!campus) return notFound('cơ sở');
      if (campus.buildings.length) {
        return apiError(409, 'CAMPUS_NOT_EMPTY', 'Hãy chuyển hoặc xoá các toà nhà của cơ sở trước');
      }
      db.removeCampus(campus.id);
      return new HttpResponse(null, { status: 204 });
    }),

    /* --- Phòng ------------------------------------------------------- */

    http.get(url(P.rooms(':buildingId')), async ({ params, request }) => {
      await delay();
      const building = db.getBuilding(params.buildingId as string);
      if (!building) return notFound('toà nhà');
      const query = new URL(request.url).searchParams;
      const floorId = query.get('floorId');
      const departmentId = query.get('departmentId');
      const items: RoomListItem[] = searchRooms(building, query.get('q') ?? '')
        .filter((r) => !floorId || r.floor.id === floorId)
        .filter((r) => !departmentId || r.room.departmentId === departmentId)
        .map((r) => toRoomItem(building, r));
      return HttpResponse.json(items);
    }),

    http.get(url(P.allRooms), async ({ request }) => {
      await delay();
      const q = new URL(request.url).searchParams.get('q') ?? '';
      const items = db
        .listBuildings()
        .flatMap((b) => searchRooms(b, q).map((r) => toRoomItem(b, r)));
      return HttpResponse.json(items);
    }),

    /* --- Định vị ------------------------------------------------------ */

    http.post(url(P.localize), async ({ request }) => {
      const form = await request.formData();
      const image = form.get(LOCALIZE_FIELDS.image);
      if (!(image instanceof File) || image.size === 0) {
        return apiError(400, 'IMAGE_REQUIRED', 'Thiếu ảnh chụp');
      }
      await delay(1200); // giả lập thời gian server xử lý ảnh

      const requested = form.get(LOCALIZE_FIELDS.buildingId);
      const building =
        (typeof requested === 'string' && db.getBuilding(requested)) || db.listBuildings()[0];
      if (!building) return notFound('toà nhà');

      // Ảnh quá nhỏ coi như không nhận diện được — để test luồng lỗi.
      if (image.size < 1024) {
        return apiError(
          422,
          'LOCALIZE_FAILED',
          'Không nhận diện được vị trí. Hãy chụp lại rõ hơn.',
        );
      }

      // Chọn ngẫu nhiên một điểm hành lang làm vị trí "nhận diện được".
      const candidates = building.floors.flatMap((floor) =>
        floor.navGraph.nodes
          .filter((n) => n.kind === 'corridor' || n.kind === 'entrance')
          .map((n) => ({ floor, node: n })),
      );
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      if (!pick) return apiError(422, 'LOCALIZE_FAILED', 'Toà nhà chưa có dữ liệu định vị');
      const result: LocalizeResult = {
        buildingId: building.id,
        floorId: pick.floor.id,
        position: {
          x: pick.node.position.x + randomBetween(-0.5, 0.5),
          y: pick.node.position.y + randomBetween(-0.5, 0.5),
        },
        heading: Math.round(randomBetween(0, 360)),
        confidence: Number(randomBetween(0.75, 0.98).toFixed(2)),
      };
      return HttpResponse.json(result);
    }),

    /* --- Chỉ đường ---------------------------------------------------- */

    http.post(url(P.route), async ({ request }) => {
      await delay();
      const body = (await request.json()) as RouteRequest;
      const building = db.getBuilding(body.buildingId);
      if (!building) return notFound('toà nhà');
      try {
        const route = findRoute(building, body.from, body.to, {
          accessibleOnly: body.accessibleOnly,
        });
        return route
          ? HttpResponse.json(route)
          : apiError(422, 'NO_ROUTE', 'Không tìm được đường đi tới điểm đến');
      } catch (error) {
        if (error instanceof RouteError) return apiError(422, error.code, error.message);
        throw error;
      }
    }),

    /* --- Lưu lượng ---------------------------------------------------- */

    http.get(url(P.traffic(':buildingId')), async ({ params, request }) => {
      await delay();
      const id = params.buildingId as string;
      if (!db.getBuilding(id)) return notFound('toà nhà');
      const floorId = new URL(request.url).searchParams.get('floorId');
      return HttpResponse.json(simulatorFor(id).snapshot(floorId) satisfies TrafficResponse);
    }),

    http.get(url(P.trafficHistory(':buildingId')), async ({ params, request }) => {
      await delay();
      const id = params.buildingId as string;
      if (!db.getBuilding(id)) return notFound('toà nhà');
      const q = new URL(request.url).searchParams;
      const hours = Math.min(Math.max(Number(q.get('hours') ?? 24), 1), 168);
      const bucket = Math.min(Math.max(Number(q.get('bucketMinutes') ?? 15), 1), 240);
      return HttpResponse.json(simulatorFor(id).history(hours, bucket));
    }),

    // Kênh realtime: gửi ảnh chụp ngay khi kết nối rồi đều đặn mỗi STREAM_INTERVAL_MS.
    trafficStream.addEventListener('connection', ({ client, params }) => {
      const id = String(params.buildingId ?? '');
      const send = () => {
        const message: TrafficStreamMessage = db.getBuilding(id)
          ? { type: 'snapshot', data: simulatorFor(id).snapshot() }
          : { type: 'error', message: 'Không tìm thấy toà nhà' };
        client.send(JSON.stringify(message));
      };
      send();
      const timer = setInterval(send, STREAM_INTERVAL_MS);
      client.addEventListener('close', () => clearInterval(timer));
    }),
  ];
}
