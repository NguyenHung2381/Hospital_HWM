import { Link } from 'react-router';
import {
  findDepartment,
  LANDMARK_KINDS,
  type Building,
  type Floor,
  type Landmark,
  type Room,
} from '@hwn/map-core';
import { Icon } from './Icon';
import { LandmarkIcon } from './RoomSearch';

export type Place = { kind: 'room'; room: Room } | { kind: 'landmark'; landmark: Landmark };

export const placeId = (p: Place) => (p.kind === 'room' ? p.room.id : p.landmark.id);

/** Thẻ thông tin khi chạm vào một phòng / mốc trên bản đồ, kèm nút chỉ đường tới đó. */
export function PlaceCard({
  building,
  floor,
  place,
  currentTargetId,
  onClose,
}: {
  building: Building;
  floor: Floor;
  place: Place;
  /** Điểm đến đang chỉ đường (để không hiện lại nút chỉ đường). */
  currentTargetId?: string;
  onClose: () => void;
}) {
  const id = placeId(place);
  const isTarget = id === currentTargetId;
  let title: string;
  let detail: (string | undefined)[];
  let icon;
  let note: string | undefined;
  if (place.kind === 'room') {
    const department = place.room.departmentId
      ? findDepartment(building, place.room.departmentId)
      : undefined;
    title = place.room.name;
    detail = [place.room.code, floor.name, department?.name];
    icon = (
      <span className="dot place-dot" style={{ background: department?.color ?? '#94a3b8' }} />
    );
    note = place.room.destination ? undefined : 'Tuyến sẽ dẫn tới giữa phòng.';
  } else {
    title = place.landmark.name;
    detail = [LANDMARK_KINDS[place.landmark.kind], floor.name];
    icon = <LandmarkIcon kind={place.landmark.kind} size={32} />;
    note = place.landmark.description;
  }

  return (
    <section className="place-card" role="dialog" aria-label={title}>
      <div className="place-card-head">
        {icon}
        <div className="grow">
          <strong>{title}</strong>
          <div className="muted small">{detail.filter(Boolean).join(' · ')}</div>
        </div>
        <button type="button" className="place-close" aria-label="Đóng" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      {note && <p className="muted small place-note">{note}</p>}
      {isTarget ? (
        <p className="small place-note">
          <Icon name="flag" size={16} /> Đang chỉ đường tới đây
        </p>
      ) : (
        <Link
          to={`/navigate/${id}`}
          className="button button-primary button-block"
          onClick={onClose}
        >
          <Icon name="pin" size={18} /> Chỉ đường tới đây
        </Link>
      )}
    </section>
  );
}
