import { useState } from 'react';
import { Link } from 'react-router';
import { externalMapUrl, type Building } from '@hwn/map-core';
import { CampusViewer } from '@hwn/map-render';
import { siteLocation } from '../lib/campus';
import { useActiveBuildingId, useCampusIdOf, useCampusMap } from '../lib/queries';
import { useNav } from '../lib/store';
import { Icon } from './Icon';

/**
 * Bản đồ cả bệnh viện (cơ sở chứa toà đang xem): mọi toà kèm phòng, đường xe, dốc, lối đi bộ, bãi
 * xe, cổng… Chạm vào một toà để chuyển sang tìm phòng trong toà đó.
 */
export function CampusCard({ building }: { building: Building }) {
  const campusId = useCampusIdOf(building.id);
  const [level, setLevel] = useState<number | null>(null);
  const map = useCampusMap(campusId, level);
  const location = useNav((s) => s.location);
  const setBuildingId = useActiveBuildingId((s) => s.setBuildingId);

  const c = map.data?.campus;
  if (!map.data || !c) return null;
  const mapUrl = externalMapUrl(c);
  const here = siteLocation(location, c, building);

  return (
    <section className="card campus-card">
      <div className="campus-card-header">
        <div>
          <h2>Bản đồ toàn viện · {c.name}</h2>
          {c.address && <p className="muted">{c.address}</p>}
        </div>
        {mapUrl && (
          <a className="button button-small" href={mapUrl} target="_blank" rel="noreferrer">
            <Icon name="pin" size={16} /> Bản đồ
          </a>
        )}
      </div>
      <div className="campus-map">
        <CampusViewer
          data={map.data}
          onLevelChange={setLevel}
          location={here}
          selectedBuildingId={building.id}
          onBuildingClick={(id) => setBuildingId(id)}
        />
      </div>
      <p className="muted small">
        Đang chọn: <strong>{building.name}</strong>. Chạm vào một toà để tìm phòng trong toà đó.
      </p>
      <Link to="/campus" className="button button-block">
        <Icon name="list" size={18} /> Mở bản đồ toàn viện (đường đi, dốc, bãi xe, ATM…)
      </Link>
    </section>
  );
}
