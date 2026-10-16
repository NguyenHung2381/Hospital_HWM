import { beforeEach, describe, expect, it } from 'vitest';
import { createSampleAnnex, createSampleBuilding } from '@hwn/map-core/sample';
import { addWall } from './ops';
import { dirtyIds, useEditor } from './store';
import { editorCommands } from './useShortcuts';
import { mapVector, selectionCount } from './workspace';

const s = () => useEditor.getState();
const main = createSampleBuilding();
const annex = createSampleAnnex();
const annexFloor = annex.floors[0]!;

beforeEach(() => {
  s().load(createSampleBuilding());
  s().adopt(createSampleAnnex());
  s().setFrames({});
});

describe('sửa nhiều toà cùng lúc', () => {
  it('nạp thêm toà khác mà không đổi toà đang mở, không tạo lịch sử', () => {
    expect(Object.keys(s().drafts).sort()).toEqual([annex.id, main.id].sort());
    expect(s().activeId).toBe(main.id);
    expect(s().past).toHaveLength(0);
    expect(s().dirty).toBe(false);
  });

  it('chuyển toà giữ bản nháp và lịch sử; Hoàn tác đi qua mọi toà', () => {
    s().edit((_, f) => void addWall(f, { x: 0, y: 40 }, { x: 5, y: 40 }, { thickness: 0.2 }));
    s().activate(annex.id);
    expect(s().building!.id).toBe(annex.id);
    expect(s().dirty).toBe(true); // toà chính vẫn còn thay đổi chưa lưu
    s().edit((_, f) => void addWall(f, { x: 0, y: 40 }, { x: 5, y: 40 }, { thickness: 0.2 }));
    expect(dirtyIds(s()).sort()).toEqual([annex.id, main.id].sort());
    s().undo();
    expect(dirtyIds(s())).toEqual([main.id]);
    s().undo();
    expect(s().dirty).toBe(false);
    s().redo();
    expect(dirtyIds(s())).toEqual([main.id]);
  });

  it('nạp lại bản mới từ server chỉ khi toà chưa sửa gì', () => {
    s().adopt({ ...createSampleAnnex(), name: 'Mới', version: annex.version + 1 });
    expect(s().drafts[annex.id]!.name).toBe('Mới');
    s().editMany((d) => void (d[annex.id]!.name = 'Đang sửa'));
    s().adopt({ ...createSampleAnnex(), name: 'Mới hơn', version: annex.version + 2 });
    expect(s().drafts[annex.id]!.name).toBe('Đang sửa');
  });

  it('chọn trên nhiều toà; Delete xoá ở mọi toà trong một bước', () => {
    const mainWall = s().building!.floors[0]!.walls[0]!.id;
    const annexWall = annexFloor.walls[0]!.id;
    s().select([{ type: 'wall', id: mainWall }]);
    s().selectPeer(annex.id, annexFloor.id, [{ type: 'wall', id: annexWall }], 'toggle');
    expect(selectionCount(s())).toBe(2);
    editorCommands.delete();
    expect(s().drafts[main.id]!.floors[0]!.walls.some((w) => w.id === mainWall)).toBe(false);
    expect(s().drafts[annex.id]!.floors[0]!.walls.some((w) => w.id === annexWall)).toBe(false);
    expect(s().past).toHaveLength(1);
    expect(selectionCount(s())).toBe(0);
    s().undo();
    expect(s().dirty).toBe(false);
  });

  it('chuyển toà mà giữ vùng chọn: toà cũ thành phần chọn "toà khác"', () => {
    const mainWall = s().building!.floors[0]!.walls[0]!.id;
    const annexWall = annexFloor.walls[0]!.id;
    s().select([{ type: 'wall', id: mainWall }]);
    s().selectPeer(annex.id, annexFloor.id, [{ type: 'wall', id: annexWall }]);
    s().activate(annex.id, { floorId: annexFloor.id, keepSelection: true });
    expect(s().selection).toEqual([{ type: 'wall', id: annexWall }]);
    expect(s().peerSelection[main.id]?.refs).toEqual([{ type: 'wall', id: mainWall }]);
    // Click thường (thay vùng chọn) thì bỏ phần chọn ở toà khác.
    s().select([]);
    expect(selectionCount(s())).toBe(0);
  });

  it('dịch vùng chọn trên toà xoay theo đúng hướng mặt bằng', () => {
    s().setFrames({
      [main.id]: { position: { x: 0, y: 0 }, rotation: 0 },
      [annex.id]: { position: { x: 100, y: 0 }, rotation: 90 },
    });
    const wall = annexFloor.walls[0]!;
    s().selectPeer(annex.id, annexFloor.id, [{ type: 'wall', id: wall.id }]);
    editorCommands.nudge(1, 0); // sang phải 1 ô (0.5 m) theo hướng toà chính
    const moved = s().drafts[annex.id]!.floors[0]!.walls.find((w) => w.id === wall.id)!;
    // Toà phụ xoay 90° chiều kim đồng hồ: "sang phải" trên mặt bằng = "lên trên" trong toà.
    expect(moved.start.x).toBeCloseTo(wall.start.x);
    expect(moved.start.y).toBeCloseTo(wall.start.y - 0.5);
    expect(
      mapVector({ position: { x: 0, y: 0 }, rotation: 90 }, undefined, { x: 1, y: 0 }).y,
    ).toBeCloseTo(1);
  });

  it('lưu xong một toà chỉ toà đó hết "chưa lưu"', () => {
    s().editMany((d) => {
      d[main.id]!.name = 'A';
      d[annex.id]!.name = 'B';
    });
    s().markSaved(s().drafts[annex.id]!, annex.version + 1, '2026-10-03T00:00:00.000Z');
    expect(dirtyIds(s())).toEqual([main.id]);
    expect(s().versions[annex.id]).toBe(annex.version + 1);
  });

  it('bỏ một toà khỏi editor thì bỏ luôn lịch sử của toà đó', () => {
    s().editMany((d) => void (d[annex.id]!.name = 'B'));
    s().forget(annex.id);
    expect(s().past).toHaveLength(0);
    expect(s().drafts[annex.id]).toBeUndefined();
  });
});
