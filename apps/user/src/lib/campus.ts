import { campusLevel, toSite, type Building, type Campus, type Point } from '@hwn/map-core';
import type { UserLocation } from './store';

/**
 * Vị trí người dùng trên mặt bằng tổng thể của cơ sở (cần dữ liệu toà đang đứng để biết số tầng).
 * Trả null nếu vị trí không thuộc cơ sở này.
 */
export function siteLocation(
  location: UserLocation | null,
  campus: Pick<Campus, 'buildings'> | undefined,
  building: Building | undefined,
): { position: Point; level: number; heading?: number } | null {
  if (!location || !campus || !building || building.id !== location.buildingId) return null;
  const pl = campus.buildings.find((x) => x.buildingId === location.buildingId);
  const floor = building.floors.find((f) => f.id === location.floorId);
  if (!pl || !floor) return null;
  return {
    position: toSite(pl, location.position),
    level: campusLevel(pl, floor.level),
    heading: location.heading === undefined ? undefined : location.heading + pl.rotation,
  };
}

/** "5 phút" / "dưới 1 phút". */
export const formatMinutes = (seconds: number) =>
  seconds < 60 ? 'dưới 1 phút' : `${Math.round(seconds / 60)} phút`;
