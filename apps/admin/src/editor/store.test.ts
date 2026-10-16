import { beforeEach, describe, expect, it } from 'vitest';
import { createSampleBuilding } from '@hwn/map-core/sample';
import {
  addConnector,
  addFloor,
  addWall,
  applyDrag,
  cloneConnectorToFloors,
  copyItems,
  makeDragPlan,
  pasteItems,
} from './ops';
import { useEditor } from './store';

const s = () => useEditor.getState();

beforeEach(() => {
  s().load(createSampleBuilding());
});

describe('editor store', () => {
  it('sửa gộp (kéo đỉnh sảnh / dốc): nhiều lần sửa chỉ là một bước undo', () => {
    const before = s().building!.exterior;
    s().edit((b) => {
      b.exterior = { areas: [], paths: [] };
    });
    s().edit((b) => void b.exterior!.areas.push({ id: 'a', kind: 'plaza', polygon: [] }), {
      merge: true,
    });
    s().edit((b) => void (b.exterior!.areas[0]!.name = 'Sảnh'), { merge: true });
    expect(s().past).toHaveLength(1);
    expect(s().building!.exterior!.areas[0]!.name).toBe('Sảnh');
    s().undo();
    expect(s().building!.exterior).toBe(before);
  });

  it('nạp toà nhà và chọn tầng thấp nhất', () => {
    expect(s().floorId).toBe('floor_1');
    expect(s().dirty).toBe(false);
    expect(s().serverVersion).toBe(1);
  });

  it('mỗi lần sửa là một bước undo; undo về đúng bản đã lưu thì hết "chưa lưu"', () => {
    s().edit((_, f) => {
      addWall(f, { x: 0, y: 30 }, { x: 5, y: 30 }, { thickness: 0.2 });
    });
    expect(s().dirty).toBe(true);
    expect(s().past).toHaveLength(1);
    s().undo();
    expect(s().dirty).toBe(false);
    expect(s().future).toHaveLength(1);
    s().redo();
    expect(s().dirty).toBe(true);
    expect(s().building!.floors[0]!.walls.some((w) => w.start.y === 30)).toBe(true);
  });

  it('Esc khi đang kéo trả bản nháp về như trước khi kéo, không để lại bước undo', () => {
    const before = s().building;
    const wallId = before!.floors[0]!.walls[0]!.id;
    const plan = makeDragPlan(before!.floors[0]!, [{ type: 'wall', id: wallId }]);
    s().beginGesture();
    s().edit((_, f) => applyDrag(f, plan, { x: 3, y: 0 }));
    expect(s().building).not.toBe(before);
    s().cancelGesture();
    expect(s().building).toBe(before);
    expect(s().past).toHaveLength(0);
    expect(s().gestureActive).toBe(false);
    expect(s().dirty).toBe(false);
  });

  it('một thao tác kéo dài chỉ tạo một bước undo; kéo không đổi gì thì không tạo bước nào', () => {
    const wallId = s().building!.floors[0]!.walls[0]!.id;
    const plan = makeDragPlan(s().building!.floors[0]!, [{ type: 'wall', id: wallId }]);
    s().beginGesture();
    for (let i = 1; i <= 5; i++) s().edit((_, f) => applyDrag(f, plan, { x: 0, y: i }));
    s().endGesture();
    expect(s().past).toHaveLength(1);

    s().beginGesture();
    s().endGesture();
    expect(s().past).toHaveLength(1);
  });

  it('bỏ khỏi vùng chọn đối tượng đã bị xoá khi undo', () => {
    let id = '';
    s().edit((_, f) => {
      id = addWall(f, { x: 0, y: 30 }, { x: 5, y: 30 }, { thickness: 0.2 })!.id;
    });
    s().select([{ type: 'wall', id }]);
    s().undo();
    expect(s().selection).toEqual([]);
  });

  it('lưu xong: cập nhật version server; undo về snapshot cũ vẫn gửi version mới', () => {
    s().edit((_, f) => void (f.name = 'Tầng A'));
    s().markSaved(s().building!, 2, '2026-10-02T00:00:00.000Z');
    expect(s().dirty).toBe(false);
    s().undo();
    expect(s().dirty).toBe(true);
    expect(s().building!.version).toBe(1); // snapshot cũ
    expect(s().serverVersion).toBe(2); // nhưng khi lưu sẽ gửi version này
  });

  // Các thao tác chạy bên trong produce của immer — dữ liệu là draft (Proxy), không phải object thường.
  it('thêm tầng có sao chép kết cấu, copy/dán và nhân bản thang chạy được trên draft immer', () => {
    let floorId = '';
    s().edit((b) => {
      floorId = addFloor(b, { copyStructureFrom: 'floor_1' }).id;
    });
    const added = s().building!.floors.find((f) => f.id === floorId)!;
    expect(added.walls.length).toBeGreaterThan(0);

    let connectorId = '';
    s().edit((_, f) => {
      connectorId = addConnector(f, 'elevator', { x: 50, y: 5 }, { name: 'TM mới' }).id;
    });
    s().edit((b) => {
      cloneConnectorToFloors(b, 'floor_1', connectorId, ['floor_2']);
    });
    expect(s().building!.floors[1]!.connectors.some((c) => c.name === 'TM mới')).toBe(true);

    const clip = copyItems(s().building!.floors[0]!, [{ type: 'connector', id: connectorId }])!;
    s().edit((_, f) => {
      pasteItems(f, clip, { x: 3, y: 0 });
    });
    expect(s().building!.floors[0]!.connectors.filter((c) => c.name === 'TM mới')).toHaveLength(2);
  });

  it('sửa tiếp trong lúc đang lưu thì vẫn còn "chưa lưu"', () => {
    s().edit((_, f) => void (f.name = 'A'));
    const sent = s().building!;
    s().edit((_, f) => void (f.name = 'B'));
    s().markSaved(sent, 2, '2026-10-02T00:00:00.000Z');
    expect(s().dirty).toBe(true);
    expect(s().serverVersion).toBe(2);
    expect(s().building!.floors[0]!.name).toBe('B');
  });
});
