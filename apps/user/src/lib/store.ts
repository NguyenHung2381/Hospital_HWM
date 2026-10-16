import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Id } from '@hwn/map-core';
import type { MapLocation } from '@hwn/map-render';

/** Vị trí đến từ đâu — để hiển thị độ tin cậy và gợi ý cập nhật. */
export type LocationSource = 'camera' | 'photo' | 'manual' | 'qr' | 'entrance';

export interface UserLocation extends MapLocation {
  buildingId: Id;
  source: LocationSource;
  /** 0..1, chỉ có khi định vị bằng ảnh. */
  confidence?: number;
  /** Thời điểm xác định (ISO). */
  at: string;
}

interface NavState {
  location: UserLocation | null;
  accessibleOnly: boolean;
  setLocation(location: Omit<UserLocation, 'at'> | null): void;
  setAccessibleOnly(value: boolean): void;
}

/**
 * Lưu tạm trong sessionStorage: tải lại trang không mất vị trí, nhưng đóng tab thì xoá
 * (vị trí trong viện nhanh cũ, không nên giữ lâu).
 */
export const useNav = create<NavState>()(
  persist(
    (set) => ({
      location: null,
      accessibleOnly: false,
      setLocation: (location) =>
        set({ location: location && { ...location, at: new Date().toISOString() } }),
      setAccessibleOnly: (accessibleOnly) => set({ accessibleOnly }),
    }),
    {
      name: 'hwn-user-nav',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ location: s.location, accessibleOnly: s.accessibleOnly }),
    },
  ),
);

/** Vị trí cũ hơn 20 phút — có thể người dùng đã đi chỗ khác. */
export const STALE_AFTER_MS = 20 * 60_000;

export const isStale = (location: UserLocation, now = Date.now()) =>
  now - Date.parse(location.at) > STALE_AFTER_MS;
