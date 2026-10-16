/**
 * Bản nháp dữ liệu toà nhà dùng chung cho các trang sửa dữ liệu (Bản đồ, Khoa phòng):
 * nạp từ server, lưu lên server, xử lý xung đột version.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@hwn/api-client';
import { campusBuildingInfo, validateBuilding, type Building, type Id } from '@hwn/map-core';
import { api, errorMessage } from '../lib/api';
import {
  activeBuildingKey,
  invalidateStructure,
  useActiveBuilding,
  useActiveBuildingId,
} from '../lib/queries';
import { isCampusDirty, saveCampusDraft, useCampusDraft } from '../site/campusDraft';
import { dirtyIds, useEditor } from './store';

/** Các trang làm việc trên bản nháp — chuyển qua lại giữa chúng không cần cảnh báo "chưa lưu". */
export const DRAFT_PATHS = ['/map', '/site', '/departments'];

export interface SaveError {
  message: string;
  /** Server đã có bản mới hơn. */
  conflict?: boolean;
  /** Dữ liệu còn lỗi kiểm tra. */
  invalid?: boolean;
  /** Toà gặp lỗi. */
  buildingId?: Id;
}

interface SaveStatus {
  pending: boolean;
  error: SaveError | null;
  patch(p: Partial<Omit<SaveStatus, 'patch'>>): void;
}

export const useSaveStatus = create<SaveStatus>((set) => ({
  pending: false,
  error: null,
  patch: (p) => set(p),
}));

/**
 * Nạp toà đang quản lý vào editor: lần đầu thì nạp mới; toà đã có bản nháp thì chỉ chuyển sang sửa
 * toà đó (giữ bản nháp + lịch sử mọi toà); server có bản mới mà nháp chưa sửa gì thì thay.
 */
export function useDraftSync() {
  const query = useActiveBuilding();
  useEffect(() => {
    const data = query.data;
    if (!data) return;
    const s = useEditor.getState();
    if (!s.building) {
      s.load(data);
      return;
    }
    s.adopt(data);
    if (s.activeId !== data.id) useEditor.getState().activate(data.id);
  }, [query.data]);
  return query;
}

const buildingName = (id: Id) => useEditor.getState().drafts[id]?.name ?? id;

/** Mở toà `id` trong editor (và nhớ lựa chọn) — vd. để xem lỗi của toà đó. */
function openBuilding(id: Id) {
  useActiveBuildingId.getState().setBuildingId(id);
  useEditor.getState().activate(id, { keepSelection: true });
}

/**
 * Lưu mọi toà có thay đổi. Toà nào còn lỗi kiểm tra thì không gửi gì cả và mở toà đó để xem lỗi.
 */
export async function saveDraft(queryClient: QueryClient): Promise<boolean> {
  const status = useSaveStatus.getState();
  const editor = useEditor.getState();
  const ids = dirtyIds(editor);
  if (!ids.length || status.pending) return false;
  // Toà đang mở lưu trước.
  ids.sort((a, b) => Number(b === editor.activeId) - Number(a === editor.activeId));

  const invalid = ids.find((id) => !validateBuilding(editor.drafts[id]!).valid);
  if (invalid) {
    if (invalid !== editor.activeId) openBuilding(invalid);
    status.patch({
      error: {
        message: `Toà "${buildingName(invalid)}" còn lỗi — hãy sửa trước khi lưu.`,
        invalid: true,
        buildingId: invalid,
      },
    });
    return false;
  }

  status.patch({ pending: true, error: null });
  try {
    for (const id of ids) {
      const cur = useEditor.getState();
      const snapshot = cur.drafts[id];
      if (!snapshot) continue;
      try {
        const res = await api.buildings.save({ ...snapshot, version: cur.versions[id] ?? 0 });
        useEditor.getState().markSaved(snapshot, res.version, res.updatedAt);
        const fresh = { ...snapshot, version: res.version, updatedAt: res.updatedAt };
        if (id === useEditor.getState().activeId) {
          queryClient.setQueryData<Building>(activeBuildingKey(), fresh);
        }
        queryClient.setQueryData<Building>(['building-full', id], fresh);
      } catch (error) {
        const conflict = error instanceof ApiError && error.code === 'VERSION_CONFLICT';
        const invalidMap = error instanceof ApiError && error.code === 'INVALID_MAP';
        const many = ids.length > 1 || id !== useEditor.getState().activeId;
        useSaveStatus.getState().patch({
          error: {
            message: many
              ? `Toà "${buildingName(id)}": ${errorMessage(error)}`
              : errorMessage(error),
            conflict,
            invalid: invalidMap,
            buildingId: id,
          },
        });
        if (invalidMap && id !== useEditor.getState().activeId) openBuilding(id);
        return false;
      }
    }
    return true;
  } finally {
    // Tên toà / đường bao trên mặt bằng tổng thể có thể đã đổi.
    void invalidateStructure(queryClient);
    useSaveStatus.getState().patch({ pending: false });
  }
}

/** Bỏ bản nháp của toà bị xung đột (mặc định toà đang mở), tải bản mới nhất từ server. */
export async function reloadDraft(queryClient: QueryClient, id?: Id) {
  const target = id ?? useSaveStatus.getState().error?.buildingId ?? useEditor.getState().activeId;
  if (!target) return;
  const fresh = await queryClient.fetchQuery({
    queryKey: ['building-full', target],
    queryFn: ({ signal }) => api.buildings.get(target, { signal }),
    staleTime: 0,
  });
  const editor = useEditor.getState();
  editor.forget(target);
  if (Object.keys(useEditor.getState().drafts).length === 0) {
    useEditor.getState().load(fresh, { keepFloor: true });
  } else {
    useEditor.getState().adopt(fresh);
    if (editor.activeId === target)
      useEditor.getState().activate(target, { floorId: editor.floorId ?? undefined });
  }
  void queryClient.invalidateQueries({ queryKey: activeBuildingKey() });
  useSaveStatus.getState().patch({ error: null });
}

/** Bỏ thay đổi chưa lưu của mọi toà, quay về bản đã tải/lưu gần nhất (không gọi server). */
export function discardDraft() {
  useEditor.getState().discardAll();
  useSaveStatus.getState().patch({ error: null });
}

/**
 * Lưu mọi thứ đang sửa trên trang Bản đồ: các toà có thay đổi rồi mặt bằng tổng thể của cơ sở (nếu
 * có thay đổi). Cơ sở được kiểm tra với dữ liệu mới nhất của các toà.
 */
export async function saveAll(queryClient: QueryClient): Promise<boolean> {
  if (useEditor.getState().dirty && !(await saveDraft(queryClient))) return false;
  const campus = useCampusDraft.getState();
  if (!isCampusDirty(campus)) return true;
  const info = new Map(campus.info.map((i) => [i.id, i]));
  for (const b of Object.values(useEditor.getState().drafts)) {
    if (info.has(b.id)) info.set(b.id, campusBuildingInfo(b));
  }
  return saveCampusDraft(queryClient, info);
}

/** Bỏ mọi thay đổi chưa lưu (các toà + mặt bằng tổng thể). */
export function discardAll() {
  discardDraft();
  useCampusDraft.getState().reset();
}
