import { describe, expect, it } from 'vitest';
import { compassToHeading, headingToCompass, searchLandmarks, searchRooms } from './lookup';
import { findRoute, RouteError } from './navigation';
import { createSampleBuilding } from './sample';

const building = createSampleBuilding();
const entrance = { floorId: 'floor_1', position: { x: 1, y: 10 } };

describe('findRoute', () => {
  it('chỉ đường trong cùng một tầng', () => {
    const route = findRoute(building, entrance, { roomId: 'floor_1_room_top1' })!;
    expect(route).not.toBeNull();
    expect(route.segments).toHaveLength(1);
    const path = route.segments[0]!.path;
    expect(path[0]).toEqual(entrance.position);
    // Dữ liệu mẫu đặt điểm đích lệch 2.5 m sang phải cửa, cách tường trong cùng 2.5 m.
    expect(path[path.length - 1]).toEqual({ x: 17.5, y: 2.5 });
    // Đi dọc hành lang 14 m, rẽ trái, 2 m tới cửa rồi chéo vào điểm đích.
    expect(route.distance).toBeCloseTo(14 + 2 + Math.hypot(2.5, 5.5));
    expect(route.instructions.map((i) => i.type)).toEqual([
      'start',
      'straight',
      'turn-left',
      'enter-room',
      'straight',
      'arrive',
    ]);
    // Cửa chỉ cách góc rẽ 2 m: gộp vào bước vào cửa thay vì thêm "Đi thẳng 2 m".
    expect(route.instructions[3]).toMatchObject({
      distance: 2,
      text: expect.stringContaining('P.102'),
    });
    expect(route.entry).toMatchObject({ position: { x: 15, y: 8 }, label: 'Cửa P.102' });
  });

  it('không tạo bước "đi thẳng 1 m, rẽ phải" cho chặng ngắn đầu tuyến', () => {
    // Đứng lệch khỏi hành lang 0.8 m: chặng ra hành lang quá ngắn để có bước riêng.
    const route = findRoute(
      building,
      { floorId: 'floor_1', position: { x: 10, y: 10.8 } },
      { roomId: 'floor_1_room_top2' },
    )!;
    expect(route.instructions.map((i) => i.type)).toEqual([
      'start',
      'straight',
      'turn-left',
      'enter-room',
      'straight',
      'arrive',
    ]);
    expect(route.instructions[1]!.distance).toBeGreaterThan(15);
  });

  it('chỉ đường sang tầng khác qua thang', () => {
    const route = findRoute(building, entrance, { roomId: 'floor_2_room_top0' })!;
    expect(route.segments.map((s) => s.floorId)).toEqual(['floor_1', 'floor_2']);
    expect(route.segments[0]!.transition?.toFloorId).toBe('floor_2');
    expect(route.instructions.at(-1)?.text).toContain('Phòng Siêu âm');
    expect(route.estimatedSeconds).toBeGreaterThan(route.distance / 1.2);
  });

  it('chế độ xe lăn chỉ dùng thang máy', () => {
    const normal = findRoute(building, entrance, { roomId: 'floor_2_room_top0' })!;
    const accessible = findRoute(
      building,
      entrance,
      { roomId: 'floor_2_room_top0' },
      { accessibleOnly: true },
    )!;
    expect(normal.segments[0]!.transition?.connectorType).toBe('stairs');
    expect(accessible.segments[0]!.transition?.connectorType).toBe('elevator');
  });

  it('chỉ đường tới một vị trí tự do', () => {
    const route = findRoute(building, entrance, {
      floorId: 'floor_1',
      position: { x: 20, y: 10.5 },
    })!;
    expect(route.to.position).toEqual({ x: 20, y: 10.5 });
  });

  it('báo lỗi khi phòng không tồn tại', () => {
    expect(() => findRoute(building, entrance, { roomId: 'khong_co' })).toThrow(RouteError);
  });

  it('trả về null khi không có đường đi', () => {
    const b = createSampleBuilding();
    b.floors[1]!.connectors.forEach((c) => (c.linkId = `${c.linkId}_cut`));
    expect(findRoute(b, entrance, { roomId: 'floor_2_room_top0' })).toBeNull();
  });
});

describe('searchRooms', () => {
  it('tìm không phân biệt dấu theo tên, tag và khoa', () => {
    expect(searchRooms(building, 'sieu am').map((r) => r.room.code)).toEqual(['P.201']);
    expect(searchRooms(building, 'lay mau').map((r) => r.room.code)).toContain('P.105');
    expect(searchRooms(building, 'khoa nhi')).toHaveLength(2);
  });
});

describe('điểm đích đến & mốc', () => {
  it('kết thúc tại điểm đích đến của phòng nếu có', () => {
    const b = createSampleBuilding();
    const room = b.floors[0]!.rooms.find((r) => r.id === 'floor_1_room_top1')!;
    room.destination = { x: 17, y: 2 };
    const route = findRoute(b, entrance, { roomId: room.id })!;
    expect(route.segments.at(-1)!.path.at(-1)).toEqual({ x: 17, y: 2 });
    expect(route.to).toMatchObject({ roomId: room.id, position: { x: 17, y: 2 } });
  });

  it('bỏ qua điểm đích nằm ngoài phòng', () => {
    const b = createSampleBuilding();
    const room = b.floors[0]!.rooms.find((r) => r.id === 'floor_1_room_top1')!;
    room.destination = { x: 50, y: 50 };
    const route = findRoute(b, entrance, { roomId: room.id })!;
    // Kết thúc tại nút phòng trong đồ thị, không đi ra (50, 50).
    const roomNode = b.floors[0]!.navGraph.nodes.find((n) => n.refId === room.id)!;
    expect(route.segments.at(-1)!.path.at(-1)).toEqual(roomNode.position);
  });

  it('chỉ đường tới mốc ở hành lang', () => {
    const route = findRoute(building, entrance, { landmarkId: 'lm_atm_1' })!;
    expect(route.to).toMatchObject({ landmarkId: 'lm_atm_1', position: { x: 38, y: 11 } });
    expect(route.segments.at(-1)!.path.at(-1)).toEqual({ x: 38, y: 11 });
    expect(route.instructions.at(-1)!.text).toBe('Đến Cây ATM');
  });

  it('mốc trong phòng: đi qua cửa phòng chứ không xuyên tường', () => {
    const route = findRoute(
      building,
      { floorId: 'floor_1', position: { x: 25, y: 10 } },
      { landmarkId: 'lm_kiosk_1' },
    )!;
    const path = route.segments[0]!.path;
    // Cửa sảnh tiếp đón ở x = 5 trên tường y = 12: đi tới x = 5 trên hành lang, qua cửa, rồi đi
    // thẳng tới máy lấy số (không vòng qua quầy giữa sảnh).
    expect(path).toEqual([
      { x: 25, y: 10 },
      { x: 5, y: 10 },
      { x: 5, y: 12 },
      { x: 3, y: 17.5 },
    ]);
    expect(route.entry?.label).toBe('Cửa S.1');
    expect(route.instructions.map((i) => i.type)).toContain('enter-room');
  });

  it('chỉ đường tới mốc ở tầng khác', () => {
    const route = findRoute(building, entrance, { landmarkId: 'lm_water_2' })!;
    expect(route.segments.map((s) => s.floorId)).toEqual(['floor_1', 'floor_2']);
  });

  it('báo lỗi khi không có mốc', () => {
    expect(() => findRoute(building, entrance, { landmarkId: 'khong_co' })).toThrow(RouteError);
  });

  it('tìm mốc không phân biệt dấu, theo tên loại', () => {
    expect(searchLandmarks(building, 'lay so').map((r) => r.landmark.id)).toEqual(['lm_kiosk_1']);
    expect(searchLandmarks(building, 'nha ve sinh')).toHaveLength(0);
    expect(searchLandmarks(building, 'nuoc uong').map((r) => r.landmark.id)).toEqual([
      'lm_water_2',
    ]);
  });
});

describe('la bàn', () => {
  it('mặc định Bắc hướng lên trên bản vẽ', () => {
    expect(compassToHeading({}, 0)).toBe(270);
    expect(compassToHeading({}, 90)).toBe(0); // Đông = sang phải
  });

  it('theo góc hướng Bắc của toà nhà', () => {
    const b = { northAngle: 90 }; // Bắc chỉ sang phải
    expect(compassToHeading(b, 0)).toBe(0);
    expect(compassToHeading(b, 180)).toBe(180);
    expect(headingToCompass(b, compassToHeading(b, 37))).toBeCloseTo(37);
  });
});
