import type { NavigateFunction } from 'react-router';
import type { Id } from '@hwn/map-core';
import { useActiveBuildingId } from '../lib/queries';
import { MAP_PATH, type MapLayer } from './campusDraft';

/**
 * Mở toà `buildingId` ở trang Vẽ toà nhà hoặc Khuôn viên (`layer`). Bản nháp các toà khác được giữ
 * nguyên (editor sửa nhiều toà cùng lúc).
 */
export function openMap(navigate: NavigateFunction, buildingId: Id, layer: MapLayer): boolean {
  useActiveBuildingId.getState().setBuildingId(buildingId);
  void navigate(MAP_PATH[layer]);
  return true;
}
