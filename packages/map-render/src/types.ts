import type { Id, Location, Point } from '@hwn/map-core';

/** Vị trí người dùng hiển thị trên bản đồ. */
export interface MapLocation extends Location {
  /** Hướng nhìn (độ, 0 = trục +x, theo chiều kim đồng hồ). */
  heading?: number;
}

export type MapMode = '2d' | '3d';

/** Vị trí đã đi tới trên tuyến (xem `routeTrack`). */
export interface RouteProgress {
  segmentIndex: number;
  /** Quãng đường (m) tính từ đầu tuyến. */
  distance: number;
}

/** Bước hướng dẫn đang xem, được làm nổi bật trên bản đồ (xem `routeStepGeometry`). */
export interface RouteHighlight {
  floorId: Id;
  segmentIndex: number;
  /** Phần đường của bước — được tô đậm, có chấm đi mô phỏng chạy dọc và được đưa vào khung nhìn. */
  path: Point[];
  /** Nơi diễn ra thao tác (góc rẽ, cửa thang, điểm đến) — đánh dấu bằng vòng toả sóng. */
  anchor?: Point;
  /** Có chấm đi mô phỏng chạy dọc bước. Tắt khi vị trí thật của người dùng đang di chuyển. Mặc định bật. */
  walker?: boolean;
}
