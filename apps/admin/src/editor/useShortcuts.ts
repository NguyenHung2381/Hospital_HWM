import { useEffect, useRef, type RefObject } from 'react';
import type { MapStageHandle } from '@hwn/map-render';
import { inOverlay, isTyping, letterOf, onBackspace } from './keyboard';
import {
  allItems,
  copyItems,
  pasteItems,
  selectionBounds,
  transformItems,
  type TransformKind,
} from './ops';
import { useEditor } from './store';
import { toolForLetter } from './tools';
import { cycleVariant } from './toolVariants';
import { useTransient } from './transient';
import { isNavTool } from './types';
import {
  applyMultiDrag,
  deleteParts,
  makeMultiDragPlan,
  selectionCount,
  selectionParts,
} from './workspace';

const currentFloor = () => {
  const { building, floorId } = useEditor.getState();
  return building?.floors.find((f) => f.id === floorId);
};

/** Thực thi các lệnh chỉnh sửa — dùng chung cho phím tắt và nút bấm. */
export const editorCommands = {
  /** Xoá vùng chọn (trên mọi toà). */
  delete() {
    const s = useEditor.getState();
    const parts = selectionParts(s);
    if (!parts.length) return;
    s.editMany((d) => deleteParts(d, parts));
    s.clearSelection();
  },
  copy() {
    const { selection, setClipboard } = useEditor.getState();
    const floor = currentFloor();
    if (!floor || !selection.length) return;
    const clip = copyItems(floor, selection);
    if (clip) setClipboard(clip);
  },
  paste() {
    const { clipboard, floorId, edit, select, settings } = useEditor.getState();
    if (!clipboard) return;
    // Dán cùng tầng thì lệch đi một chút cho dễ thấy; sang tầng khác thì giữ nguyên vị trí.
    const step = Math.max(settings.gridSize, 0.5) * 2;
    const offset = clipboard.sourceFloorId === floorId ? { x: step, y: step } : { x: 0, y: 0 };
    let created: ReturnType<typeof pasteItems> = [];
    edit((_, f) => {
      created = pasteItems(f, clipboard, offset);
    });
    select(created);
  },
  duplicate() {
    editorCommands.copy();
    editorCommands.paste();
  },
  selectAll() {
    const { tool, settings, select, setTool } = useEditor.getState();
    const floor = currentFloor();
    if (!floor) return;
    const nav = settings.showNavGraph || isNavTool(tool);
    if (tool !== 'select') setTool('select');
    select(allItems(floor, { nav }));
  },
  /** Xoay 90° / lật ngang / lật dọc vùng chọn. */
  transform(kind: TransformKind) {
    const { selection, edit } = useEditor.getState();
    if (!selection.length) return;
    edit((_, f) => transformItems(f, selection, kind));
  },
  /** Dịch vùng chọn (trên mọi toà) theo số ô lưới, theo hướng của toà đang mở. */
  nudge(dx: number, dy: number) {
    const s = useEditor.getState();
    const parts = selectionParts(s);
    if (!parts.length) return;
    const step = s.settings.gridSize || 0.1;
    const delta = { x: dx * step, y: dy * step };
    s.editMany((d) => applyMultiDrag(d, makeMultiDragPlan(d, parts), delta, s.frames, s.activeId));
  },
  toggleHelp(open?: boolean) {
    const t = useTransient.getState();
    t.patch({ helpOpen: open ?? !t.helpOpen });
  },
};

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Mỗi lần bấm phím mũi tên dịch bản đồ bao nhiêu pixel (Shift = xa hơn). */
const PAN_STEP_PX = 80;

/** Phím mũi tên → di chuyển khung nhìn: ← xem phần bên trái (nội dung trôi sang phải)… */
export function panByArrow(
  stage: Pick<MapStageHandle, 'panBy'> | null,
  dir: readonly [number, number],
  fast: boolean,
) {
  const step = PAN_STEP_PX * (fast ? 3 : 1);
  stage?.panBy(-dir[0] * step, -dir[1] * step);
}

export const ARROW_DIRS = ARROWS;

const TRANSFORM_KEYS: Record<string, TransformKind> = { r: 'rotate', h: 'flipX', v: 'flipY' };

/**
 * Phím tắt chung của editor (các phím khi đang vẽ do EditorCanvas xử lý trước, ở pha capture).
 * @param onSave gọi khi bấm Ctrl+S.
 * @param stageRef khung bản đồ — cho các phím phóng to / thu nhỏ.
 * @param active false = đang ở trang Khuôn viên — chỉ còn phím trợ giúp.
 */
export function useEditorShortcuts({
  onSave,
  stageRef,
  active = true,
}: {
  onSave: () => void;
  stageRef: RefObject<MapStageHandle | null>;
  active?: boolean;
}) {
  const saveRef = useRef(onSave);
  const activeRef = useRef(active);
  useEffect(() => {
    saveRef.current = onSave;
    activeRef.current = active;
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || inOverlay(e)) return;
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const letter = letterOf(e);

      const helpKey = e.key === '?' || (e.shiftKey && e.code === 'Slash');
      if (e.key === 'F1' || (helpKey && !mod && !isTyping(e))) {
        e.preventDefault();
        editorCommands.toggleHelp();
        return;
      }
      if (!activeRef.current) return;

      if (isTyping(e)) {
        // Ctrl+S trong ô nhập: rời ô để giá trị đang gõ được ghi nhận rồi mới lưu
        // (nếu không trình duyệt sẽ mở hộp thoại "Lưu trang").
        if (mod && letter === 's') {
          e.preventDefault();
          (e.target as HTMLElement).blur();
          setTimeout(() => saveRef.current(), 0);
        }
        return;
      }

      if (mod) {
        if (e.altKey) return;
        const actions: Record<string, () => void> = {
          z: () => (e.shiftKey ? s.redo() : s.undo()),
          y: s.redo,
          c: editorCommands.copy,
          v: editorCommands.paste,
          d: editorCommands.duplicate,
          a: editorCommands.selectAll,
          s: () => saveRef.current(),
        };
        const action = letter ? actions[letter] : undefined;
        if (action) {
          e.preventDefault();
          action();
        }
        return;
      }

      if (e.key === 'Delete') {
        e.preventDefault();
        editorCommands.delete();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        onBackspace(editorCommands.delete);
        return;
      }
      if (e.key === 'Escape') {
        if (selectionCount(s)) s.clearSelection();
        else s.setTool('select');
        return;
      }

      // Khung nhìn.
      const stage = stageRef.current;
      const dir = ARROWS[e.key];
      if (dir) {
        e.preventDefault();
        // Có vùng chọn: dịch đối tượng. Không chọn gì (hoặc giữ Alt): di chuyển bản đồ.
        if (selectionCount(s) && !e.altKey) {
          const k = e.shiftKey ? 10 : 1;
          editorCommands.nudge(dir[0] * k, dir[1] * k);
        } else {
          panByArrow(stage, dir, e.shiftKey);
        }
        return;
      }

      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        stage?.zoomBy(1.25);
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        stage?.zoomBy(1 / 1.25);
        return;
      }
      if (e.shiftKey && e.code === 'Digit1') {
        e.preventDefault();
        stage?.fit();
        return;
      }
      if (e.shiftKey && e.code === 'Digit2') {
        e.preventDefault();
        const floor = currentFloor();
        const b = floor && selectionBounds(floor, s.selection);
        if (b) stage?.fitBounds(b);
        return;
      }

      if (!letter || e.altKey) return;
      if (e.shiftKey) {
        const kind = TRANSFORM_KEYS[letter];
        if (kind) {
          e.preventDefault();
          editorCommands.transform(kind);
        }
        return;
      }
      if (letter === 'g') {
        s.setSettings({ snapGrid: !s.settings.snapGrid });
        return;
      }
      const def = toolForLetter(letter);
      if (!def) return;
      // Nhấn lại phím của công cụ đang dùng: đổi sang kiểu/loại tiếp theo (cửa đi, tường, thang máy, mốc).
      if (def.tool !== s.tool || !cycleVariant(s, def.tool)) s.setTool(def.tool);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [stageRef]);
}
