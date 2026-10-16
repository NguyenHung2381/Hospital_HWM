import { useEffect } from 'react';
import { Outlet, useSearchParams } from 'react-router';
import type { Building, Id } from '@hwn/map-core';
import { api } from './lib/api';
import { parseAtParam } from './lib/location';
import { useActiveBuildingId } from './lib/queries';
import { useNav } from './lib/store';

/**
 * Tìm toà nhà cho mã QR: có `b` thì dùng đúng toà đó; mã cũ chỉ có `at` thì thử lần lượt các toà
 * (toà đang xem trước) tới khi gặp toà có tầng trong `at`.
 */
async function resolveQr(
  b: Id | null,
  at: string | null,
): Promise<{ building: Building; at: ReturnType<typeof parseAtParam> } | null> {
  const current = useActiveBuildingId.getState().buildingId;
  const ids = b
    ? [b]
    : (await api.buildings.list())
        .map((x) => x.id)
        .sort((x, y) => Number(y === current) - Number(x === current));
  for (const id of ids) {
    const building = await api.buildings.get(id).catch(() => null);
    if (!building) continue;
    const loc = parseAtParam(at, building);
    if (loc || !at) return { building, at: loc };
  }
  return null;
}

/**
 * Bố cục gốc. Xử lý mã QR dán trong viện: `/?b=<toà>&at=<tầng>,<x>,<y>` → chọn toà và đặt luôn
 * vị trí người dùng, không cần chụp ảnh. `?b=` một mình chỉ chọn toà; `?at=` (mã cũ) vẫn dùng được.
 */
export function RootLayout() {
  const [params, setParams] = useSearchParams();
  const b = params.get('b');
  const at = params.get('at');

  useEffect(() => {
    if (!b && !at) return;
    // Không huỷ khi effect chạy lại: xoá tham số khỏi URL ngay dưới đây cũng làm effect chạy lại.
    void resolveQr(b, at).then((found) => {
      if (!found) return;
      useActiveBuildingId.getState().setBuildingId(found.building.id);
      if (found.at) {
        useNav.getState().setLocation({ ...found.at, buildingId: found.building.id, source: 'qr' });
      }
    });
    const next = new URLSearchParams(params);
    next.delete('b');
    next.delete('at');
    setParams(next, { replace: true });
  }, [b, at, params, setParams]);

  return <Outlet />;
}
