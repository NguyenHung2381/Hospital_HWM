import { describe, expect, it } from 'vitest';
import type { Campus, SiteLobby } from '@hwn/map-core';
import {
  addArea,
  addLobby,
  dragLobbyHandle,
  addGate,
  addLink,
  addPath,
  addPoi,
  applyGroupMove,
  applyMove,
  clearSite,
  deleteItem,
  deleteItems,
  findLink,
  groupOrigin,
  hitSite,
  hitVertex,
  insertParts,
  magnetToRoad,
  moveOrigin,
  patchItem,
  removeVertex,
  rotateItems,
  selectionCenter,
  setVertex,
  siteItemsInBox,
  snapToSitePath,
  snapToSiteVertex,
  toggleRef,
  unlinkedEntrances,
} from './siteOps';

const base = (): Campus => ({ id: 'c', name: 'C', buildings: [], version: 1, updatedAt: '' });

describe('thao tác ngoài trời', () => {
  it('thêm khu vực, đường, cổng, điểm, cầu nối (không sửa bản cũ)', () => {
    const c0 = base();
    const [c1, areaId] = addArea(c0, 'parking', [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    const [c2, pathId] = addPath(c1, 'covered', [
      { x: 0, y: 20 },
      { x: 30, y: 20 },
    ]);
    const [c3] = addGate(c2, 'both', { x: -5, y: 0 });
    const [c4] = addPoi(c3, 'atm', { x: 5, y: 25 }, 'ATM');
    const [c5] = addLink(
      c4,
      { buildingId: 'a', floorId: 'fa', openingId: 'oa' },
      { buildingId: 'b', floorId: 'fb', openingId: 'ob' },
    );
    expect(c0.site).toBeUndefined();
    expect(c5.site!.areas[0]!.id).toBe(areaId);
    expect(c5.site!.paths[0]).toMatchObject({ id: pathId, width: 3 });
    expect(c5.site!.gates[0]!.name).toBe('Cổng chính');
    expect(c5.links![0]!.name).toBe('Cầu nối 1');
  });

  it('sửa, kéo, dời đỉnh, xoá đỉnh, xoá đối tượng', () => {
    const [c1, pathId] = addPath(base(), 'pedestrian', [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    const c2 = patchItem(c1, 'path', pathId, { name: 'Lối A', oneWay: true });
    expect(c2.site!.paths[0]).toMatchObject({ name: 'Lối A', oneWay: true });

    const origin = moveOrigin(c2, { type: 'path', id: pathId })!;
    const c3 = applyMove(applyMove(c2, origin, { x: 1, y: 1 }), origin, { x: 2, y: 0 });
    expect(c3.site!.paths[0]!.points[0]).toEqual({ x: 2, y: 0 });

    const c4 = setVertex(c3, 'path', pathId, 1, { x: 50, y: 50 });
    expect(c4.site!.paths[0]!.points[1]).toEqual({ x: 50, y: 50 });
    const c5 = removeVertex(c4, 'path', pathId, 1);
    expect(c5.site!.paths[0]!.points).toHaveLength(2);
    expect(removeVertex(c5, 'path', pathId, 0)).toBe(c5); // tối thiểu 2 điểm
    expect(deleteItem(c5, { type: 'path', id: pathId }).site!.paths).toEqual([]);
  });

  it('chọn theo thứ tự ưu tiên và chọn đỉnh', () => {
    const [c1] = addArea(base(), 'green', [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ]);
    const [c2, pathId] = addPath(c1, 'pedestrian', [
      { x: 0, y: 10 },
      { x: 20, y: 10 },
    ]);
    const [c, poiId] = addPoi(c2, 'shop', { x: 15, y: 10 }, 'Ki-ốt');
    expect(hitSite(c, { x: 15, y: 10.2 }, 0.5)).toEqual({ type: 'poi', id: poiId });
    expect(hitSite(c, { x: 5, y: 10.5 }, 0.5)?.type).toBe('path');
    expect(hitSite(c, { x: 5, y: 5 }, 0.5)?.type).toBe('area');
    expect(hitSite(c, { x: 50, y: 50 }, 0.5)).toBeNull();
    expect(hitVertex(c, { type: 'path', id: pathId }, { x: 19.8, y: 10 }, 0.5)).toBe(1);
  });

  it('bắt dính vào đỉnh có sẵn hoặc điểm thêm', () => {
    const [c] = addPath(base(), 'pedestrian', [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(snapToSiteVertex(c, { x: 9.6, y: 0.2 }, 1)).toEqual({ x: 10, y: 0 });
    expect(snapToSiteVertex(c, { x: 30, y: 0 }, 1, [{ x: 30.5, y: 0 }])).toEqual({ x: 30.5, y: 0 });
    expect(snapToSiteVertex(c, { x: 5, y: 5 }, 1)).toBeNull();
  });

  it('cảnh báo cửa chính chưa nối lối đi', () => {
    const entrances = [
      { buildingId: 'a', openingId: 'o1', site: { x: 0, y: 1 } },
      { buildingId: 'b', openingId: 'o2', site: { x: 100, y: 100 } },
    ];
    expect(unlinkedEntrances(base(), entrances)).toHaveLength(2);
    const [c] = addPath(base(), 'pedestrian', [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(unlinkedEntrances(c, entrances)).toEqual([{ buildingId: 'b', openingId: 'o2' }]);
    // Đường xe không tính là lối đi bộ.
    const [road] = addPath(base(), 'vehicle', [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(unlinkedEntrances(road, entrances)).toHaveLength(2);
  });

  it('tìm cầu nối trùng theo cả hai chiều và xoá toàn bộ ngoài trời', () => {
    const a = { buildingId: 'A', floorId: 'fa', openingId: 'da' };
    const b = { buildingId: 'B', floorId: 'fb', openingId: 'db' };
    const [c1, id] = addLink(base(), a, b);
    expect(findLink(c1, b, a)?.id).toBe(id);
    expect(findLink(c1, a, { ...b, openingId: 'x' })).toBeUndefined();
    const [c2] = addPath(c1, 'pedestrian', [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
    const cleared = clearSite(c2);
    expect(cleared.links).toEqual([]);
    expect(cleared.site?.paths).toEqual([]);
  });
});

describe('sắp xếp nhóm đối tượng ngoài trời', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const setup = () => {
    const c0: Campus = {
      ...base(),
      buildings: [{ buildingId: 'b1', position: { x: 20, y: 0 }, rotation: 0 }],
    };
    const [c1, areaId] = addArea(c0, 'parking', square);
    const [c, gateId] = addGate(c1, 'both', { x: 5, y: 20 });
    return { c, areaId, gateId };
  };
  const footprintOf = () => square;

  it('bật / tắt đối tượng trong vùng chọn', () => {
    const a = { type: 'area' as const, id: 'a' };
    expect(toggleRef([], a)).toEqual([a]);
    expect(toggleRef([a], a)).toEqual([]);
  });

  it('dời cả nhóm (khu vực + cổng + toà) tính từ vị trí gốc', () => {
    const { c, areaId, gateId } = setup();
    const refs = [
      { type: 'area' as const, id: areaId },
      { type: 'gate' as const, id: gateId },
      { type: 'building' as const, id: 'b1' },
    ];
    const origin = groupOrigin(c, refs);
    const once = applyGroupMove(c, origin, { x: 1, y: 0 });
    const twice = applyGroupMove(once, origin, { x: 3, y: 2 });
    expect(twice.site!.areas[0]!.polygon[0]).toEqual({ x: 3, y: 2 });
    expect(twice.site!.gates[0]!.position).toEqual({ x: 8, y: 22 });
    expect(twice.buildings[0]!.position).toEqual({ x: 23, y: 2 });
  });

  it('xoay nhóm quanh tâm: khu vực xoay đỉnh, toà đổi cả vị trí lẫn góc', () => {
    const { c, areaId } = setup();
    const refs = [
      { type: 'area' as const, id: areaId },
      { type: 'building' as const, id: 'b1' },
    ];
    const pivot = selectionCenter(c, refs, footprintOf)!;
    expect(pivot).toEqual({ x: 15, y: 5 });
    const r = rotateItems(c, refs, pivot, 90);
    expect(r.buildings[0]!.rotation).toBe(90);
    // Đỉnh (0,0) của khu vực quay 90° chiều kim đồng hồ quanh (15,5) → (20,-10).
    expect(r.site!.areas[0]!.polygon[0]!.x).toBeCloseTo(20);
    expect(r.site!.areas[0]!.polygon[0]!.y).toBeCloseTo(-10);
    // Toà quay cùng nhóm: góc toà (0,0) trên mặt bằng (20,0) → (20,0) quanh (15,5) = (20,10).
    const pl = r.buildings[0]!;
    expect(pl.position.x).toBeCloseTo(20);
    expect(pl.position.y).toBeCloseTo(10);
    // Xoay ngược lại thì về như cũ.
    const back = rotateItems(r, refs, pivot, -90);
    expect(back.site!.areas[0]!.polygon[2]!.x).toBeCloseTo(10);
    expect(back.buildings[0]!.rotation).toBe(0);
  });

  it('chọn theo khung: nằm gọn (trái → phải) hoặc chạm (phải → trái)', () => {
    const { c, areaId, gateId } = setup();
    const box = { minX: -1, minY: -1, maxX: 11, maxY: 21 };
    expect(siteItemsInBox(c, box, 'contain', footprintOf)).toEqual([
      { type: 'area', id: areaId },
      { type: 'gate', id: gateId },
    ]);
    const touch = { minX: 4, minY: 4, maxX: 6, maxY: 6 }; // nằm trong khu vực
    expect(siteItemsInBox(c, touch, 'contain', footprintOf)).toEqual([]);
    expect(siteItemsInBox(c, touch, 'cross', footprintOf)).toEqual([{ type: 'area', id: areaId }]);
  });

  it('xoá nhóm bỏ qua toà', () => {
    const { c, areaId, gateId } = setup();
    const next = deleteItems(c, [
      { type: 'area', id: areaId },
      { type: 'gate', id: gateId },
      { type: 'building', id: 'b1' },
    ]);
    expect(next.site!.areas).toHaveLength(0);
    expect(next.site!.gates).toHaveLength(0);
    expect(next.buildings).toHaveLength(1);
  });
});

describe('nối đường kiểu Cities: Skylines', () => {
  const road = {
    id: 'r',
    kind: 'vehicle' as const,
    width: 7,
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 50 },
    ],
  };

  it('bắt dính vào tim đường khác để tạo ngã ba (trừ chính đường đang sửa)', () => {
    const [c] = addPath(base(), 'vehicle', road.points, 'r');
    expect(snapToSitePath(c, { x: 0.6, y: 20 }, 1)).toEqual({ x: 0, y: 20 });
    expect(snapToSitePath(c, { x: 3, y: 20 }, 1)).toBeNull();
    expect(snapToSitePath(c, { x: 0.6, y: 20 }, 1, 'r')).toBeNull();
  });

  it('kéo toà gần đường: chân dốc hút vào tim làn bên phía nó', () => {
    // Đường hai chiều rộng 7 m: tim làn phía đông ở x = 1.75.
    const pull = magnetToRoad([{ x: 3, y: 10 }], [road], 2)!;
    expect(pull.x).toBeCloseTo(-1.25);
    expect(pull.y).toBeCloseTo(0);
    // Đường một chiều: hút vào tim đường.
    expect(magnetToRoad([{ x: 1, y: 10 }], [{ ...road, oneWay: true }], 2)!.x).toBeCloseTo(-1);
    // Xa quá thì không hút.
    expect(magnetToRoad([{ x: 12, y: 10 }], [road], 2)).toBeNull();
  });

  it('chèn cả cụm sảnh dựng sẵn vào phần ngoài trời', () => {
    const c = insertParts(base(), {
      areas: [{ id: 'a', kind: 'plaza', polygon: [] }],
      paths: [{ ...road, id: 'p' }],
    });
    expect(c.site?.areas.map((a) => a.id)).toEqual(['a']);
    expect(c.site?.paths.map((p) => p.id)).toEqual(['p']);
  });

  /** Sảnh 10 × 6 m trước tường y = 0, nhìn ra phía nam: cạnh trái ở x = 5, cạnh phải ở x = −5. */
  const lobby: SiteLobby = {
    id: 'L',
    position: { x: 0, y: 0 },
    outward: { x: 0, y: 1 },
    width: 10,
    depth: 6,
    edges: { front: { kind: 'steps' } },
  };

  it('sảnh là một đối tượng: click vào bệ hay bậc đều chọn sảnh; dời, xoay, xoá cả sảnh', () => {
    const c = addLobby(base(), lobby);
    expect(hitSite(c, { x: 0, y: 3 }, 0.1)).toEqual({ type: 'lobby', id: 'L' });
    // Bậc thang cạnh trước (y 6 → 7.05).
    expect(hitSite(c, { x: 4, y: 6.8 }, 0.1)).toEqual({ type: 'lobby', id: 'L' });
    expect(hitSite(c, { x: 0, y: 9 }, 0.1)).toBeNull();

    const moved = applyMove(c, moveOrigin(c, { type: 'lobby', id: 'L' })!, { x: 2, y: 1 });
    expect(moved.site?.lobbies?.[0]!.position).toEqual({ x: 2, y: 1 });

    const turned = rotateItems(c, [{ type: 'lobby', id: 'L' }], { x: 0, y: 0 }, 90);
    const t = turned.site!.lobbies![0]!;
    expect(t.outward.x).toBeCloseTo(-1);
    expect(t.outward.y).toBeCloseTo(0);

    expect(
      siteItemsInBox(c, { minX: -6, minY: -1, maxX: 6, maxY: 7 }, 'contain', () => undefined),
    ).toContainEqual({ type: 'lobby', id: 'L' });
    expect(selectionCenter(c, [{ type: 'lobby', id: 'L' }], () => undefined)).toEqual({
      x: 0,
      y: 3,
    });
    expect(deleteItem(c, { type: 'lobby', id: 'L' }).site?.lobbies).toEqual([]);
  });

  it('kéo tay nắm: cạnh trước đổi chiều sâu, cạnh bên đổi bề ngang (cạnh đối diện đứng yên)', () => {
    expect(dragLobbyHandle(lobby, 'front', { x: 1, y: 8.2 }, 0.5)).toEqual({ depth: 8 });
    // Kéo cạnh trái (x = 5) ra x = 7: rộng 12 m, cạnh phải vẫn ở x = −5 → tâm dời sang x = 1.
    const wide = dragLobbyHandle(lobby, 'left', { x: 7.1, y: 3 }, 0.5);
    expect(wide.width).toBe(12);
    expect(wide.position).toEqual({ x: 1, y: 0 });
    // Không nhỏ hơn kích thước tối thiểu.
    expect(dragLobbyHandle(lobby, 'right', { x: 9, y: 3 }, 0).width).toBe(2);
  });
});
