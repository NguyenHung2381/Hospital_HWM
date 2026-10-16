/**
 * Bản nháp cơ sở (mặt bằng tổng thể: vị trí các toà, phần ngoài trời, cầu nối) — dùng chung cho
 * trang Bản đồ, nơi vẽ cả trong toà lẫn ngoài trời trên cùng một khung. Cơ sở lưu riêng với dữ liệu
 * từng toà (có `version` riêng) nhưng nút Lưu / Ctrl+S lưu cả hai.
 */
import { create } from 'zustand';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@hwn/api-client';
import {
  validateCampus,
  type Campus,
  type CampusBuildingInfo,
  type CampusView,
  type Id,
} from '@hwn/map-core';
import { api, errorMessage } from '../lib/api';
import { campusDoc } from '../lib/campus';
import { invalidateStructure } from '../lib/queries';

const HISTORY_LIMIT = 100;

/** Trang vẽ: Vẽ toà nhà (/map) hay Khuôn viên (/site, mặt bằng tổng thể). */
export type MapLayer = 'building' | 'site';

/** Đường dẫn của từng trang vẽ. */
export const MAP_PATH: Record<MapLayer, string> = { building: '/map', site: '/site' };

export interface CampusSaveError {
  message: string;
  conflict?: boolean;
}

interface CampusDraftState {
  /** Bản đã tải / lưu gần nhất. */
  base: Campus | null;
  draft: Campus | null;
  past: Campus[];
  future: Campus[];
  /** Thông tin rút gọn các toà (từ server) — để kiểm tra trước khi lưu. */
  info: CampusBuildingInfo[];
  saving: boolean;
  error: CampusSaveError | null;
  /** Nạp lần đầu, khi đổi cơ sở, hoặc khi server có bản mới hơn mà nháp chưa sửa gì. */
  load(view: CampusView): void;
  /** Ghi một bước; `merge` = gộp vào bước trước (đang kéo). */
  change(fn: (c: Campus) => Campus, merge?: boolean): void;
  undo(): void;
  redo(): void;
  /** Bỏ thay đổi chưa lưu. */
  reset(): void;
  /** Bỏ hẳn bản nháp (toà đang sửa không thuộc cơ sở nào). */
  clear(): void;
}

export const useCampusDraft = create<CampusDraftState>((set, get) => ({
  base: null,
  draft: null,
  past: [],
  future: [],
  info: [],
  saving: false,
  error: null,
  load: (view) => {
    const s = get();
    const dirty = isCampusDirty(s);
    if (s.base && s.base.id === view.id && (dirty || view.version <= s.base.version)) {
      set({ info: view.buildingInfo });
      return;
    }
    const doc = campusDoc(view);
    set({ base: doc, draft: doc, past: [], future: [], info: view.buildingInfo, error: null });
  },
  change: (fn, merge = false) =>
    set((s) =>
      s.draft
        ? {
            draft: fn(s.draft),
            past: merge ? s.past : [...s.past, s.draft].slice(-HISTORY_LIMIT),
            future: [],
          }
        : s,
    ),
  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1];
      return prev && s.draft
        ? { draft: prev, past: s.past.slice(0, -1), future: [s.draft, ...s.future] }
        : s;
    }),
  redo: () =>
    set((s) => {
      const next = s.future[0];
      return next && s.draft
        ? { draft: next, past: [...s.past, s.draft], future: s.future.slice(1) }
        : s;
    }),
  reset: () => set((s) => ({ draft: s.base, past: [], future: [], error: null })),
  clear: () => set({ base: null, draft: null, past: [], future: [], info: [], error: null }),
}));

export const isCampusDirty = (s: Pick<CampusDraftState, 'base' | 'draft'>) =>
  !!s.draft && s.draft !== s.base;

/**
 * Lưu bản nháp cơ sở. `info` = thông tin mới nhất của các toà (vd. toà đang sửa chưa lưu) để kiểm
 * tra cầu nối / chồng lấn; bỏ trống thì dùng thông tin server trả về lúc tải.
 */
export async function saveCampusDraft(
  queryClient: QueryClient,
  info?: ReadonlyMap<Id, CampusBuildingInfo>,
): Promise<boolean> {
  const s = useCampusDraft.getState();
  const snapshot = s.draft;
  if (!snapshot || !s.base || !isCampusDirty(s) || s.saving) return !isCampusDirty(s);
  const validation = validateCampus(snapshot, info ?? new Map(s.info.map((i) => [i.id, i])));
  if (!validation.valid) {
    const first = validation.issues.find((i) => i.severity === 'error')!;
    useCampusDraft.setState({ error: { message: `Mặt bằng tổng thể: ${first.message}` } });
    return false;
  }
  useCampusDraft.setState({ saving: true, error: null });
  try {
    const res = await api.campuses.save({ ...snapshot, version: s.base.version });
    const saved = { ...snapshot, version: res.version, updatedAt: res.updatedAt };
    // Người dùng sửa tiếp trong lúc chờ thì nháp vẫn "chưa lưu".
    useCampusDraft.setState((cur) => ({
      base: saved,
      draft: cur.draft === snapshot ? saved : cur.draft,
    }));
    await invalidateStructure(queryClient);
    return true;
  } catch (err) {
    useCampusDraft.setState({
      error: {
        message: errorMessage(err),
        conflict: err instanceof ApiError && err.code === 'VERSION_CONFLICT',
      },
    });
    return false;
  } finally {
    useCampusDraft.setState({ saving: false });
  }
}
