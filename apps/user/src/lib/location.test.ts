import { describe, expect, it } from 'vitest';
import { createSampleBuilding } from '@hwn/map-core/sample';
import {
  describeLocation,
  entranceLocation,
  formatAtParam,
  formatQrQuery,
  locationText,
  parseAtParam,
} from './location';
import { isStale, type UserLocation } from './store';

const building = createSampleBuilding();

describe('vị trí người dùng', () => {
  it('lấy vị trí cửa chính', () => {
    expect(entranceLocation(building)).toEqual({ floorId: 'floor_1', position: { x: 0.5, y: 10 } });
  });

  it('đọc / tạo tham số QR', () => {
    const loc = parseAtParam('floor_2,12.5,10', building);
    expect(loc).toEqual({ floorId: 'floor_2', position: { x: 12.5, y: 10 } });
    expect(formatAtParam(loc!)).toBe('floor_2,12.50,10.00');
    expect(parseAtParam('floor_9,1,1', building)).toBeNull();
    expect(parseAtParam('floor_1,abc,1', building)).toBeNull();
    expect(parseAtParam(null, building)).toBeNull();
    expect(formatQrQuery(building.id, loc!)).toBe(`b=${building.id}&at=floor_2%2C12.50%2C10.00`);
  });

  it('mô tả vị trí: trong phòng / gần phòng / chỉ có tầng', () => {
    const inside = describeLocation(building, { floorId: 'floor_1', position: { x: 15, y: 4 } });
    expect(locationText(inside)).toBe('Tầng 1 · trong Phòng khám Tai Mũi Họng (P.102)');
    const near = describeLocation(building, { floorId: 'floor_1', position: { x: 15, y: 9 } });
    expect(near.relation).toBe('near');
    const far = describeLocation(building, { floorId: 'floor_1', position: { x: 200, y: 200 } });
    expect(locationText(far)).toBe('Tầng 1');
  });

  it('vị trí cũ hơn 20 phút bị coi là cũ', () => {
    const loc: UserLocation = {
      buildingId: building.id,
      floorId: 'floor_1',
      position: { x: 0, y: 0 },
      source: 'camera',
      at: new Date(Date.now() - 25 * 60_000).toISOString(),
    };
    expect(isStale(loc)).toBe(true);
    expect(isStale({ ...loc, at: new Date().toISOString() })).toBe(false);
  });
});
