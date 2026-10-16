/**
 * Thêm / xoá toà nhà — dùng chung cho ô chọn toà (các trang xem dữ liệu một toà) và trang Bản đồ.
 * Bản nháp các toà khác luôn được giữ: thêm / xoá toà không làm mất thay đổi chưa lưu.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { Building, Id } from '@hwn/map-core';
import { useEditor } from '../editor/store';
import { isCampusDirty, saveCampusDraft, useCampusDraft } from '../site/campusDraft';
import { api } from './api';
import { invalidateStructure, useActiveBuildingId } from './queries';

/**
 * Tạo toà mới (đặt luôn vào cơ sở `campusId` nếu có) rồi mở toà đó. Server đặt toà vào mặt bằng tổng
 * thể nên phần ngoài trời đang sửa phải được lưu trước (nếu không sẽ bị xung đột version).
 * Trả về toà vừa tạo, hoặc null nếu người dùng huỷ / chưa lưu được ngoài trời.
 */
export async function createBuilding(
  queryClient: QueryClient,
  input: { name: string; address?: string; campusId?: Id },
): Promise<Building | null> {
  const campus = useCampusDraft.getState();
  if (input.campusId && campus.draft?.id === input.campusId && isCampusDirty(campus)) {
    if (!window.confirm('Thêm toà sẽ lưu luôn các thay đổi ngoài trời đang có. Tiếp tục?'))
      return null;
    if (!(await saveCampusDraft(queryClient))) return null;
  }
  const created = await api.buildings.create(input);
  useEditor.getState().adopt(created);
  await invalidateStructure(queryClient);
  useActiveBuildingId.getState().setBuildingId(created.id);
  return created;
}

/** Xoá hẳn toà `id` trên server (hỏi trước) rồi mở toà `next`. Trả false nếu người dùng huỷ. */
export async function removeBuilding(
  queryClient: QueryClient,
  building: Pick<Building, 'id' | 'name'>,
  next: Id | null,
): Promise<boolean> {
  const ok = window.confirm(
    `Xoá toà nhà "${building.name}" cùng toàn bộ tầng, phòng và đồ thị đi lại? Không thể hoàn tác.`,
  );
  if (!ok) return false;
  await api.buildings.remove(building.id);
  // Bỏ dữ liệu đã tải (để không bị nạp lại vào editor) và bản nháp của toà vừa xoá; toà kế tiếp
  // được mở khi đổi ID (useDraftSync).
  queryClient.removeQueries({ queryKey: ['building-full', building.id] });
  if (next && useEditor.getState().drafts[next]) useEditor.getState().activate(next);
  useEditor.getState().forget(building.id);
  useActiveBuildingId.getState().setBuildingId(next);
  await invalidateStructure(queryClient);
  return true;
}
