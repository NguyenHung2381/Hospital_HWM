import { describe, expect, it } from 'vitest';
import { findRoute, type Opening, type Wall } from '@hwn/map-core';
import { createSampleBuilding } from '@hwn/map-core/sample';
import {
  pointAlong,
  routeFloorIds,
  routeSegmentsOnFloor,
  routeStepGeometry,
  routeTrack,
  slicePolyline,
  stepIndexAt,
} from './route';
import { withAlpha } from './theme';
import {
  fitTransform,
  floorBounds,
  rotateAt,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from './viewport';
import { layoutWall, segmentQuad } from './walls';

const wall: Wall = {
  id: 'w',
  start: { x: 0, y: 0 },
  end: { x: 10, y: 0 },
  thickness: 0.2,
  height: 3,
};
const opening = (id: string, type: Opening['type'], offset: number, width: number): Opening => ({
  id,
  type,
  wallId: 'w',
  offset,
  width,
  height: 2,
  sillHeight: 0,
});

describe('layoutWall', () => {
  it('chia tường thành các đoạn đặc và ô cửa theo thứ tự', () => {
    const segments = layoutWall(wall, [
      opening('win', 'window', 7, 2),
      opening('door', 'door', 2, 1),
    ]);
    expect(segments.map((s) => [s.kind, s.from, s.to])).toEqual([
      ['solid', 0, 1.5],
      ['door', 1.5, 2.5],
      ['solid', 2.5, 6],
      ['window', 6, 8],
      ['solid', 8, 10],
    ]);
    expect(segments[1]!.start).toEqual({ x: 1.5, y: 0 });
  });

  it('kẹp ô cửa vượt ra ngoài tường và cắt ô cửa chồng nhau', () => {
    const segments = layoutWall(wall, [opening('a', 'door', 0.2, 1), opening('b', 'door', 0.8, 1)]);
    expect(segments.map((s) => [s.kind, s.from, s.to])).toEqual([
      ['door', 0, 0.7],
      ['door', 0.7, 1.3],
      ['solid', 1.3, 10],
    ]);
  });

  it('bỏ qua ô cửa của tường khác', () => {
    expect(layoutWall(wall, [{ ...opening('x', 'door', 5, 1), wallId: 'khac' }])).toHaveLength(1);
  });
});

describe('segmentQuad', () => {
  it('kéo dài đầu tường để khép góc nhưng không kéo dài cạnh ô cửa', () => {
    const [solid, door] = layoutWall(wall, [opening('d', 'door', 5, 2)]);
    expect(segmentQuad(wall, solid!)).toEqual([
      { x: -0.1, y: 0.1 },
      { x: 4, y: 0.1 },
      { x: 4, y: -0.1 },
      { x: -0.1, y: -0.1 },
    ]);
    const doorQuad = segmentQuad(wall, door!);
    expect(doorQuad[0]!.x).toBe(4);
    expect(doorQuad[1]!.x).toBe(6);
  });
});

describe('viewport', () => {
  it('căn khung vừa kích thước và giữ đúng tỉ lệ', () => {
    const t = fitTransform({ minX: 0, minY: 0, maxX: 40, maxY: 20 }, 840, 640, 20);
    expect(t.scale).toBe(20);
    expect(worldToScreen(t, { x: 0, y: 0 })).toEqual({ x: 20, y: 120 });
    expect(worldToScreen(t, { x: 40, y: 20 })).toEqual({ x: 820, y: 520 });
  });

  it('zoom quanh con trỏ giữ nguyên điểm dưới con trỏ', () => {
    const t = { x: 10, y: 20, scale: 5 };
    const anchor = { x: 300, y: 200 };
    const before = screenToWorld(t, anchor);
    const after = screenToWorld(zoomAt(t, anchor, 12), anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('tính khung bao của tầng mẫu', () => {
    const floor = createSampleBuilding().floors[0]!;
    expect(floorBounds(floor)).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 20 });
  });
});

describe('route helpers', () => {
  it('lọc đoạn tuyến theo tầng và đánh dấu đầu/cuối', () => {
    const building = createSampleBuilding();
    const route = findRoute(
      building,
      { floorId: 'floor_1', position: { x: 1, y: 10 } },
      { roomId: 'floor_2_room_top0' },
    )!;
    expect(routeFloorIds(route)).toEqual(['floor_1', 'floor_2']);
    const [f1] = routeSegmentsOnFloor(route, 'floor_1');
    const [f2] = routeSegmentsOnFloor(route, 'floor_2');
    expect(f1).toMatchObject({ isFirst: true, isLast: false });
    expect(f2).toMatchObject({ isFirst: false, isLast: true, arrivedFromFloorId: 'floor_1' });
    expect(f2!.start).toBeCloseTo(f1!.end);
  });

  const L = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 5 },
  ];

  it('pointAlong trả về điểm và hướng đi, kẹp ngoài phạm vi', () => {
    expect(pointAlong(L, 4)).toEqual({ point: { x: 4, y: 0 }, heading: 0 });
    expect(pointAlong(L, 12)).toEqual({ point: { x: 10, y: 2 }, heading: 90 });
    expect(pointAlong(L, 99).point).toEqual({ x: 10, y: 5 });
    expect(pointAlong(L, -1).point).toEqual({ x: 0, y: 0 });
  });

  it('slicePolyline giữ các góc nằm giữa hai đầu cắt', () => {
    expect(slicePolyline(L, 8, 12)).toEqual([
      { x: 8, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 2 },
    ]);
  });

  it('gắn hình học cho từng bước, khớp góc rẽ và chuyển đoạn khi đi thang', () => {
    const building = createSampleBuilding();
    const route = findRoute(
      building,
      { floorId: 'floor_1', position: { x: 1, y: 10 } },
      { roomId: 'floor_2_room_bot2' },
    )!;
    const track = routeTrack(route);
    const steps = routeStepGeometry(route);
    expect(steps).toHaveLength(route.instructions.length);
    steps.forEach((s, i) => expect(s.floorId).toBe(route.instructions[i]!.floorId));

    const turn = steps.findIndex((s) => s.type === 'turn-left' || s.type === 'turn-right');
    const leg = steps[turn - 1]!;
    expect(leg.type).toBe('straight');
    // Chặng đi thẳng kết thúc đúng tại góc rẽ, góc rẽ là điểm neo của bước rẽ.
    expect(leg.anchor).toEqual(steps[turn]!.anchor);
    expect(track[0]!.path).toContainEqual(steps[turn]!.anchor);

    const take = steps.findIndex((s) => s.type.startsWith('take-'));
    expect(steps[take]!.anchor).toEqual(track[0]!.path.at(-1));
    expect(steps[take + 1]!.segmentIndex).toBe(1);
    expect(steps.at(-1)!.anchor).toEqual(track.at(-1)!.path.at(-1));
  });

  it('stepIndexAt báo trước thao tác sắp tới', () => {
    const building = createSampleBuilding();
    const route = findRoute(
      building,
      { floorId: 'floor_1', position: { x: 1, y: 10 } },
      { roomId: 'floor_2_room_bot2' },
    )!;
    const steps = routeStepGeometry(route);
    const turn = steps.findIndex((s) => s.type === 'turn-left' || s.type === 'turn-right');
    const at = steps[turn]!.begin;
    expect(stepIndexAt(steps, 0, 0)).toBe(turn - 1);
    expect(stepIndexAt(steps, 0, at - 2)).toBe(turn);
    expect(stepIndexAt(steps, 0, at + 2)).toBe(turn + 1);
    const track = routeTrack(route);
    expect(steps[stepIndexAt(steps, 0, track[0]!.end)]!.type).toMatch(/^take-/);
    expect(steps[stepIndexAt(steps, 1, track[1]!.end)]!.type).toBe('arrive');
  });
});

it('withAlpha chuyển hex sang rgba', () => {
  expect(withAlpha('#3b82f6', 0.5)).toBe('rgba(59, 130, 246, 0.5)');
  expect(withAlpha('red', 0.5)).toBe('red');
});

describe('khung nhìn xoay', () => {
  const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    expect(a.x).toBeCloseTo(b.x);
    expect(a.y).toBeCloseTo(b.y);
  };

  it('xoay 90° quanh tâm màn hình: trục +x của bản đồ hướng xuống', () => {
    const t = rotateAt({ x: 0, y: 0, scale: 10 }, { x: 100, y: 100 }, 90);
    close(worldToScreen(t, { x: 10, y: 10 }), { x: 100, y: 100 });
    close(worldToScreen(t, { x: 11, y: 10 }), { x: 100, y: 110 });
    close(screenToWorld(t, worldToScreen(t, { x: 3, y: -7 })), { x: 3, y: -7 });
  });

  it('zoom giữ góc xoay và điểm dưới con trỏ', () => {
    const t = { x: 40, y: 20, scale: 8, rotation: -90 };
    const anchor = { x: 120, y: 60 };
    const z = zoomAt(t, anchor, 20);
    expect(z.rotation).toBe(-90);
    close(screenToWorld(z, anchor), screenToWorld(t, anchor));
  });

  it('căn khung theo hộp bao sau khi xoay', () => {
    // Vùng 40×20 xoay 90° thành 20×40 trên màn hình 400×400 => tỉ lệ 10 px/m.
    const t = fitTransform({ minX: 0, minY: 0, maxX: 40, maxY: 20 }, 400, 400, 0, 90);
    expect(t.scale).toBeCloseTo(10);
    close(worldToScreen(t, { x: 20, y: 10 }), { x: 200, y: 200 });
  });
});
