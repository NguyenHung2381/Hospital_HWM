import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CampusRouteRequest, RouteRequest } from '@hwn/api-client';
import {
  campusGroundLevel,
  campusLevel,
  campusSitePlan,
  placedFootprint,
  toSite,
  type Building,
  type Id,
} from '@hwn/map-core';
import type { CampusContext } from '@hwn/map-render';
import { api } from './api';

interface ActiveBuildingState {
  /** Toà nhà người dùng chọn / mã QR chỉ định (null = toà đầu tiên). */
  buildingId: Id | null;
  setBuildingId(id: Id | null): void;
}

/** Toà nhà đang xem — nhớ qua các lần mở app (localStorage). */
export const useActiveBuildingId = create<ActiveBuildingState>()(
  persist(
    (set) => ({
      buildingId: null,
      setBuildingId: (buildingId) => set({ buildingId }),
    }),
    {
      name: 'hwn-user-building',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ buildingId: s.buildingId }),
    },
  ),
);

export const queryKeys = {
  campuses: ['campuses'] as const,
  campus: (campusId: Id | undefined) => ['campus', campusId] as const,
  campusMap: (campusId: Id | undefined, level: number | null) =>
    ['campus-map', campusId, level] as const,
  campusRoute: (request: CampusRouteRequest | null) => ['campus-route', request] as const,
  building: (buildingId: Id | undefined) => ['building', buildingId] as const,
  buildings: ['buildings'] as const,
  /** Theo ID đã chọn (có thể đã bị xoá — khi đó tải toà đầu tiên). */
  activeBuilding: (chosenId: Id | null) => ['active-building', chosenId] as const,
  rooms: (buildingId: Id | undefined, q: string) => ['rooms', buildingId, q] as const,
  allRooms: (q: string) => ['all-rooms', q] as const,
  route: (request: RouteRequest | null) => ['route', request] as const,
};

/** Danh sách toà nhà (tóm tắt). */
export function useBuildings() {
  return useQuery({
    queryKey: queryKeys.buildings,
    queryFn: ({ signal }) => api.buildings.list({ signal }),
    staleTime: 5 * 60_000,
  });
}

/** Danh sách cơ sở (tóm tắt). */
export function useCampuses() {
  return useQuery({
    queryKey: queryKeys.campuses,
    queryFn: ({ signal }) => api.campuses.list({ signal }),
    staleTime: 5 * 60_000,
  });
}

/** Chi tiết cơ sở (kèm đường bao các toà) để vẽ sơ đồ khuôn viên. */
export function useCampus(campusId: Id | undefined) {
  return useQuery({
    queryKey: queryKeys.campus(campusId),
    queryFn: ({ signal }) => api.campuses.get(campusId!, { signal }),
    enabled: !!campusId,
    staleTime: 5 * 60_000,
  });
}

/** Bản đồ cơ sở ở tầng chung `level` (null = tầng mặt đất). */
export function useCampusMap(campusId: Id | undefined, level: number | null) {
  return useQuery({
    queryKey: queryKeys.campusMap(campusId, level),
    queryFn: ({ signal }) => api.campuses.map(campusId!, level ?? undefined, { signal }),
    enabled: !!campusId,
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
  });
}

/** Chỉ đường liên toà. */
export function useCampusRoute(request: CampusRouteRequest | null) {
  return useQuery({
    queryKey: queryKeys.campusRoute(request),
    queryFn: ({ signal }) => api.campuses.route(request!, { signal }),
    enabled: !!request,
  });
}

/** Dữ liệu đầy đủ của một toà bất kỳ (không đổi toà đang xem). */
export function useBuilding(buildingId: Id | undefined) {
  return useQuery({
    queryKey: queryKeys.building(buildingId),
    queryFn: ({ signal }) => api.buildings.get(buildingId!, { signal }),
    enabled: !!buildingId,
    staleTime: 5 * 60_000,
  });
}

/** ID cơ sở chứa toà `buildingId` (theo danh sách toà). */
export function useCampusIdOf(buildingId: Id | undefined): Id | undefined {
  const buildings = useBuildings();
  return buildings.data?.find((b) => b.id === buildingId)?.campusId;
}

/** Toà nhà đang dùng: toà đã chọn (qua bộ chọn / mã QR) nếu còn tồn tại, nếu không thì toà đầu tiên. */
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
    staleTime: 5 * 60_000,
  });
}

export function useRoomSearch(buildingId: Id | undefined, q: string) {
  return useQuery({
    queryKey: queryKeys.rooms(buildingId, q),
    queryFn: ({ signal }) => api.rooms.search(buildingId!, { q }, { signal }),
    enabled: !!buildingId,
    placeholderData: (previous) => previous,
  });
}

/** Tìm phòng trên mọi toà nhà (chỉ khi có từ khoá). */
export function useAllRoomSearch(q: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.allRooms(q),
    queryFn: ({ signal }) => api.rooms.searchAll({ q }, { signal }),
    enabled: enabled && q.length > 0,
    placeholderData: (previous) => previous,
  });
}

export function useRoute(request: RouteRequest | null) {
  return useQuery({
    queryKey: queryKeys.route(request),
    queryFn: ({ signal }) => api.route(request!, { signal }),
    enabled: !!request,
  });
}

/**
 * Khuôn viên quanh toà `building` để vẽ cả bệnh viện trên bản đồ của toà: phần ngoài trời + các toà
 * khác (tải đầy đủ để vẽ chi tiết tầng cùng số tầng chung). undefined nếu toà không thuộc cơ sở nào.
 */
export function useCampusContext(building: Building | undefined): CampusContext | undefined {
  const campusId = useCampusIdOf(building?.id);
  const campus = useCampus(campusId);
  const others = (campus.data?.buildings ?? []).filter((pl) => pl.buildingId !== building?.id);
  const fulls = useQueries({
    queries: others.map((pl) => ({
      queryKey: queryKeys.building(pl.buildingId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.buildings.get(pl.buildingId, { signal }),
      staleTime: 5 * 60_000,
    })),
  });
  const loaded = fulls.map((q) => q.data);
  const loadedKey = loaded.map((b) => (b ? `${b.id}@${b.version}` : '')).join();

  return useMemo(() => {
    const c = campus.data;
    const placement = c?.buildings.find((pl) => pl.buildingId === building?.id);
    if (!c || !building || !placement) return undefined;
    const info = new Map(c.buildingInfo.map((i) => [i.id, i]));
    const full = new Map(loaded.flatMap((b) => (b ? [[b.id, b] as const] : [])));
    const levelsOf = (id: Id) =>
      id === building.id ? building.floors.map((f) => f.level) : info.get(id)?.levels;
    return {
      placement,
      // Khuôn viên + sảnh, dốc của các toà (toà đang xem lấy theo dữ liệu đầy đủ mới nhất).
      site: campusSitePlan(c, (id) =>
        id === building.id ? building.exterior : (full.get(id)?.exterior ?? info.get(id)?.exterior),
      ),
      groundLevel: campusGroundLevel(c, levelsOf),
      departments: building.departments,
      ownFootprint: placedFootprint(placement, info.get(building.id)?.footprint ?? []),
      neighbors: c.buildings.flatMap((pl) => {
        const i = info.get(pl.buildingId);
        if (!i || pl.buildingId === building.id) return [];
        return [
          {
            placement: pl,
            name: i.name,
            footprint: i.footprint,
            floors: full.get(pl.buildingId)?.floors,
          },
        ];
      }),
      entrances: c.buildings.flatMap((pl) =>
        (info.get(pl.buildingId)?.doors ?? [])
          .filter(
            (d) =>
              d.type === 'entrance' && campusLevel(pl, d.level) === campusGroundLevel(c, levelsOf),
          )
          .map((d) => toSite(pl, d.position)),
      ),
    };
    // `loadedKey` thay cho mảng `loaded` (mảng mới mỗi lần render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campus.data, building, loadedKey]);
}
