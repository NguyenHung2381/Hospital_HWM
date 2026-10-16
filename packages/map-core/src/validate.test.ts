import { describe, expect, it } from 'vitest';
import { createSampleBuilding } from './sample';
import { validateBuilding } from './validate';

describe('validateBuilding', () => {
  it('dữ liệu mẫu hợp lệ và không có cảnh báo', () => {
    const result = validateBuilding(createSampleBuilding());
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('báo lỗi cửa nằm ngoài tường và cửa không có tường', () => {
    const building = createSampleBuilding();
    const floor = building.floors[0]!;
    floor.openings[0]!.offset = 1000;
    floor.openings[1]!.wallId = 'khong_ton_tai';
    const codes = validateBuilding(building).issues.map((i) => i.code);
    expect(codes).toContain('OPENING_OUT_OF_WALL');
    expect(codes).toContain('OPENING_MISSING_WALL');
  });

  it('báo lỗi tầng trùng số thứ tự và phòng thuộc khoa không tồn tại', () => {
    const building = createSampleBuilding();
    building.floors[1]!.level = building.floors[0]!.level;
    building.floors[0]!.rooms[0]!.departmentId = 'dept_khong_ton_tai';
    const result = validateBuilding(building);
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['DUPLICATE_LEVEL', 'UNKNOWN_DEPARTMENT']),
    );
  });

  it('cảnh báo phòng chưa có trong đồ thị và thang không nối tầng nào', () => {
    const building = createSampleBuilding();
    const floor = building.floors[0]!;
    const room = floor.rooms[0]!;
    floor.navGraph.nodes = floor.navGraph.nodes.filter((n) => n.refId !== room.id);
    floor.navGraph.edges = floor.navGraph.edges.filter(
      (e) =>
        floor.navGraph.nodes.some((n) => n.id === e.to) &&
        floor.navGraph.nodes.some((n) => n.id === e.from),
    );
    building.floors[1]!.connectors[0]!.linkId = 'link_moi';
    const result = validateBuilding(building);
    expect(result.valid).toBe(true);
    expect(result.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['ROOM_NOT_IN_GRAPH', 'CONNECTOR_UNLINKED']),
    );
  });

  it('cảnh báo đồ thị bị tách rời và mã phòng trùng', () => {
    const building = createSampleBuilding();
    const floor = building.floors[0]!;
    // Cắt cạnh nối phòng P.101 với cửa của nó.
    const roomNode = floor.navGraph.nodes.find((n) => n.refId === floor.rooms[0]!.id)!;
    floor.navGraph.edges = floor.navGraph.edges.filter(
      (e) => e.from !== roomNode.id && e.to !== roomNode.id,
    );
    building.floors[1]!.rooms[0]!.code = floor.rooms[1]!.code;
    const codes = validateBuilding(building).issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['NAV_DISCONNECTED', 'DUPLICATE_ROOM_CODE']));
  });
});
