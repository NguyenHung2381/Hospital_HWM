import { useMemo, type CSSProperties, type ReactNode, type Ref } from 'react';
import { Layer } from 'react-konva';
import {
  boundsOf,
  emptySitePlan,
  hasExterior,
  withLobbyParts,
  type BuildingExterior,
  type Department,
  type Floor,
  type Id,
  type Landmark,
  type Point,
  type Room,
  type Route,
} from '@hwn/map-core';
import { useMapTheme, type ThemeSetting } from '../core/hooks';
import { routeSegmentsOnFloor } from '../core/route';
import { floorBounds, mergeBounds } from '../core/viewport';
import {
  CampusUnderlay,
  campusContextBounds,
  neighborAt,
  type CampusContext,
} from './campusContext';
import type { MapLocation, RouteHighlight, RouteProgress } from '../types';
import {
  Connectors,
  FloorSlab,
  Labels,
  Landmarks,
  LocationMarker,
  NavGraph,
  RoomPins,
  Rooms,
  RouteLayer,
  Walls,
} from './layers';
import { MapStage, type MapStageHandle } from './MapStage';
import { SiteGround, sitePlanBounds } from './siteLayers';

export interface FloorPlan2DProps {
  floor: Floor;
  departments?: readonly Department[];
  route?: Route | null;
  location?: MapLocation | null;
  highlightRoomId?: Id | null;
  /** Mốc là điểm đến — được vẽ nổi bật. */
  highlightLandmarkId?: Id | null;
  /** Góc xoay bản đồ (độ, theo chiều kim đồng hồ). */
  rotation?: number;
  showNavGraph?: boolean;
  showLabels?: boolean;
  theme?: ThemeSetting;
  /** Tên tầng hiển thị trên điểm chuyển tầng của tuyến đường. */
  floorName?: (floorId: Id) => string;
  /** Nhãn tại điểm đến của tuyến đường. */
  destinationLabel?: string;
  /** Vị trí đã đi tới trên tuyến — phần phía sau được vẽ mờ. */
  routeProgress?: RouteProgress | null;
  /** Bước chỉ đường đang xem: được tô nổi bật và khung nhìn tự trượt tới khi bước đổi. */
  activeStep?: RouteHighlight | null;
  /** Vị trí người dùng trượt mượt khi thay đổi (dùng khi đang đi). Mặc định bật. */
  smoothLocation?: boolean;
  /** Đổi giá trị để căn lại khung nhìn. Mặc định căn lại khi đổi tầng. */
  fitKey?: unknown;
  onRoomClick?: (room: Room) => void;
  /** Chạm/click vào biểu tượng mốc. */
  onLandmarkClick?: (landmark: Landmark) => void;
  /** Hiện ghim điểm đích đến của các phòng. Mặc định bật. */
  showRoomPins?: boolean;
  /** Click vào bản đồ — toạ độ theo mét trên tầng hiện tại. */
  onMapClick?: (point: Point) => void;
  /**
   * Khuôn viên quanh toà: phần ngoài trời + các toà khác vẽ bên dưới, khung nhìn mặc định căn cả
   * khuôn viên (toạ độ của mọi prop khác vẫn theo hệ trục của toà).
   */
  campus?: CampusContext | null;
  /**
   * Sảnh, làn đón, dốc… của toà (hệ trục của toà) — vẽ quanh tầng khi không có `campus` (có khuôn
   * viên thì phần này đã nằm trong khuôn viên). Thường chỉ truyền ở tầng trệt.
   */
  exterior?: BuildingExterior | null;
  /** Chạm vào một toà khác trong khuôn viên (`point` theo hệ trục của toà đang xem). */
  onBuildingClick?: (buildingId: Id, point: Point) => void;
  onPointerMove?: (point: Point | null) => void;
  /** Nội dung Konva bổ sung (toạ độ mét), vẽ trên cùng. */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<MapStageHandle>;
}

/** Kích thước tối thiểu (m) của vùng được đưa vào khung khi xem một bước chỉ đường. */
const FOCUS_MIN_M = 14;

/** Bản đồ 2D của một tầng: phòng, tường, cửa, thang, tuyến đường và vị trí người dùng. */
export function FloorPlan2D({
  floor,
  departments,
  route,
  location,
  highlightRoomId,
  highlightLandmarkId,
  rotation,
  showNavGraph = false,
  showLabels = true,
  theme: themeSetting,
  floorName,
  destinationLabel,
  routeProgress,
  activeStep,
  smoothLocation,
  fitKey,
  onRoomClick,
  onLandmarkClick,
  showRoomPins = true,
  onMapClick,
  onPointerMove,
  campus,
  exterior,
  onBuildingClick,
  children,
  className,
  style,
  ref,
}: FloorPlan2DProps) {
  const theme = useMapTheme(themeSetting);
  const bounds = useMemo(() => {
    const b = floorBounds(floor);
    const pad = 1;
    return b && { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
  }, [floor]);
  /** Phần ngoài trời riêng của toà (khi không vẽ cả khuôn viên). */
  const ownSite = useMemo(
    () =>
      !campus && hasExterior(exterior)
        ? withLobbyParts({
            ...emptySitePlan(),
            areas: exterior.areas,
            paths: exterior.paths,
            lobbies: exterior.lobbies ?? [],
          })
        : null,
    [campus, exterior],
  );
  const obstacles = useMemo(() => {
    const b = floorBounds(floor);
    return b
      ? [
          [
            { x: b.minX, y: b.minY },
            { x: b.maxX, y: b.minY },
            { x: b.maxX, y: b.maxY },
            { x: b.minX, y: b.maxY },
          ],
        ]
      : [];
  }, [floor]);
  const fitBounds = useMemo(
    () =>
      campus
        ? mergeBounds([bounds, campusContextBounds(campus)])
        : ownSite
          ? mergeBounds([bounds, sitePlanBounds(ownSite)])
          : bounds,
    [bounds, campus, ownSite],
  );
  const handleClick = (p: Point) => {
    const inside =
      bounds &&
      p.x >= bounds.minX &&
      p.x <= bounds.maxX &&
      p.y >= bounds.minY &&
      p.y <= bounds.maxY;
    const other = campus && onBuildingClick && !inside ? neighborAt(campus, p) : null;
    if (other) onBuildingClick!(other, p);
    else onMapClick?.(p);
  };
  const segments = useMemo(
    () => (route ? routeSegmentsOnFloor(route, floor.id) : []),
    [route, floor.id],
  );

  const focus = useMemo(() => {
    if (!activeStep || activeStep.floorId !== floor.id) return null;
    const b = boundsOf(activeStep.path);
    if (!b) return null;
    // Không zoom quá sát vào một góc rẽ: vùng nhìn tối thiểu FOCUS_MIN_M mét.
    const padX = Math.max(0, FOCUS_MIN_M - (b.maxX - b.minX)) / 2;
    const padY = Math.max(0, FOCUS_MIN_M - (b.maxY - b.minY)) / 2;
    return { minX: b.minX - padX, minY: b.minY - padY, maxX: b.maxX + padX, maxY: b.maxY + padY };
  }, [activeStep, floor.id]);

  return (
    <MapStage
      ref={ref}
      bounds={fitBounds}
      focus={focus}
      rotation={rotation}
      // Khuôn viên tải sau tầng: căn lại một lần khi có khuôn viên.
      fitKey={fitKey ?? `${floor.id}:${campus ? 'campus' : ownSite ? 'site' : ''}`}
      background={theme.background}
      onWorldClick={onMapClick || onBuildingClick ? handleClick : undefined}
      onWorldPointerMove={onPointerMove}
      className={className}
      style={style}
    >
      {campus && (
        <Layer listening={false}>
          <CampusUnderlay context={campus} floorLevel={floor.level} theme={theme} />
        </Layer>
      )}
      {ownSite && (
        <Layer listening={false}>
          <SiteGround site={ownSite} theme={theme} obstacles={obstacles} />
        </Layer>
      )}
      <Layer>
        <FloorSlab bounds={bounds} theme={theme} />
        <Rooms
          rooms={floor.rooms}
          departments={departments}
          theme={theme}
          highlightRoomId={highlightRoomId}
          onRoomClick={onRoomClick}
        />
        <Connectors connectors={floor.connectors} theme={theme} />
        <Walls floor={floor} theme={theme} />
      </Layer>
      <Layer listening={false}>
        {showNavGraph && <NavGraph floor={floor} theme={theme} />}
        {showLabels && <Labels floor={floor} theme={theme} />}
      </Layer>
      {/* Ghim & mốc nằm trên nhãn, dưới tuyến đường; chạm được. */}
      <Layer>
        {showRoomPins && (
          <RoomPins
            rooms={floor.rooms}
            departments={departments}
            theme={theme}
            highlightRoomId={highlightRoomId}
            // Có tuyến tới phòng này thì dấu điểm đến của tuyến đã đánh dấu chỗ đó.
            hiddenRoomId={route?.to.roomId}
            onRoomClick={onRoomClick}
          />
        )}
        {floor.landmarks && floor.landmarks.length > 0 && (
          <Landmarks
            landmarks={floor.landmarks}
            theme={theme}
            highlightId={highlightLandmarkId}
            showLabels={showLabels}
            onLandmarkClick={onLandmarkClick}
          />
        )}
      </Layer>
      <Layer listening={false}>
        {segments.length > 0 && (
          <RouteLayer
            segments={segments}
            theme={theme}
            floorName={floorName}
            destinationLabel={destinationLabel}
            progress={routeProgress}
            activeStep={activeStep}
            entry={route?.entry}
          />
        )}
        {location && location.floorId === floor.id && (
          <LocationMarker
            position={location.position}
            heading={location.heading}
            theme={theme}
            smooth={smoothLocation}
          />
        )}
      </Layer>
      {children && <Layer>{children}</Layer>}
    </MapStage>
  );
}
