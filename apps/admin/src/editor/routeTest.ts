import { findRoute, RouteError, type Building, type Location, type Route } from '@hwn/map-core';

export const ENTRANCE = '__entrance__';

export interface RouteQuery {
  fromId: string;
  toId: string;
  accessibleOnly: boolean;
}

function startLocation(building: Building, fromId: string): Location | null {
  for (const floor of building.floors) {
    const node = floor.navGraph.nodes.find((n) =>
      fromId === ENTRANCE ? n.kind === 'entrance' : n.kind === 'room' && n.refId === fromId,
    );
    if (node) return { floorId: floor.id, position: node.position };
  }
  return null;
}

/** Tìm đường ngay trên bản nháp bằng map-core (không gọi server). */
export function computeTestRoute(
  building: Building,
  q: RouteQuery,
): { route: Route } | { error: string } | null {
  if (!q.toId) return null;
  const from = startLocation(building, q.fromId);
  if (!from) return { error: 'Không xác định được điểm xuất phát trên đồ thị đi lại' };
  try {
    const route = findRoute(
      building,
      from,
      { roomId: q.toId },
      { accessibleOnly: q.accessibleOnly },
    );
    return route ? { route } : { error: 'Không có đường đi' };
  } catch (e) {
    return { error: e instanceof RouteError ? e.message : String(e) };
  }
}
