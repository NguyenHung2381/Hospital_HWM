/**
 * Chọn / kéo đối tượng của tầng đang mở ngay trong cảnh 3D. Dùng chung hit test, kế hoạch kéo,
 * bắt dính lưới và lịch sử hoàn tác với khung vẽ 2D — 3D chỉ đổi điểm chuột thành toạ độ mặt bằng.
 */
import { useMemo, useRef } from 'react';
import { sub, type Point } from '@hwn/map-core';
import type { Floor3DEditor } from '@hwn/map-render/3d';
import { moveOpening, selectionOutlines, withoutLayers } from './ops';
import { hitTest, snapDelta } from './snap';
import { useCurrentFloor, useEditor } from './store';
import { sameRef, type ItemRef } from './types';
import { applyMultiDrag, makeMultiDragPlan, selectionParts, type MultiDragPlan } from './workspace';

/** Dung sai chọn (m) — điểm trúng trong 3D đã nằm ngay trên bề mặt đối tượng. */
const PICK_TOLERANCE = 0.15;
/** Ô cửa được kéo sang tường khác nằm trong khoảng này (m). */
const OPENING_REACH = 0.6;

type Drag = { kind: 'move'; start: Point; plan: MultiDragPlan } | { kind: 'opening'; id: string };

/** Đối tượng chọn được tại `p` trên tầng đang mở (bỏ các lớp đang ẩn / khoá). */
function pick(p: Point): ItemRef | null {
  const s = useEditor.getState();
  const floor = s.building?.floors.find((f) => f.id === s.floorId);
  if (!floor) return null;
  const blocked = [...s.settings.hiddenLayers, ...s.settings.lockedLayers];
  return hitTest(withoutLayers(floor, blocked), p, PICK_TOLERANCE);
}

/** Chỉ công cụ Chọn mới thao tác được trong 3D (các công cụ vẽ dùng khung 2D). */
const selecting = () => useEditor.getState().tool === 'select';

export function useFloor3DEditor(): Floor3DEditor | null {
  const floor = useCurrentFloor();
  const selection = useEditor((s) => s.selection);
  const drag = useRef<Drag | null>(null);

  return useMemo(() => {
    if (!floor) return null;
    return {
      floorId: floor.id,
      outlines: selectionOutlines(floor, selection),
      hover: (p) => selecting() && pick(p) !== null,
      down(p, evt) {
        if (!selecting()) return false;
        const hit = pick(p);
        if (!hit) return false;
        const s = useEditor.getState();
        if (evt.shiftKey) {
          s.select([hit], 'toggle');
          return false;
        }
        if (!s.selection.some((r) => sameRef(r, hit))) s.select([hit]);
        if (hit.type === 'navEdge') return false;
        const st = useEditor.getState();
        s.beginGesture();
        drag.current =
          hit.type === 'opening' && st.selection.length === 1
            ? { kind: 'opening', id: hit.id }
            : { kind: 'move', start: p, plan: makeMultiDragPlan(st.drafts, selectionParts(st)) };
        return true;
      },
      move(p) {
        const g = drag.current;
        if (!g) return;
        const s = useEditor.getState();
        if (g.kind === 'opening') {
          s.edit((_, f) => moveOpening(f, g.id, p, OPENING_REACH));
          return;
        }
        const delta = snapDelta(sub(p, g.start), s.settings.gridSize, s.settings.snapGrid);
        s.editMany((d) => applyMultiDrag(d, g.plan, delta, s.frames, s.activeId));
      },
      up() {
        if (!drag.current) return;
        drag.current = null;
        useEditor.getState().endGesture();
      },
      click(p, evt) {
        if (selecting() && !evt.shiftKey && !pick(p)) useEditor.getState().clearSelection();
      },
    };
  }, [floor, selection]);
}
