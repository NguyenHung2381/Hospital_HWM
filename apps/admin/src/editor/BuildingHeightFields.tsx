/** Sửa độ cao cả toà: chiều cao mỗi tầng và cao độ sàn tầng trệt (xếp lại mọi tầng). */
import type { Building } from '@hwn/map-core';
import { NumberField } from './fields';
import { buildingHeights, restackFloors } from './ops';
import { useEditor } from './store';

interface Props {
  /** Toà cần sửa — bỏ trống = toà đang mở trong editor (sửa vào bản nháp). */
  building?: Building;
  /** Áp thay đổi lên toà `building` (bắt buộc khi truyền `building`). */
  edit?: (fn: (b: Building) => void) => void;
  disabled?: boolean;
}

export function BuildingHeightFields(props: Props) {
  const draft = useEditor((s) => s.building)!;
  const editDraft = useEditor((s) => s.edit);
  const building = props.building ?? draft;
  const edit = props.edit ?? editDraft;
  const { baseElevation, total, floorHeight } = buildingHeights(building);
  return (
    <>
      <div className="pf-grid">
        <NumberField
          label={
            floorHeight === null ? 'Chiều cao mỗi tầng (đang khác nhau)' : 'Chiều cao mỗi tầng'
          }
          value={floorHeight ?? building.floors[0]?.height ?? 3}
          min={2}
          max={20}
          disabled={props.disabled}
          onCommit={(h) => edit((b) => restackFloors(b, { floorHeight: h }))}
        />
        <NumberField
          label="Cao độ sàn tầng trệt"
          value={baseElevation}
          min={-20}
          max={50}
          disabled={props.disabled}
          onCommit={(v) => edit((b) => restackFloors(b, { baseElevation: v }))}
        />
      </div>
      <p className="muted small">
        {building.floors.length} tầng · cao tổng cộng {total.toFixed(1)} m. Đổi ở đây sẽ xếp lại cao
        độ mọi tầng liền nhau (sửa riêng từng tầng ở bảng "Tầng").
      </p>
    </>
  );
}
