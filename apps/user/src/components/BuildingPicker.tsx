import type { Building, BuildingSummary } from '@hwn/map-core';
import { useActiveBuildingId, useBuildings, useCampuses } from '../lib/queries';

/**
 * Tên toà nhà đang xem; nếu hệ thống có nhiều toà thì là ô chọn toà nhà
 * (dùng `<select>` gốc để trên điện thoại hiện bảng chọn của hệ điều hành).
 * Có nhiều cơ sở thì các toà được nhóm theo cơ sở.
 */
export function BuildingPicker({ building }: { building: Building }) {
  const buildings = useBuildings();
  const campuses = useCampuses();
  const setBuildingId = useActiveBuildingId((s) => s.setBuildingId);
  const list = buildings.data ?? [];

  if (list.length <= 1) return <p className="muted">{building.name}</p>;

  const option = (b: BuildingSummary) => (
    <option key={b.id} value={b.id}>
      {b.name}
    </option>
  );
  const groups = (campuses.data ?? [])
    .map((c) => ({ c, items: list.filter((b) => b.campusId === c.id) }))
    .filter((g) => g.items.length);
  const loose = list.filter((b) => !groups.some((g) => g.c.id === b.campusId));

  return (
    <label className="building-picker">
      <span className="sr-only">Toà nhà</span>
      <select value={building.id} onChange={(e) => setBuildingId(e.target.value)}>
        {groups.length > 1 || (groups.length === 1 && loose.length) ? (
          <>
            {groups.map(({ c, items }) => (
              <optgroup key={c.id} label={c.name}>
                {items.map(option)}
              </optgroup>
            ))}
            {loose.length > 0 && <optgroup label="Khác">{loose.map(option)}</optgroup>}
          </>
        ) : (
          list.map(option)
        )}
      </select>
    </label>
  );
}
