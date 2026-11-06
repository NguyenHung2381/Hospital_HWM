import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { ApiError, createApiClient } from '@hwn/api-client';
import { validateBuilding } from '@hwn/map-core';
import {
  createLanPlanBuildings,
  LAN_CAMPUS_ID,
  SAMPLE_ANNEX_ID,
  SAMPLE_BUILDING_ID,
  SAMPLE_CAMPUS_ID,
} from '@hwn/map-core/sample';
import { createHandlers } from './handlers';
import { resetMockDb } from './db';

const BASE = 'http://localhost/api';
const server = setupServer(...createHandlers(BASE));
const api = createApiClient({ baseURL: BASE });
/** Các toà theo bản vẽ LAN (cơ sở thứ hai của dữ liệu mẫu). */
const planIds = createLanPlanBuildings().map((b) => b.id);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => resetMockDb({ sample: true }));
afterAll(() => server.close());

describe('mock API + api-client', () => {
  it('lấy danh sách và chi tiết toà nhà', async () => {
    const list = await api.buildings.list();
    expect(list).toEqual([
      expect.objectContaining({ id: SAMPLE_BUILDING_ID, floorCount: 2 }),
      expect.objectContaining({ id: SAMPLE_ANNEX_ID, floorCount: 2 }),
      ...planIds.map((id) => expect.objectContaining({ id, campusId: LAN_CAMPUS_ID })),
    ]);
    const building = await api.buildings.get(SAMPLE_BUILDING_ID);
    expect(building.floors).toHaveLength(2);
  });

  it('hai toà mẫu không trùng ID tầng / phòng', async () => {
    const [a, b] = await Promise.all([
      api.buildings.get(SAMPLE_BUILDING_ID),
      api.buildings.get(SAMPLE_ANNEX_ID),
    ]);
    const ids = (x: typeof a) => x.floors.flatMap((f) => [f.id, ...f.rooms.map((r) => r.id)]);
    const shared = ids(a).filter((id) => ids(b).includes(id));
    expect(shared).toEqual([]);
    expect(validateBuilding(b).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('tạo và xoá toà nhà; không xoá được toà cuối cùng', async () => {
    const created = await api.buildings.create({ name: '  Khu C ', campusId: SAMPLE_CAMPUS_ID });
    expect(created).toMatchObject({ name: 'Khu C', version: 1 });
    expect(created.floors).toHaveLength(1);
    expect(created.departments.length).toBeGreaterThan(0);
    const list = await api.buildings.list();
    expect(list).toHaveLength(3 + planIds.length);
    expect(list.find((b) => b.id === created.id)?.campusId).toBe(SAMPLE_CAMPUS_ID);
    // Toà mới được đặt bên phải các toà đã có (toà mẫu rộng 40 m).
    const campus = await api.campuses.get(SAMPLE_CAMPUS_ID);
    const placed = campus.buildings.find((pl) => pl.buildingId === created.id);
    expect(placed?.position.x).toBeGreaterThanOrEqual(50);

    await api.buildings.remove(created.id);
    expect(
      (await api.campuses.get(SAMPLE_CAMPUS_ID)).buildings.some(
        (pl) => pl.buildingId === created.id,
      ),
    ).toBe(false);
    await api.buildings.remove(SAMPLE_ANNEX_ID);
    for (const id of planIds) await api.buildings.remove(id);
    await expect(api.buildings.remove(SAMPLE_BUILDING_ID)).rejects.toMatchObject({
      status: 409,
      code: 'LAST_BUILDING',
    });
    await expect(api.buildings.create({ name: ' ' })).rejects.toMatchObject({ status: 400 });
  });

  it('tìm phòng trên mọi toà nhà', async () => {
    const items = await api.rooms.searchAll({ q: 'buong benh' });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.buildingId === SAMPLE_ANNEX_ID)).toBe(true);
    expect(items[0]!.buildingName).toContain('Khu B');
    const both = await api.rooms.searchAll({ q: 'nha ve sinh' });
    expect(new Set(both.map((i) => i.buildingId)).size).toBe(2);
  });

  it('trả ApiError 404 khi không có toà nhà', async () => {
    await expect(api.buildings.get('khong_co')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('lưu tầng, tăng version và chặn xung đột version', async () => {
    const building = await api.buildings.get(SAMPLE_BUILDING_ID);
    const floor = { ...building.floors[0]!, name: 'Tầng trệt' };
    const saved = await api.buildings.saveFloor(building.id, building.version, floor);
    expect(saved.version).toBe(building.version + 1);
    expect((await api.buildings.get(building.id)).floors[0]!.name).toBe('Tầng trệt');

    const conflict = await api.buildings
      .saveFloor(building.id, building.version, floor)
      .catch((e: unknown) => e);
    expect(conflict).toBeInstanceOf(ApiError);
    expect((conflict as ApiError).code).toBe('VERSION_CONFLICT');
  });

  it('từ chối lưu bản đồ không hợp lệ', async () => {
    const building = await api.buildings.get(SAMPLE_BUILDING_ID);
    const floor = building.floors[0]!;
    floor.openings[0]!.wallId = 'khong_co';
    await expect(
      api.buildings.saveFloor(building.id, building.version, floor),
    ).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_MAP',
    });
  });

  it('CRUD khoa và không cho xoá khoa đang có phòng', async () => {
    const created = await api.departments.create(SAMPLE_BUILDING_ID, {
      name: 'Khoa Mắt',
      code: 'MAT',
      color: '#0ea5e9',
    });
    expect(created.id).toMatch(/^dept_/);
    await api.departments.update(SAMPLE_BUILDING_ID, { ...created, name: 'Khoa Mắt (sửa)' });
    const list = await api.departments.list(SAMPLE_BUILDING_ID);
    expect(list.find((d) => d.id === created.id)?.name).toBe('Khoa Mắt (sửa)');
    await api.departments.remove(SAMPLE_BUILDING_ID, created.id);

    await expect(api.departments.remove(SAMPLE_BUILDING_ID, 'dept_kkb')).rejects.toMatchObject({
      status: 409,
      code: 'DEPARTMENT_IN_USE',
    });
  });

  it('tìm phòng có lọc', async () => {
    const all = await api.rooms.search(SAMPLE_BUILDING_ID);
    expect(all).toHaveLength(14);
    const floor2 = await api.rooms.search(SAMPLE_BUILDING_ID, {
      q: 'phong kham',
      floorId: 'floor_2',
    });
    expect(floor2.map((r) => r.room.code)).toEqual(['P.204', 'P.206']);
  });

  it('định vị bằng ảnh và chỉ đường tới phòng', async () => {
    const image = new Blob([new Uint8Array(4096)], { type: 'image/jpeg' });
    const location = await api.localize(image, { buildingId: SAMPLE_BUILDING_ID });
    expect(location.buildingId).toBe(SAMPLE_BUILDING_ID);
    expect(location.confidence).toBeGreaterThan(0.5);

    const route = await api.route({
      buildingId: SAMPLE_BUILDING_ID,
      from: location,
      to: { roomId: 'floor_2_room_bot3' },
    });
    expect(route.segments.at(-1)?.floorId).toBe('floor_2');
    expect(route.instructions.at(-1)?.type).toBe('arrive');
  });

  it('báo lỗi khi ảnh không nhận diện được', async () => {
    const tiny = new Blob([new Uint8Array(10)], { type: 'image/jpeg' });
    await expect(api.localize(tiny)).rejects.toMatchObject({
      status: 422,
      code: 'LOCALIZE_FAILED',
    });
  });

  it('lấy lưu lượng theo tầng', async () => {
    const snapshot = await api.traffic.snapshot(SAMPLE_BUILDING_ID, { floorId: 'floor_1' });
    expect(snapshot.edges.length).toBeGreaterThan(0);
    expect(snapshot.edges.every((e) => e.floorId === 'floor_1')).toBe(true);
    expect(snapshot.totalActive).toBe(snapshot.edges.reduce((s, e) => s + e.count, 0));
  });

  it('danh mục khoa dùng chung cho mọi toà', async () => {
    const created = await api.departmentCatalog.create({
      name: 'Khoa Mắt',
      code: 'MAT',
      color: '#0ea5e9',
    });
    const [a, b] = await Promise.all([
      api.buildings.get(SAMPLE_BUILDING_ID),
      api.buildings.get(SAMPLE_ANNEX_ID),
    ]);
    expect(a.departments.some((d) => d.id === created.id)).toBe(true);
    expect(b.departments.some((d) => d.id === created.id)).toBe(true);

    // Lưu toà với danh sách khoa cũ không làm mất khoa mới.
    await api.buildings.save({ ...a, departments: [] });
    expect((await api.departmentCatalog.list()).some((d) => d.id === created.id)).toBe(true);

    await api.departmentCatalog.update({ ...created, name: 'Khoa Mắt (sửa)' });
    expect((await api.buildings.get(SAMPLE_ANNEX_ID)).departments).toContainEqual(
      expect.objectContaining({ id: created.id, name: 'Khoa Mắt (sửa)' }),
    );
    await api.departmentCatalog.remove(created.id);
    // Khoa còn phòng ở toà phụ cũng không xoá được.
    await expect(api.departmentCatalog.remove('dept_kkb')).rejects.toMatchObject({
      status: 409,
      code: 'DEPARTMENT_IN_USE',
    });
  });

  it('CRUD cơ sở, chuyển toà giữa các cơ sở, chặn xung đột version', async () => {
    const list = await api.campuses.list();
    expect(list).toEqual([
      expect.objectContaining({
        id: SAMPLE_CAMPUS_ID,
        buildingIds: [SAMPLE_BUILDING_ID, SAMPLE_ANNEX_ID],
      }),
      expect.objectContaining({ id: LAN_CAMPUS_ID, buildingIds: planIds }),
    ]);
    const main = await api.campuses.get(SAMPLE_CAMPUS_ID);
    expect(main.buildingInfo.map((i) => i.footprint.length)).toEqual([4, 4]);

    await expect(api.campuses.create({ name: '' })).rejects.toMatchObject({ status: 422 });
    const second = await api.campuses.create({ name: 'Cơ sở 2', geo: { lat: 10.8, lng: 106.6 } });
    await api.campuses.save({
      ...second,
      buildings: [{ buildingId: SAMPLE_ANNEX_ID, position: { x: 0, y: 0 }, rotation: 30 }],
    });
    // Khu B rời cơ sở chính.
    const mainAfter = await api.campuses.get(SAMPLE_CAMPUS_ID);
    expect(mainAfter.buildings.map((pl) => pl.buildingId)).toEqual([SAMPLE_BUILDING_ID]);
    expect(mainAfter.version).toBe(main.version + 1);
    expect((await api.buildings.list()).find((b) => b.id === SAMPLE_ANNEX_ID)?.campusId).toBe(
      second.id,
    );

    await expect(api.campuses.save(main)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(api.campuses.remove(second.id)).rejects.toMatchObject({
      code: 'CAMPUS_NOT_EMPTY',
    });
    await expect(
      api.campuses.save({
        ...mainAfter,
        buildings: [{ buildingId: 'khong_co', position: { x: 0, y: 0 }, rotation: 0 }],
      }),
    ).rejects.toMatchObject({ status: 422, code: 'INVALID_CAMPUS' });
  });

  it('bản đồ cơ sở theo tầng chung', async () => {
    const ground = await api.campuses.map(SAMPLE_CAMPUS_ID);
    expect(ground).toMatchObject({ level: 1, levels: [1, 2], groundLevel: 1 });
    expect(ground.floors.map((f) => f.floor.id).sort()).toEqual(['b_floor_1', 'floor_1']);
    expect(ground.campus.site?.pois.length).toBeGreaterThan(0);
    expect(ground.departments.length).toBeGreaterThan(0);
    const upper = await api.campuses.map(SAMPLE_CAMPUS_ID, 2);
    expect(upper.floors.map((f) => f.floor.level)).toEqual([2, 2]);
  });

  it('chỉ đường liên toà và báo lỗi điểm đến lạ', async () => {
    const res = await api.campuses.route({
      campusId: SAMPLE_CAMPUS_ID,
      from: { buildingId: SAMPLE_BUILDING_ID, floorId: 'floor_1', position: { x: 20, y: 10 } },
      to: { buildingId: SAMPLE_ANNEX_ID, roomId: 'b_floor_1_room_bot1' },
      preferCovered: true,
    });
    expect(res.route.legs.map((l) => l.kind)).toEqual(['indoor', 'outdoor', 'indoor']);
    expect(res.siteRoute.segments.every((s) => s.floorId === 'L1')).toBe(true);
    await expect(
      api.campuses.route({
        campusId: SAMPLE_CAMPUS_ID,
        from: { site: { x: 0, y: 0 } },
        to: { poiId: 'khong_co' },
      }),
    ).rejects.toMatchObject({ status: 422, code: 'UNKNOWN_POI' });
  });
});
