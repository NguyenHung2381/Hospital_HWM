import { useDeferredValue, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  LANDMARK_KINDS,
  normalizeText,
  searchLandmarks,
  type Building,
  type LandmarkKind,
} from '@hwn/map-core';
import { LANDMARK_STYLE, SITE_POI_STYLE } from '@hwn/map-render';
import { errorMessage } from '../lib/api';
import {
  useActiveBuildingId,
  useAllRoomSearch,
  useBuildings,
  useCampus,
  useRoomSearch,
} from '../lib/queries';
import { useNav } from '../lib/store';
import { Icon } from './Icon';

/** Biểu tượng tròn của một loại mốc (cùng màu/hình với trên bản đồ). */
export function LandmarkIcon({ kind, size = 28 }: { kind: LandmarkKind; size?: number }) {
  const style = LANDMARK_STYLE[kind] ?? LANDMARK_STYLE.other;
  return (
    <span className="landmark-icon" style={{ background: style.color, width: size, height: size }}>
      <svg
        viewBox="0 0 24 24"
        width={size * 0.6}
        height={size * 0.6}
        fill="none"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={style.icon} />
      </svg>
    </span>
  );
}

/** Ô tìm phòng/mốc + gợi ý theo khoa & tiện ích + danh sách kết quả (mỗi kết quả mở trang chỉ đường). */
export function RoomSearch({ building }: { building: Building }) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim());
  const rooms = useRoomSearch(building.id, deferredQuery);
  // Có nhiều toà: tìm thêm ở các toà khác — chọn kết quả sẽ chuyển sang toà đó.
  const buildingList = useBuildings().data;
  const multiBuilding = (buildingList?.length ?? 0) > 1;
  const campusOf = (id: string | undefined) => buildingList?.find((b) => b.id === id)?.campusId;
  const campusId = campusOf(building.id);
  const campus = useCampus(campusId);
  const location = useNav((s) => s.location);
  /** Người dùng đã có vị trí trong cùng cơ sở → chỉ đường liên toà được. */
  const canCampusRoute = (buildingId: string) =>
    !!location && !!campusOf(buildingId) && campusOf(location.buildingId) === campusOf(buildingId);
  // Điểm ngoài trời (ATM, căng tin, bãi xe…) của cơ sở — tìm ngay trên máy.
  const sitePois = useMemo(() => {
    const q = normalizeText(deferredQuery);
    if (!q) return [];
    return (campus.data?.site?.pois ?? []).filter((p) =>
      normalizeText([p.name, SITE_POI_STYLE[p.kind].label, ...p.tags].join(' ')).includes(q),
    );
  }, [campus.data, deferredQuery]);
  const everywhere = useAllRoomSearch(deferredQuery, multiBuilding);
  const otherRooms = multiBuilding
    ? (everywhere.data?.filter((i) => i.buildingId !== building.id) ?? [])
    : [];
  const setBuildingId = useActiveBuildingId((s) => s.setBuildingId);
  // Mốc đi kèm dữ liệu toà nhà nên tìm ngay trên máy, không cần gọi server.
  const landmarks = useMemo(
    () => (deferredQuery ? searchLandmarks(building, deferredQuery) : []),
    [building, deferredQuery],
  );
  /** Các loại tiện ích có trong toà nhà — làm nút tìm nhanh. */
  const kinds = useMemo(
    () =>
      (Object.keys(LANDMARK_KINDS) as LandmarkKind[]).filter((k) =>
        building.floors.some((f) => f.landmarks?.some((l) => l.kind === k)),
      ),
    [building],
  );

  return (
    <section className="card">
      <label htmlFor="room-search" className="label">
        Bạn muốn đến đâu?
      </label>
      <div className="search-box">
        <Icon name="search" size={20} />
        <input
          id="room-search"
          className="input"
          type="search"
          placeholder="Phòng, khoa, tiện ích… (vd: siêu âm, ATM)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
        />
      </div>
      {kinds.length > 0 && (
        <div className="chips" aria-label="Tìm nhanh tiện ích">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              className={`chip${query === LANDMARK_KINDS[k] ? ' chip-active' : ''}`}
              onClick={() => setQuery(query === LANDMARK_KINDS[k] ? '' : LANDMARK_KINDS[k])}
            >
              <LandmarkIcon kind={k} size={20} />
              {LANDMARK_KINDS[k]}
            </button>
          ))}
        </div>
      )}
      <div className="chips" aria-label="Tìm nhanh theo khoa">
        {building.departments.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`chip${query === d.name ? ' chip-active' : ''}`}
            onClick={() => setQuery(query === d.name ? '' : d.name)}
          >
            <span className="dot" style={{ background: d.color }} />
            {d.name}
          </button>
        ))}
      </div>

      {rooms.isError && <p className="error">{errorMessage(rooms.error)}</p>}
      {rooms.data &&
        rooms.data.length === 0 &&
        landmarks.length === 0 &&
        !otherRooms.length &&
        !sitePois.length && <p className="muted">Không tìm thấy phòng hay tiện ích phù hợp.</p>}
      <ul className="list">
        {landmarks.map(({ landmark, floor }) => (
          <li key={landmark.id}>
            <Link to={`/navigate/${landmark.id}`} className="list-item">
              <LandmarkIcon kind={landmark.kind} />
              <span className="list-item-main">
                <strong>{landmark.name}</strong>
                <span className="muted">
                  {LANDMARK_KINDS[landmark.kind]} · {floor.name}
                </span>
              </span>
              <Icon name="chevronRight" size={18} />
            </Link>
          </li>
        ))}
        {rooms.data?.map(({ room, floorName, department }) => (
          <li key={room.id}>
            <Link to={`/navigate/${room.id}`} className="list-item">
              <span className="dot" style={{ background: department?.color ?? '#94a3b8' }} />
              <span className="list-item-main">
                <strong>{room.name}</strong>
                <span className="muted">
                  {[room.code, floorName, department?.name].filter(Boolean).join(' · ')}
                </span>
              </span>
              <Icon name="chevronRight" size={18} />
            </Link>
          </li>
        ))}
      </ul>
      {otherRooms.length > 0 && (
        <>
          <h3 className="list-heading">Ở toà nhà khác</h3>
          <ul className="list">
            {otherRooms.map(({ room, buildingId, buildingName, floorName, department }) => (
              <li key={room.id}>
                <Link
                  to={
                    canCampusRoute(buildingId)
                      ? `/campus-route?to=${room.id}&tb=${buildingId}`
                      : `/navigate/${room.id}`
                  }
                  className="list-item"
                  onClick={() => {
                    // Chưa có vị trí trong cùng cơ sở: chuyển sang toà đó rồi chỉ đường trong toà.
                    if (!canCampusRoute(buildingId)) setBuildingId(buildingId);
                  }}
                >
                  <span className="dot" style={{ background: department?.color ?? '#94a3b8' }} />
                  <span className="list-item-main">
                    <strong>{room.name}</strong>
                    <span className="muted">
                      {[room.code, buildingName, floorName].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={18} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {sitePois.length > 0 && (
        <>
          <h3 className="list-heading">Ngoài trời</h3>
          <ul className="list">
            {sitePois.map((p) => (
              <li key={p.id}>
                <Link
                  to={
                    canCampusRoute(building.id)
                      ? `/campus-route?poi=${p.id}`
                      : `/campus?poi=${encodeURIComponent(p.id)}`
                  }
                  className="list-item"
                >
                  <span className="dot" style={{ background: SITE_POI_STYLE[p.kind].color }} />
                  <span className="list-item-main">
                    <strong>{p.name}</strong>
                    <span className="muted">
                      {SITE_POI_STYLE[p.kind].label} · {campus.data?.name ?? 'khuôn viên'}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={18} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
