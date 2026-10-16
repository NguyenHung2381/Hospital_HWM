import { Link, useNavigate } from 'react-router';
import type { Building } from '@hwn/map-core';
import { describeLocation, entranceLocation, locationText } from '../lib/location';
import { isStale, useNav, type LocationSource } from '../lib/store';
import { Icon } from './Icon';

const SOURCE_LABEL: Record<LocationSource, string> = {
  camera: 'theo ảnh chụp',
  photo: 'theo ảnh đã chọn',
  manual: 'bạn tự chọn',
  qr: 'theo mã QR',
  entrance: 'cửa chính',
};

const minutesAgo = (iso: string) =>
  Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));

/** Thẻ "Vị trí của bạn" ở trang chủ. */
export function LocationCard({ building }: { building: Building }) {
  const location = useNav((s) => s.location);
  const valid = location && location.buildingId === building.id ? location : null;

  if (!valid) {
    return (
      <section className="card card-accent">
        <h2>Bạn đang ở đâu?</h2>
        <p className="muted">
          Chụp một tấm ảnh khu vực xung quanh (biển tên phòng, hành lang…) để hệ thống xác định vị
          trí và chỉ đường cho bạn.
        </p>
        <Link to="/locate" className="button button-primary button-block">
          <Icon name="camera" /> Chụp ảnh xác định vị trí
        </Link>
        <NeedLocationLinks building={building} />
      </section>
    );
  }

  const stale = isStale(valid);
  const ago = minutesAgo(valid.at);
  return (
    <section className={`card${stale ? ' card-warn' : ''}`}>
      <div className="row">
        <Icon name="pin" />
        <div className="grow">
          <div className="muted small">Vị trí của bạn ({SOURCE_LABEL[valid.source]})</div>
          <strong>{locationText(describeLocation(building, valid))}</strong>
          <div className="muted small">
            {ago === 0 ? 'vừa cập nhật' : `cập nhật ${ago} phút trước`}
            {stale && ' — có thể đã cũ, hãy chụp lại'}
          </div>
        </div>
        <Link to="/locate" className="button button-small" aria-label="Chụp lại vị trí">
          <Icon name="refresh" size={18} /> Chụp lại
        </Link>
      </div>
    </section>
  );
}

/** Các cách khác để có vị trí (khi không chụp ảnh được). */
export function NeedLocationLinks({
  building,
  returnTo = '/',
}: {
  building: Building;
  returnTo?: string;
}) {
  const navigate = useNavigate();
  const setLocation = useNav((s) => s.setLocation);
  const entrance = entranceLocation(building);
  const qs = `?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <div className="button-row">
      <Link to={`/locate/pick${qs}`} className="button">
        <Icon name="pin" size={18} /> Chọn trên bản đồ
      </Link>
      {entrance && (
        <button
          type="button"
          className="button"
          onClick={() => {
            setLocation({ ...entrance, buildingId: building.id, source: 'entrance' });
            navigate(returnTo);
          }}
        >
          <Icon name="door" size={18} /> Từ cửa chính
        </button>
      )}
    </div>
  );
}
