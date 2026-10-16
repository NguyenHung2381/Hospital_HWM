import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { campusLevel, fromSite, toSite, type Id } from '@hwn/map-core';
import { MapViewer, type MapLocation } from '@hwn/map-render';
import { errorMessage } from '../lib/api';
import { describeLocation, locationText, safeReturnTo } from '../lib/location';
import { useActiveBuilding, useActiveBuildingId, useCampusContext } from '../lib/queries';
import { useNav } from '../lib/store';

/**
 * Tự chọn vị trí bằng cách chạm lên bản đồ (khi không chụp ảnh được). Bản đồ hiện cả khuôn viên:
 * chạm vào toà khác thì chuyển sang toà đó và chọn luôn điểm vừa chạm (cùng tầng chung).
 */
export function PickLocationPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const building = useActiveBuilding();
  const campus = useCampusContext(building.data);
  const setBuildingId = useActiveBuildingId((s) => s.setBuildingId);
  const current = useNav((s) => s.location);
  const setLocation = useNav((s) => s.setLocation);
  const [picked, setPicked] = useState<(MapLocation & { buildingId: Id }) | null>(null);

  if (building.isPending) return <p className="page muted">Đang tải…</p>;
  if (building.isError) return <p className="page error">{errorMessage(building.error)}</p>;
  const b = building.data;
  const mine = picked?.buildingId === b.id ? picked : null;
  const shown = mine ?? (current?.buildingId === b.id ? current : null);

  /** Chạm vào toà khác: đổi điểm sang hệ trục của toà đó, lấy tầng cùng số tầng chung. */
  const pickInNeighbor = (id: Id, at: MapLocation) => {
    const n = campus?.neighbors.find((x) => x.placement.buildingId === id);
    const floor = b.floors.find((f) => f.id === at.floorId);
    if (!campus || !n || !floor) return;
    const level = campusLevel(campus.placement, floor.level);
    const target = n.floors?.find((f) => campusLevel(n.placement, f.level) === level);
    if (!target) return;
    setPicked({
      buildingId: id,
      floorId: target.id,
      position: fromSite(n.placement, toSite(campus.placement, at.position)),
    });
    setBuildingId(id);
  };

  return (
    <main className="screen">
      <header className="screen-header">
        <Link to={returnTo} className="back-link">
          ‹ Quay lại
        </Link>
        <h1>Chạm vào chỗ bạn đang đứng</h1>
        <p className="muted small">
          Bản đồ hiện cả khuôn viên — chạm vào toà bạn đang ở, chọn đúng tầng bằng các nút bên phải.
        </p>
      </header>
      <div className="screen-map">
        <MapViewer
          building={b}
          campus={campus}
          location={shown}
          onMapClick={(at) => setPicked({ ...at, buildingId: b.id })}
          onBuildingClick={pickInNeighbor}
        />
      </div>
      <footer className="sheet">
        <p className="center-text">
          {mine ? <strong>{locationText(describeLocation(b, mine))}</strong> : 'Chưa chọn vị trí'}
        </p>
        <button
          type="button"
          className="button button-primary button-block"
          disabled={!mine}
          onClick={() => {
            if (!mine) return;
            setLocation({ ...mine, source: 'manual' });
            navigate(returnTo, { replace: true });
          }}
        >
          Tôi đang ở đây
        </button>
      </footer>
    </main>
  );
}
