import { useQuery, type QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Id } from '@hwn/map-core';
import { api } from './api';

interface ActiveBuildingState {
  /** Toà nhà người dùng chọn gần nhất (null = chưa chọn → dùng toà đầu tiên). */
  buildingId: Id | null;
  setBuildingId(id: Id | null): void;
}

/** Toà nhà đang quản lý — nhớ qua các lần mở app (localStorage). */
export const useActiveBuildingId = create<ActiveBuildingState>()(
  persist(
    (set) => ({
      buildingId: null,
      setBuildingId: (buildingId) => set({ buildingId }),
    }),
    {
      name: 'hwn-admin-building',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ buildingId: s.buildingId }),
    },
  ),
);

export const queryKeys = {
  campuses: ['campuses'] as const,
  campus: (campusId: Id | undefined) => ['campus', campusId] as const,
  buildings: ['buildings'] as const,
  /** Theo ID đã chọn (có thể đã bị xoá — khi đó tải toà đầu tiên). */
  activeBuilding: (chosenId: Id | null) => ['active-building', chosenId] as const,
  trafficHistory: (buildingId: Id | undefined) => ['traffic-history', buildingId] as const,
};

/** Khoá query của toà nhà đang quản lý, theo lựa chọn hiện tại (dùng ngoài React). */
export const activeBuildingKey = () =>
  queryKeys.activeBuilding(useActiveBuildingId.getState().buildingId);

/** Danh sách toà nhà (tóm tắt). */
export function useBuildings() {
  return useQuery({
    queryKey: queryKeys.buildings,
    queryFn: ({ signal }) => api.buildings.list({ signal }),
  });
}

/** Danh sách cơ sở (tóm tắt). */
export function useCampuses() {
  return useQuery({
    queryKey: queryKeys.campuses,
    queryFn: ({ signal }) => api.campuses.list({ signal }),
  });
}

/** Chi tiết một cơ sở (kèm đường bao các toà). */
export function useCampus(campusId: Id | undefined) {
  return useQuery({
    queryKey: queryKeys.campus(campusId),
    queryFn: ({ signal }) => api.campuses.get(campusId!, { signal }),
    enabled: !!campusId,
  });
}

/** Sau khi thêm / xoá / đổi tên toà hay sửa cơ sở: làm mới danh sách toà và cơ sở. */
export const invalidateStructure = (queryClient: QueryClient) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.buildings }),
    queryClient.invalidateQueries({ queryKey: queryKeys.campuses }),
    queryClient.invalidateQueries({ queryKey: ['campus'] }),
  ]);

/** Toà nhà đang quản lý: toà đã chọn nếu còn tồn tại, nếu không thì toà đầu tiên. */
export function useActiveBuilding() {
  const chosenId = useActiveBuildingId((s) => s.buildingId);
  return useQuery({
    queryKey: queryKeys.activeBuilding(chosenId),
    queryFn: async ({ signal }) => {
      const list = await api.buildings.list({ signal });
      const target = list.find((b) => b.id === chosenId) ?? list[0];
      if (!target) throw new Error('Chưa có toà nhà nào trong hệ thống');
      return api.buildings.get(target.id, { signal });
    },
  });
}

/** Lịch sử lưu lượng 24 giờ (mỗi điểm 15 phút), làm mới mỗi 5 phút. */
export function useTrafficHistory(buildingId: Id | undefined) {
  return useQuery({
    queryKey: queryKeys.trafficHistory(buildingId),
    queryFn: ({ signal }) =>
      api.traffic.history(buildingId!, { hours: 24, bucketMinutes: 15 }, { signal }),
    enabled: !!buildingId,
    refetchInterval: 5 * 60_000,
  });
}
