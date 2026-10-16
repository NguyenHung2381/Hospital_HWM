import {
  lazy,
  Suspense,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  buildingFootprint,
  campusLevel,
  findRoom,
  findLandmark,
  groundFloor,
  northHeading,
  sortedFloors,
  type Building,
  type Floor,
  type Id,
  type Landmark,
  type Location,
  type Room,
  type Route,
} from '@hwn/map-core';
import type { ThemeSetting } from '../core/hooks';
import { routeFloorIds } from '../core/route';
import type { CampusContext } from '../two-d/campusContext';
import { FloorPlan2D } from '../two-d/FloorPlan2D';
import type { MapStageHandle } from '../two-d/MapStage';
import type { MapLocation, MapMode, RouteHighlight, RouteProgress } from '../types';
import './MapViewer.css';

// Tách three.js (~1 MB) ra chunk riêng, chỉ tải khi người dùng chuyển sang 3D.
const Building3D = lazy(() =>
  import('../three-d/Building3D').then((m) => ({ default: m.Building3D })),
);
const Campus3D = lazy(() => import('../three-d/Campus3D').then((m) => ({ default: m.Campus3D })));

export interface MapViewerProps {
  building: Building;
  route?: Route | null;
  location?: MapLocation | null;
  highlightRoomId?: Id | null;
  /** Vị trí đã đi tới trên tuyến (2D) — phần phía sau được vẽ mờ. */
  routeProgress?: RouteProgress | null;
  /** Bước chỉ đường đang xem (2D): tô nổi bật và tự trượt khung nhìn tới khi bước đổi. */
  activeStep?: RouteHighlight | null;
  /** Vị trí người dùng trượt mượt khi thay đổi. Mặc định bật. */
  smoothLocation?: boolean;
  /** Mốc được làm nổi bật (vd. điểm đến). */
  highlightLandmarkId?: Id | null;
  /** Góc xoay bản đồ 2D (độ, theo chiều kim đồng hồ), vd. xoay theo la bàn. */
  rotation?: number;
  /**
   * Bấm vào kim la bàn (chỉ hướng Bắc theo `building.northAngle`). Bỏ trống thì kim la bàn chỉ để
   * xem. `compassActive` = đang xoay bản đồ theo la bàn.
   */
  onCompassClick?: () => void;
  compassActive?: boolean;
  /** Tầng đang xem (controlled). Bỏ trống để component tự quản lý. */
  floorId?: Id;
  onFloorChange?: (floorId: Id) => void;
  /** Chế độ xem (controlled). */
  mode?: MapMode;
  defaultMode?: MapMode;
  onModeChange?: (mode: MapMode) => void;
  showNavGraph?: boolean;
  theme?: ThemeSetting;
  onRoomClick?: (room: Room) => void;
  /** Chạm/click vào biểu tượng mốc (2D). */
  onLandmarkClick?: (landmark: Landmark) => void;
  /** Click vào bản đồ 2D. */
  onMapClick?: (location: Location) => void;
  /** Khuôn viên quanh toà (2D): vẽ phần ngoài trời + các toà khác để thấy cả bệnh viện. */
  campus?: CampusContext | null;
  /** Chạm vào một toà khác trong khuôn viên (2D); `location` theo hệ trục của toà đang xem. */
  onBuildingClick?: (buildingId: Id, location: Location) => void;
  /** Nội dung chèn thêm vào thanh công cụ phía trên. */
  toolbarExtra?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** Nhãn ngắn kiểu bảng thang máy: 1, 2, ... / B1, B2 cho tầng hầm / G cho tầng trệt. */
export const shortFloorLabel = (floor: Floor): string =>
  floor.level < 0 ? `B${-floor.level}` : floor.level === 0 ? 'G' : String(floor.level);

/** Tầng nên hiển thị đầu tiên: tầng xuất phát của tuyến đường, tầng của người dùng, hoặc tầng thấp nhất. */
function preferredFloorId(building: Building, route?: Route | null, location?: MapLocation | null) {
  return route?.segments[0]?.floorId ?? location?.floorId ?? sortedFloors(building)[0]?.id ?? '';
}

/**
 * Bản đồ hoàn chỉnh: chọn tầng, chuyển 2D/3D, phóng to/thu nhỏ, hiển thị tuyến đường & vị trí.
 * Dùng chung cho app người dùng và app quản trị.
 */
export function MapViewer({
  building,
  route,
  location,
  highlightRoomId,
  routeProgress,
  activeStep,
  smoothLocation,
  highlightLandmarkId,
  rotation = 0,
  onCompassClick,
  compassActive = false,
  floorId: controlledFloorId,
  onFloorChange,
  mode: controlledMode,
  defaultMode = '2d',
  onModeChange,
  showNavGraph,
  theme,
  onRoomClick,
  onLandmarkClick,
  onMapClick,
  campus,
  onBuildingClick,
  toolbarExtra,
  className,
  style,
}: MapViewerProps) {
  const stageRef = useRef<MapStageHandle>(null);
  const floors = useMemo(() => sortedFloors(building), [building]);

  // Tự chuyển về tầng xuất phát mỗi khi có tuyến đường / vị trí mới.
  const preferred = preferredFloorId(building, route, location);
  const [internalFloorId, setInternalFloorId] = useState(preferred);
  const [lastPreferred, setLastPreferred] = useState({ route, location, preferred });
  if (lastPreferred.route !== route || lastPreferred.location !== location) {
    setLastPreferred({ route, location, preferred });
    if (controlledFloorId === undefined) setInternalFloorId(preferred);
  }
  const activeFloorId = controlledFloorId ?? internalFloorId;
  const floor = floors.find((f) => f.id === activeFloorId) ?? floors[0];

  const [internalMode, setInternalMode] = useState<MapMode>(defaultMode);
  const mode = controlledMode ?? internalMode;
  const [allFloors3d, setAllFloors3d] = useState(true);
  /** 3D: cả bệnh viện (khi có khuôn viên) hay chỉ toà đang xem. */
  const [campus3d, setCampus3d] = useState(true);
  const showCampus3d = mode === '3d' && !!campus && campus3d;

  const selectFloor = (id: Id) => {
    setInternalFloorId(id);
    onFloorChange?.(id);
  };
  const selectMode = (m: MapMode) => {
    setInternalMode(m);
    onModeChange?.(m);
  };

  const routeFloors = useMemo(() => new Set(route ? routeFloorIds(route) : []), [route]);
  const floorName = (id: Id) => floors.find((f) => f.id === id)?.name ?? id;
  const destinationLabel = useMemo(() => {
    const landmarkId = route?.to.landmarkId ?? highlightLandmarkId;
    const landmark = landmarkId ? findLandmark(building, landmarkId) : undefined;
    if (landmark) return landmark.landmark.name;
    const roomId = route?.to.roomId ?? highlightRoomId;
    const ref = roomId ? findRoom(building, roomId) : undefined;
    return ref ? ref.room.name : route ? 'Điểm đến' : undefined;
  }, [building, route, highlightRoomId, highlightLandmarkId]);
  /** Góc của hướng Bắc trên màn hình (độ, 0 = hướng lên, theo chiều kim đồng hồ). */
  const northOnScreen = northHeading(building) + rotation + 90;

  if (!floor) {
    return <div className="hwn-map-viewer hwn-map-empty">Toà nhà chưa có tầng nào</div>;
  }

  return (
    <div className={`hwn-map-viewer ${className ?? ''}`} style={style}>
      {mode === '2d' ? (
        <FloorPlan2D
          ref={stageRef}
          floor={floor}
          departments={building.departments}
          route={route}
          location={location}
          highlightRoomId={highlightRoomId}
          highlightLandmarkId={highlightLandmarkId}
          rotation={rotation}
          showNavGraph={showNavGraph}
          theme={theme}
          floorName={floorName}
          destinationLabel={destinationLabel}
          routeProgress={routeProgress}
          activeStep={activeStep}
          smoothLocation={smoothLocation}
          onRoomClick={onRoomClick}
          onLandmarkClick={onLandmarkClick}
          onMapClick={onMapClick && ((position) => onMapClick({ floorId: floor.id, position }))}
          campus={campus}
          // Không có khuôn viên: vẫn vẽ sảnh, làn đón, dốc của toà quanh tầng trệt.
          exterior={!campus && floor.id === groundFloor(building)?.id ? building.exterior : null}
          onBuildingClick={
            onBuildingClick &&
            ((id, position) => onBuildingClick(id, { floorId: floor.id, position }))
          }
        />
      ) : showCampus3d && campus ? (
        <Suspense fallback={<div className="hwn-map-loading">Đang tải chế độ 3D…</div>}>
          <Campus3D
            buildings={[
              {
                placement: campus.placement,
                id: building.id,
                name: building.name,
                footprint: buildingFootprint(building),
                floors: building.floors,
              },
              ...campus.neighbors.map((n) => ({
                placement: n.placement,
                id: n.placement.buildingId,
                name: n.name,
                footprint: n.footprint,
                floors: n.floors,
              })),
            ]}
            site={campus.site}
            departments={building.departments}
            level={campusLevel(campus.placement, floor.level)}
            focusBuildingId={building.id}
            route={route}
            location={location}
            highlightRoomId={highlightRoomId}
            destinationLabel={destinationLabel}
            onRoomClick={onRoomClick}
            theme={theme}
          />
        </Suspense>
      ) : (
        <Suspense fallback={<div className="hwn-map-loading">Đang tải chế độ 3D…</div>}>
          <Building3D
            building={building}
            route={route}
            location={location}
            highlightRoomId={highlightRoomId}
            floorIds={allFloors3d ? undefined : [floor.id]}
            theme={theme}
            destinationLabel={destinationLabel}
            onRoomClick={onRoomClick}
          />
        </Suspense>
      )}

      <div className="hwn-map-toolbar">
        <div className="hwn-map-segmented" role="group" aria-label="Chế độ xem">
          {(['2d', '3d'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={mode === m ? 'active' : ''}
              aria-pressed={mode === m}
              onClick={() => selectMode(m)}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
        {mode === '3d' && campus && (
          <button
            type="button"
            className="hwn-map-chip"
            aria-pressed={campus3d}
            onClick={() => setCampus3d((v) => !v)}
          >
            {campus3d ? 'Cả bệnh viện' : 'Chỉ toà này'}
          </button>
        )}
        {mode === '3d' && !showCampus3d && floors.length > 1 && (
          <button
            type="button"
            className="hwn-map-chip"
            aria-pressed={allFloors3d}
            onClick={() => setAllFloors3d((v) => !v)}
          >
            {allFloors3d ? 'Tất cả tầng' : `Chỉ ${floor.name}`}
          </button>
        )}
        {toolbarExtra}
      </div>

      {floors.length > 1 && (mode === '2d' || showCampus3d || !allFloors3d) && (
        <div className="hwn-map-floors" role="group" aria-label="Chọn tầng">
          {[...floors].reverse().map((f) => (
            <button
              key={f.id}
              type="button"
              title={f.name}
              className={f.id === floor.id ? 'active' : ''}
              aria-pressed={f.id === floor.id}
              onClick={() => selectFloor(f.id)}
            >
              {shortFloorLabel(f)}
              {routeFloors.has(f.id) && (
                <span className="hwn-map-floor-dot" aria-label="có lộ trình" />
              )}
            </button>
          ))}
        </div>
      )}

      {mode === '2d' && (
        <button
          type="button"
          className={`hwn-map-compass${compassActive ? ' active' : ''}`}
          aria-label={
            onCompassClick
              ? compassActive
                ? 'Tắt xoay bản đồ theo la bàn'
                : 'Xoay bản đồ theo la bàn'
              : 'Hướng Bắc'
          }
          aria-pressed={onCompassClick ? compassActive : undefined}
          title={compassActive ? 'Đang xoay theo la bàn' : 'Hướng Bắc'}
          disabled={!onCompassClick}
          onClick={onCompassClick}
        >
          <svg viewBox="-12 -12 24 24" width="28" height="28" aria-hidden>
            <g transform={`rotate(${northOnScreen})`}>
              <path d="M0 -10 L4 0 L-4 0 Z" fill="#dc2626" />
              <path d="M0 10 L4 0 L-4 0 Z" fill="currentColor" opacity="0.45" />
            </g>
          </svg>
          <span
            className="hwn-map-compass-n"
            style={{
              transform: `rotate(${northOnScreen}deg) translateY(-19px) rotate(${-northOnScreen}deg)`,
            }}
          >
            B
          </span>
        </button>
      )}

      {mode === '2d' && (
        <div className="hwn-map-zoom" role="group" aria-label="Thu phóng">
          <button type="button" aria-label="Phóng to" onClick={() => stageRef.current?.zoomBy(1.4)}>
            +
          </button>
          <button
            type="button"
            aria-label="Thu nhỏ"
            onClick={() => stageRef.current?.zoomBy(1 / 1.4)}
          >
            −
          </button>
          <button type="button" aria-label="Xem toàn bộ" onClick={() => stageRef.current?.fit()}>
            ⤢
          </button>
        </div>
      )}

      {(mode === '2d' || showCampus3d || !allFloors3d) && (
        <div className="hwn-map-floor-name">
          {floor.name}
          {showCampus3d ? ' · cả bệnh viện' : ''}
        </div>
      )}
    </div>
  );
}
