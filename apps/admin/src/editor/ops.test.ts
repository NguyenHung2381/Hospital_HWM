import { describe, expect, it } from 'vitest';
import { validateBuilding, type Floor } from '@hwn/map-core';
import { createSampleBuilding } from '@hwn/map-core/sample';
import {
  addConnector,
  addLandmark,
  addNavEdge,
  addNavNode,
  addRoom,
  addFloor,
  addOpening,
  addRectWalls,
  addWall,
  allItems,
  applyDrag,
  buildingHeights,
  calibrateBackground,
  clearBuilding,
  cloneConnectorToFloors,
  connectorRect,
  copyItems,
  deleteItems,
  findOpeningPlacement,
  itemsInRect,
  makeDragPlan,
  moveOpening,
  nextConnectorName,
  nextLandmarkName,
  pasteItems,
  restackFloors,
  selectionBounds,
  setEndpoints,
  setRoomDestination,
  endpointsAt,
  transformItems,
} from './ops';
import { hitEndpointHandle, hitTest, snapPoint } from './snap';

const emptyFloor = (): Floor => ({
  id: 'f',
  name: 'F',
  level: 1,
  elevation: 0,
  height: 3,
  walls: [],
  openings: [],
  connectors: [],
  rooms: [],
  navGraph: { nodes: [], edges: [] },
});

/** Hai tường nối nhau hình chữ L tại (10, 0). */
function lFloor() {
  const floor = emptyFloor();
  const a = addWall(floor, { x: 0, y: 0 }, { x: 10, y: 0 }, { thickness: 0.2 })!;
  const b = addWall(floor, { x: 10, y: 0 }, { x: 10, y: 6 }, { thickness: 0.2 })!;
  return { floor, a, b };
}

describe('tường', () => {
  it('bỏ qua tường quá ngắn', () => {
    expect(addWall(emptyFloor(), { x: 0, y: 0 }, { x: 0.01, y: 0 }, { thickness: 0.2 })).toBeNull();
  });

  it('loại tường: tường gạch không lưu `kind`, lan can mặc định thấp 1,1 m', () => {
    const floor = emptyFloor();
    const brick = addWall(floor, { x: 0, y: 0 }, { x: 5, y: 0 }, { thickness: 0.2 })!;
    expect(brick.kind).toBeUndefined();
    expect(brick.height).toBe(3);
    const rail = addWall(
      floor,
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { thickness: 0.1, kind: 'railing' },
    )!;
    expect(rail.kind).toBe('railing');
    expect(rail.height).toBe(1.1);
    const glass = addWall(
      floor,
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { thickness: 0.1, kind: 'glass' },
    )!;
    expect(glass.height).toBe(3);
  });

  it('kéo khớp nối di chuyển đầu mút của mọi tường chung điểm', () => {
    const { floor, a, b } = lFloor();
    setEndpoints(floor, endpointsAt(floor, { x: 10, y: 0 }), { x: 12, y: 1 });
    expect(a.end).toEqual({ x: 12, y: 1 });
    expect(b.start).toEqual({ x: 12, y: 1 });
  });

  it('kéo tường được chọn kéo giãn tường nối với nó', () => {
    const { floor, a, b } = lFloor();
    const plan = makeDragPlan(floor, [{ type: 'wall', id: a.id }]);
    applyDrag(floor, plan, { x: 0, y: 2 });
    applyDrag(floor, plan, { x: 0, y: 3 }); // tính lại từ gốc, không cộng dồn
    expect(a.start).toEqual({ x: 0, y: 3 });
    expect(b.start).toEqual({ x: 10, y: 3 });
    expect(b.end).toEqual({ x: 10, y: 6 });
  });
});

describe('ô cửa', () => {
  it('đặt cửa trên tường gần nhất, kẹp trong phạm vi tường và phát hiện chồng lấn', () => {
    const { floor, a } = lFloor();
    const placement = findOpeningPlacement(floor, { x: 0.2, y: 0.3 }, 1, 0.5)!;
    expect(placement).toEqual({ wallId: a.id, offset: 0.5, overlaps: false });
    addOpening(floor, 'door', placement);
    expect(findOpeningPlacement(floor, { x: 1, y: 0 }, 1, 0.5)?.overlaps).toBe(true);
    expect(findOpeningPlacement(floor, { x: 5, y: 3 }, 1, 0.5)).toBeNull();
  });

  it('trượt cửa sang tường khác', () => {
    const { floor, b } = lFloor();
    const door = addOpening(floor, 'door', findOpeningPlacement(floor, { x: 3, y: 0 }, 1, 0.5)!);
    moveOpening(floor, door.id, { x: 10.1, y: 3 }, 0.5);
    expect(door.wallId).toBe(b.id);
    expect(door.offset).toBeCloseTo(3);
  });

  it('thu ngắn tường kẹp cửa lại', () => {
    const { floor, a } = lFloor();
    const door = addOpening(floor, 'door', { wallId: a.id, offset: 8 });
    setEndpoints(floor, [{ wallId: a.id, which: 'end' }], { x: 5, y: 0 });
    expect(door.offset).toBe(4.5);
  });

  it('xoá tường xoá luôn cửa trên tường đó', () => {
    const { floor, a } = lFloor();
    addOpening(floor, 'window', { wallId: a.id, offset: 5 });
    deleteItems(floor, [{ type: 'wall', id: a.id }]);
    expect(floor.walls).toHaveLength(1);
    expect(floor.openings).toHaveLength(0);
  });
});

describe('copy / dán / thang', () => {
  it('dán tường kèm cửa với ID mới', () => {
    const { floor, a } = lFloor();
    addOpening(floor, 'door', { wallId: a.id, offset: 5 });
    const clip = copyItems(floor, [{ type: 'wall', id: a.id }])!;
    const created = pasteItems(floor, clip, { x: 0, y: 2 });
    expect(created).toHaveLength(1);
    const pasted = floor.walls.find((w) => w.id === created[0]!.id)!;
    expect(pasted.start).toEqual({ x: 0, y: 2 });
    expect(floor.openings.filter((o) => o.wallId === pasted.id)).toHaveLength(1);
  });

  it('dán thang sang tầng khác giữ linkId, cùng tầng thì tạo linkId mới', () => {
    const building = createSampleBuilding();
    const [f1, f2] = building.floors as [Floor, Floor];
    const elevator = addConnector(f1, 'elevator', { x: 5, y: 5 }, { name: 'TM' });
    const clip = copyItems(f1, [{ type: 'connector', id: elevator.id }])!;
    pasteItems(f2, clip, { x: 0, y: 0 });
    pasteItems(f1, clip, { x: 3, y: 0 });
    expect(f2.connectors.at(-1)!.linkId).toBe(elevator.linkId);
    expect(f1.connectors.at(-1)!.linkId).not.toBe(elevator.linkId);
  });

  it('loại thang máy: kích thước, tên mặc định và nhân bản theo loại', () => {
    const building = createSampleBuilding();
    const f1 = building.floors[0]!;
    const before = nextConnectorName(building, 'elevator', 'bed');
    expect(before).toMatch(/^Thang máy bệnh nhân \d+$/);
    const bed = addConnector(f1, 'elevator', { x: 5, y: 5 }, { name: before, elevatorKind: 'bed' });
    expect(bed.elevatorKind).toBe('bed');
    expect(connectorRect(bed).depth).toBeCloseTo(3.2);
    expect(nextConnectorName(building, 'elevator', 'bed')).not.toBe(before);
    cloneConnectorToFloors(building, f1.id, bed.id, ['floor_2']);
    expect(building.floors[1]!.connectors.at(-1)!.elevatorKind).toBe('bed');
    // Thang thường không lưu `elevatorKind`.
    const normal = addConnector(
      f1,
      'elevator',
      { x: 9, y: 5 },
      { name: 'TM', elevatorKind: 'passenger' },
    );
    expect(normal.elevatorKind).toBeUndefined();
  });

  it('nhân bản thang sang các tầng khác, bỏ qua tầng đã có', () => {
    const building = createSampleBuilding();
    const f1 = building.floors[0]!;
    const c = addConnector(f1, 'stairs', { x: 2, y: 2 }, { name: 'TB' });
    expect(cloneConnectorToFloors(building, f1.id, c.id, ['floor_2'])).toBe(1);
    expect(cloneConnectorToFloors(building, f1.id, c.id, ['floor_2'])).toBe(0);
  });
});

describe('tầng', () => {
  it('thêm tầng trên cùng có sao chép kết cấu, dữ liệu vẫn hợp lệ', () => {
    const building = createSampleBuilding();
    const floor = addFloor(building, { copyStructureFrom: 'floor_1' });
    expect(floor).toMatchObject({ level: 3, name: 'Tầng 3', elevation: 7.2 });
    expect(floor.walls).toHaveLength(building.floors[0]!.walls.length);
    expect(floor.openings.some((o) => o.type === 'entrance')).toBe(false);
    // Thang ở tầng mới cùng linkId với tầng 1 → không có cảnh báo "thang không nối".
    const result = validateBuilding(building);
    expect(result.valid).toBe(true);
  });

  it('thêm tầng hầm phía dưới', () => {
    const building = createSampleBuilding();
    const floor = addFloor(building, { below: true });
    expect(floor).toMatchObject({ level: 0, name: 'Tầng trệt', elevation: -3.6 });
  });
});

describe('snap & hit test', () => {
  it('ưu tiên đầu mút, rồi khoá góc kèm làm tròn lưới, rồi lưới', () => {
    const { floor } = lFloor();
    const base = { floor, radius: 0.3, gridSize: 0.5, snapGrid: true, snapObjects: true };
    expect(snapPoint({ x: 10.1, y: 0.2 }, base)).toEqual({
      point: { x: 10, y: 0 },
      kind: 'endpoint',
    });
    const angled = snapPoint({ x: 3.1, y: 2.3 }, { ...base, from: { x: 0, y: 2 }, angleStep: 45 });
    expect(angled.kind).toBe('angle');
    expect(angled.point.y).toBeCloseTo(2);
    expect(angled.point.x).toBeCloseTo(3);
    expect(snapPoint({ x: 4.1, y: 3.2 }, base)).toEqual({ point: { x: 4, y: 3 }, kind: 'grid' });
    const onWall = snapPoint({ x: 4.1, y: 0.2 }, base);
    expect(onWall.kind).toBe('wall');
    expect(onWall.point.x).toBeCloseTo(4.1);
    expect(onWall.point.y).toBeCloseTo(0);
  });

  it('chọn cửa trước tường, và tay nắm đầu mút', () => {
    const { floor, a } = lFloor();
    const door = addOpening(floor, 'door', { wallId: a.id, offset: 5 });
    expect(hitTest(floor, { x: 5, y: 0.05 }, 0.1)).toEqual({ type: 'opening', id: door.id });
    expect(hitTest(floor, { x: 2, y: 0.05 }, 0.1)).toEqual({ type: 'wall', id: a.id });
    expect(hitTest(floor, { x: 5, y: 3 }, 0.1)).toBeNull();
    expect(hitEndpointHandle(floor, new Set([a.id]), { x: 9.95, y: 0 }, 0.1)).toMatchObject({
      wallId: a.id,
      which: 'end',
    });
  });
});

it('hiệu chỉnh tỉ lệ ảnh nền giữ nguyên điểm mốc', () => {
  const bg = { url: '', metersPerPixel: 0.05, offset: { x: 0, y: 0 }, rotation: 0, opacity: 0.5 };
  // Đo trên ảnh được 5 m nhưng thực tế là 10 m → phóng gấp đôi quanh p1 = (2, 2).
  const next = calibrateBackground(bg, { x: 2, y: 2 }, { x: 7, y: 2 }, 10);
  expect(next.metersPerPixel).toBeCloseTo(0.1);
  expect(next.offset).toEqual({ x: -2, y: -2 });
});

describe('phòng & đồ thị đi lại', () => {
  it('kéo phòng kéo theo nút phòng; xoá phòng xoá luôn nút và cạnh nối với nó', () => {
    const building = createSampleBuilding();
    const floor = building.floors[0]!;
    const room = floor.rooms[0]!;
    const node = floor.navGraph.nodes.find((n) => n.refId === room.id)!;
    const before = { ...node.position };
    applyDrag(floor, makeDragPlan(floor, [{ type: 'room', id: room.id }]), { x: 1, y: 0 });
    expect(node.position).toEqual({ x: before.x + 1, y: before.y });

    const edgesBefore = floor.navGraph.edges.length;
    deleteItems(floor, [{ type: 'room', id: room.id }]);
    expect(floor.rooms.some((r) => r.id === room.id)).toBe(false);
    expect(floor.navGraph.nodes.some((n) => n.id === node.id)).toBe(false);
    expect(floor.navGraph.edges.length).toBe(edgesBefore - 1);

    const created = addRoom(
      floor,
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ],
      { name: 'Mới' },
    );
    expect(created).toMatchObject({ name: 'Mới', code: '', departmentId: null, tags: [] });
  });

  it('thêm/xoá nút và cạnh đồ thị', () => {
    const floor = emptyFloor();
    const a = addNavNode(floor, { x: 0, y: 0 });
    const b = addNavNode(floor, { x: 5, y: 0 });
    expect(addNavEdge(floor, a.id, b.id)).not.toBeNull();
    expect(addNavEdge(floor, b.id, a.id)).toBeNull(); // đã có
    expect(addNavEdge(floor, a.id, a.id)).toBeNull();
    deleteItems(floor, [{ type: 'navNode', id: a.id }]);
    expect(floor.navGraph.nodes).toHaveLength(1);
    expect(floor.navGraph.edges).toHaveLength(0);
  });

  it('chọn phòng khi click vào khoảng trống trong phòng; nút đồ thị chỉ chọn được khi đang hiện', () => {
    const floor = createSampleBuilding().floors[0]!;
    expect(hitTest(floor, { x: 15, y: 2 }, 0.2)).toEqual({ type: 'room', id: 'floor_1_room_top1' });
    const node = floor.navGraph.nodes.find((n) => n.kind === 'corridor')!;
    expect(hitTest(floor, node.position, 0.2)?.type).not.toBe('navNode');
    expect(hitTest(floor, node.position, 0.2, { nav: true })).toEqual({
      type: 'navNode',
      id: node.id,
    });
  });
});

describe('tường chữ nhật', () => {
  it('tạo 4 tường khép kín dùng chung góc', () => {
    const f = emptyFloor();
    const walls = addRectWalls(f, { x: 4, y: 3 }, { x: 0, y: 0 }, { thickness: 0.2 });
    expect(walls).toHaveLength(4);
    expect(f.walls).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(walls[i]!.end).toEqual(walls[(i + 1) % 4]!.start);
    }
    // Kéo một góc kéo theo cả hai tường chung góc.
    expect(endpointsAt(f, { x: 0, y: 0 })).toHaveLength(2);
  });

  it('bỏ qua hình quá dẹt', () => {
    const f = emptyFloor();
    expect(addRectWalls(f, { x: 0, y: 0 }, { x: 5, y: 0.01 }, { thickness: 0.2 })).toEqual([]);
    expect(f.walls).toHaveLength(0);
  });
});

describe('chọn theo vùng', () => {
  const setup = () => {
    const f = emptyFloor();
    addWall(f, { x: 0, y: 0 }, { x: 4, y: 0 }, { thickness: 0.2 });
    addWall(f, { x: 10, y: 0 }, { x: 20, y: 0 }, { thickness: 0.2 });
    addRoom(
      f,
      [
        { x: 1, y: 1 },
        { x: 3, y: 1 },
        { x: 3, y: 3 },
        { x: 1, y: 3 },
      ],
      { name: 'P' },
    );
    return f;
  };

  it('kéo sang phải chỉ chọn đối tượng nằm gọn', () => {
    const f = setup();
    const refs = itemsInRect(f, { minX: -1, minY: -1, maxX: 12, maxY: 4 }, 'contain');
    expect(refs.map((r) => r.type).sort()).toEqual(['room', 'wall']);
  });

  it('kéo sang trái chọn cả đối tượng chạm vào', () => {
    const f = setup();
    const refs = itemsInRect(f, { minX: 11, minY: -1, maxX: 12, maxY: 1 }, 'cross');
    expect(refs).toEqual([{ type: 'wall', id: f.walls[1]!.id }]);
    // Khung nằm gọn trong phòng vẫn tính là chạm.
    const inside = itemsInRect(f, { minX: 1.5, minY: 1.5, maxX: 2, maxY: 2 }, 'cross');
    expect(inside).toEqual([{ type: 'room', id: f.rooms[0]!.id }]);
  });

  it('cửa chỉ chọn riêng khi tường không được chọn', () => {
    const f = setup();
    const door = addOpening(f, 'door', { wallId: f.walls[0]!.id, offset: 2 });
    const small = itemsInRect(f, { minX: 1, minY: -1, maxX: 3, maxY: 1 }, 'contain');
    expect(small).toEqual([{ type: 'opening', id: door.id }]);
    const all = itemsInRect(f, { minX: -1, minY: -1, maxX: 5, maxY: 1 }, 'contain');
    expect(all).toEqual([{ type: 'wall', id: f.walls[0]!.id }]);
  });

  it('chọn tất cả không gồm ô cửa và đồ thị khi ẩn', () => {
    const f = setup();
    addOpening(f, 'door', { wallId: f.walls[0]!.id, offset: 2 });
    addNavNode(f, { x: 5, y: 5 });
    expect(allItems(f)).toHaveLength(3);
    expect(allItems(f, { nav: true })).toHaveLength(4);
  });
});

describe('xoay / lật', () => {
  it('xoay 90° quanh tâm hộp bao, kéo theo tường nối vào', () => {
    const { floor, a, b } = lFloor();
    const before = selectionBounds(floor, [{ type: 'wall', id: a.id }])!;
    transformItems(floor, [{ type: 'wall', id: a.id }], 'rotate');
    const wa = floor.walls.find((w) => w.id === a.id)!;
    const wb = floor.walls.find((w) => w.id === b.id)!;
    const cx = (before.minX + before.maxX) / 2;
    const cy = (before.minY + before.maxY) / 2;
    // Tường ngang thành tường dọc qua cùng tâm.
    expect(wa.start.x).toBeCloseTo(cx);
    expect(wa.end.x).toBeCloseTo(cx);
    expect(Math.abs(wa.end.y - wa.start.y)).toBeCloseTo(before.maxX - before.minX);
    expect((wa.start.y + wa.end.y) / 2).toBeCloseTo(cy);
    // Đầu tường b nối với a đi theo.
    expect(endpointsAt(floor, wa.end).some((r) => r.wallId === wb.id)).toBe(true);
  });

  it('lật ngang hai lần trả về như cũ', () => {
    const f = emptyFloor();
    const room = addRoom(
      f,
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 1, y: 2 },
      ],
      { name: 'P' },
    );
    const ref = [{ type: 'room' as const, id: room.id }];
    const original = structuredClone(room.polygon);
    transformItems(f, ref, 'flipX');
    expect(f.rooms[0]!.polygon[0]).toEqual({ x: 4, y: 0 });
    transformItems(f, ref, 'flipX');
    expect(f.rooms[0]!.polygon).toEqual(original);
  });
});

describe('mốc & điểm đích đến', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ];

  it('thêm, chọn, kéo, xoá mốc', () => {
    const floor = emptyFloor();
    const l = addLandmark(floor, { x: 10, y: 10 }, { name: 'ATM', kind: 'atm' });
    expect(hitTest(floor, { x: 10.1, y: 10 }, 0.2)).toEqual({ type: 'landmark', id: l.id });
    expect(allItems(floor)).toContainEqual({ type: 'landmark', id: l.id });
    const refs = [{ type: 'landmark' as const, id: l.id }];
    applyDrag(floor, makeDragPlan(floor, refs), { x: 2, y: -1 });
    expect(floor.landmarks![0]!.position).toEqual({ x: 12, y: 9 });
    expect(selectionBounds(floor, refs)).toEqual({ minX: 12, minY: 9, maxX: 12, maxY: 9 });
    deleteItems(floor, refs);
    expect(floor.landmarks).toHaveLength(0);
  });

  it('copy/dán mốc cùng phòng, điểm đích đi theo phòng', () => {
    const floor = emptyFloor();
    const room = addRoom(floor, square, { name: 'P' });
    expect(setRoomDestination(floor, room.id, { x: 1, y: 1 })).toBe(true);
    const l = addLandmark(floor, { x: 2, y: 2 }, { name: 'Ghế chờ', kind: 'waiting' });
    const refs = [
      { type: 'room' as const, id: room.id },
      { type: 'landmark' as const, id: l.id },
    ];
    const clip = copyItems(floor, refs)!;
    const created = pasteItems(floor, clip, { x: 10, y: 0 });
    expect(created.map((r) => r.type)).toEqual(['room', 'landmark']);
    expect(floor.rooms[1]!.destination).toEqual({ x: 11, y: 1 });
    expect(floor.landmarks![1]!.position).toEqual({ x: 12, y: 2 });

    applyDrag(floor, makeDragPlan(floor, [refs[0]!]), { x: 0, y: 1 });
    expect(floor.rooms[0]!.destination).toEqual({ x: 1, y: 2 });
  });

  it('không nhận điểm đích nằm ngoài phòng; bỏ điểm đích', () => {
    const floor = emptyFloor();
    const room = addRoom(floor, square, { name: 'P' });
    expect(setRoomDestination(floor, room.id, { x: 9, y: 9 })).toBe(false);
    expect(floor.rooms[0]!.destination).toBeUndefined();
    setRoomDestination(floor, room.id, { x: 2, y: 2 });
    setRoomDestination(floor, room.id, undefined);
    expect(floor.rooms[0]!.destination).toBeUndefined();
  });

  it('đặt tên mặc định theo loại, đánh số khi trùng', () => {
    const b = createSampleBuilding();
    expect(nextLandmarkName(b, 'atm', 'ATM')).toBe('ATM 2');
    expect(nextLandmarkName(b, 'pharmacy', 'Quầy thuốc')).toBe('Quầy thuốc');
  });
});

describe('độ cao toà', () => {
  const floors = (): Floor[] =>
    [-1, 1, 2, 3].map((level) => ({
      ...emptyFloor(),
      id: `f${level}`,
      level,
      elevation: level < 0 ? -3 : (level - 1) * 3,
    }));

  it('đổi chiều cao tầng: xếp lại cao độ các tầng quanh tầng mốc', () => {
    const b = { ...createSampleBuilding(), floors: floors() };
    restackFloors(b, { floorHeight: 4 });
    const el = Object.fromEntries(b.floors.map((f) => [f.level, f.elevation]));
    expect(el).toEqual({ '-1': -4, 1: 0, 2: 4, 3: 8 });
    expect(buildingHeights(b)).toEqual({ baseElevation: 0, total: 16, floorHeight: 4 });
  });

  it('đổi cao độ sàn tầng mốc: cả toà nâng lên theo', () => {
    const b = { ...createSampleBuilding(), floors: floors() };
    restackFloors(b, { baseElevation: 1.5 });
    expect(b.floors.map((f) => f.elevation)).toEqual([-1.5, 1.5, 4.5, 7.5]);
  });

  it('xoá toàn bộ: giữ các tầng, bỏ hết nội dung vẽ', () => {
    const b = createSampleBuilding();
    const n = b.floors.length;
    clearBuilding(b);
    expect(b.floors).toHaveLength(n);
    for (const f of b.floors) {
      expect(f.walls.length + f.openings.length + f.rooms.length + f.connectors.length).toBe(0);
      expect(f.navGraph.nodes).toHaveLength(0);
    }
  });
});
