import type { Campus, CampusView } from '@hwn/map-core';
import type { SiteBuilding } from '@hwn/map-render';

/** Bỏ phần thông tin rút gọn (chỉ đọc) trước khi gửi cơ sở lên server. */
export const campusDoc = ({ buildingInfo: _info, ...campus }: CampusView): Campus => campus;

/** Danh sách toà trong cơ sở → dữ liệu vẽ mặt bằng tổng thể (chỉ đường bao). */
export const siteBuildingsOf = (view: CampusView): SiteBuilding[] =>
  view.buildings.flatMap((pl) => {
    const info = view.buildingInfo.find((i) => i.id === pl.buildingId);
    return info ? [{ placement: pl, name: info.name, footprint: info.footprint }] : [];
  });
