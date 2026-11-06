/**
 * Bộ tìm đường dựng sẵn cho mock server, dùng lại giữa các request tới khi dữ liệu đổi. Mock sửa
 * trực tiếp object rồi tăng `version` (`db.touch`), nên khoá đệm là chính object + `version`.
 */
import {
  createBuildingRouter,
  createCampusRouter,
  type Building,
  type BuildingRouter,
  type Campus,
  type CampusRouteOptions,
  type CampusRouter,
  type Id,
  type RouteOptions,
} from '@hwn/map-core';

interface BuildingEntry {
  version: number;
  router: BuildingRouter;
}

const buildingRouters = new WeakMap<Building, Map<string, BuildingEntry>>();

export function buildingRouter(building: Building, options: RouteOptions = {}): BuildingRouter {
  const key = `${!!options.accessibleOnly}`;
  let byOptions = buildingRouters.get(building);
  if (!byOptions) buildingRouters.set(building, (byOptions = new Map()));
  const hit = byOptions.get(key);
  if (hit && hit.version === building.version) return hit.router;
  const router = createBuildingRouter(building, options);
  byOptions.set(key, { version: building.version, router });
  return router;
}

interface CampusEntry {
  version: number;
  /** Các toà (object + version) lúc dựng — đổi bất kỳ toà nào thì dựng lại. */
  buildings: { building: Building; version: number }[];
  router: CampusRouter;
}

const campusRouters = new WeakMap<Campus, Map<string, CampusEntry>>();

export function campusRouter(
  campus: Campus,
  buildings: ReadonlyMap<Id, Building>,
  options: CampusRouteOptions = {},
): CampusRouter {
  const key = `${!!options.accessibleOnly}|${!!options.preferCovered}`;
  const list = [...buildings.values()];
  let byOptions = campusRouters.get(campus);
  if (!byOptions) campusRouters.set(campus, (byOptions = new Map()));
  const hit = byOptions.get(key);
  if (
    hit &&
    hit.version === campus.version &&
    hit.buildings.length === list.length &&
    hit.buildings.every((e, i) => e.building === list[i] && e.version === list[i]!.version)
  ) {
    return hit.router;
  }
  const router = createCampusRouter(campus, buildings, options);
  byOptions.set(key, {
    version: campus.version,
    buildings: list.map((building) => ({ building, version: building.version })),
    router,
  });
  return router;
}
