/**
 * Thao tác trên nhiều toà cùng lúc (vùng chọn liên toà): mỗi toà có hệ trục riêng, nên vector dịch
 * chuyển phải đổi hướng theo góc xoay của từng toà trên mặt bằng tổng thể.
 */
import { rotatePoint, type Building, type Floor, type Id, type Point } from '@hwn/map-core';
import { applyDrag, deleteItems, makeDragPlan, type DragPlan } from './ops';
import type { EditorState, Frame } from './store';
import type { ItemRef } from './types';

const ORIGIN = { x: 0, y: 0 };

/** Đổi vector `v` từ hệ trục toà đặt ở `from` sang hệ trục toà đặt ở `to` (chỉ quay, không dời). */
export function mapVector(from: Frame | undefined, to: Frame | undefined, v: Point): Point {
  const deg = (from?.rotation ?? 0) - (to?.rotation ?? 0);
  return deg === 0 ? v : rotatePoint(v, ORIGIN, deg);
}

/** Một phần vùng chọn: các đối tượng trên một tầng của một toà. */
export interface SelectionPart {
  buildingId: Id;
  floorId: Id;
  refs: ItemRef[];
}

/** Toàn bộ vùng chọn: toà đang mở trước, sau đó các toà khác. */
export function selectionParts(
  s: Pick<EditorState, 'activeId' | 'floorId' | 'selection' | 'peerSelection'>,
): SelectionPart[] {
  const parts: SelectionPart[] = [];
  if (s.activeId && s.floorId && s.selection.length) {
    parts.push({ buildingId: s.activeId, floorId: s.floorId, refs: s.selection });
  }
  for (const [buildingId, p] of Object.entries(s.peerSelection)) {
    if (buildingId !== s.activeId && p.refs.length) parts.push({ buildingId, ...p });
  }
  return parts;
}

/** Tổng số đối tượng đang chọn trên mọi toà. */
export const selectionCount = (s: Pick<EditorState, 'selection' | 'peerSelection'>) =>
  s.selection.length + Object.values(s.peerSelection).reduce((n, p) => n + p.refs.length, 0);

const floorIn = (drafts: Record<Id, Building>, part: { buildingId: Id; floorId: Id }) =>
  drafts[part.buildingId]?.floors.find((f) => f.id === part.floorId);

/** Kế hoạch kéo cho từng phần của vùng chọn (tính từ vị trí gốc để kéo không trôi số). */
export interface MultiDragPlan {
  parts: (SelectionPart & { plan: DragPlan })[];
}

export function makeMultiDragPlan(
  drafts: Record<Id, Building>,
  parts: readonly SelectionPart[],
): MultiDragPlan {
  return {
    parts: parts.flatMap((part) => {
      const floor = floorIn(drafts, part);
      return floor ? [{ ...part, plan: makeDragPlan(floor, part.refs) }] : [];
    }),
  };
}

/**
 * Dời mọi phần của vùng chọn đi `delta` — vector theo hệ trục của toà `deltaFrameId` (thường là
 * toà đang mở, nơi con trỏ được đổi toạ độ).
 */
export function applyMultiDrag(
  drafts: Record<Id, Building>,
  plan: MultiDragPlan,
  delta: Point,
  frames: Record<Id, Frame>,
  deltaFrameId: Id | null,
) {
  const from = deltaFrameId ? frames[deltaFrameId] : undefined;
  for (const part of plan.parts) {
    const floor: Floor | undefined = floorIn(drafts, part);
    if (!floor) continue;
    const d =
      part.buildingId === deltaFrameId ? delta : mapVector(from, frames[part.buildingId], delta);
    applyDrag(floor, part.plan, d);
  }
}

/** Xoá mọi đối tượng trong các phần của vùng chọn. */
export function deleteParts(drafts: Record<Id, Building>, parts: readonly SelectionPart[]) {
  for (const part of parts) {
    const floor = floorIn(drafts, part);
    if (floor) deleteItems(floor, part.refs);
  }
}
