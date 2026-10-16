import type { RouteRequest } from '@hwn/api-client';
import {
  findLandmark,
  findRoom,
  LANDMARK_KINDS,
  type Building,
  type Floor,
  type Id,
} from '@hwn/map-core';

/** Điểm đến của trang chỉ đường: một phòng hoặc một mốc độc lập (cùng dùng đường dẫn /navigate/:id). */
export interface NavTarget {
  kind: 'room' | 'landmark';
  id: Id;
  name: string;
  /** Mô tả ngắn: mã phòng / loại mốc. */
  detail: string;
  floor: Floor;
  to: RouteRequest['to'];
}

export function resolveTarget(building: Building, id: Id): NavTarget | undefined {
  const room = findRoom(building, id);
  if (room) {
    return {
      kind: 'room',
      id,
      name: room.room.name,
      detail: room.room.code,
      floor: room.floor,
      to: { roomId: id },
    };
  }
  const landmark = findLandmark(building, id);
  if (landmark) {
    return {
      kind: 'landmark',
      id,
      name: landmark.landmark.name,
      detail: LANDMARK_KINDS[landmark.landmark.kind],
      floor: landmark.floor,
      to: { landmarkId: id },
    };
  }
  return undefined;
}
