/**
 * Mặt bằng tổng thể của một cơ sở: các toà nhà đặt theo `BuildingPlacement` trên cùng hệ toạ độ.
 * - `SiteBuildings`: lớp Konva (dùng bên trong <MapStage>) — editor admin tự ghép thêm tương tác.
 * - `SiteMap`: bản đồ hoàn chỉnh chỉ đọc, chạm vào toà để chọn (app người dùng).
 */
import { useMemo, type CSSProperties } from 'react';
import { Group, Layer, Line, Text } from 'react-konva';
import {
  campusBounds,
  footprintCenter,
  placedFootprint,
  pointInPolygon,
  toSite,
  type BuildingPlacement,
  type Department,
  type Floor,
  type Id,
  type Point,
} from '@hwn/map-core';
import { useMapTheme, type ThemeSetting } from '../core/hooks';
import { flattenPoints } from '../core/route';
import { withAlpha, type MapTheme } from '../core/theme';
import { LocalFrame, MapStage, usePx, useViewportScale } from './MapStage';
import { FurnitureLayer } from './furniture';
import { Connectors, Labels, Landmarks, Rooms, Walls } from './layers';
import { palette } from '@hwn/theme';

export interface SiteBuilding {
  placement: BuildingPlacement;
  name: string;
  /** Đường bao theo hệ trục của toà. */
  footprint: readonly Point[];
  /** Tầng vẽ chi tiết (thường là tầng trệt). Bỏ trống = chỉ vẽ đường bao. */
  floor?: Floor;
  departments?: readonly Department[];
  /** Vẽ mờ (vd. toà không có tầng đang xem). */
  dim?: boolean;
}

const SELECT = palette.accent;

export function SiteBuildings({
  buildings,
  theme,
  selectedId,
  hoverId,
  accent,
  detail = false,
  highlightLandmarkId,
}: {
  buildings: readonly SiteBuilding[];
  theme: MapTheme;
  selectedId?: Id | null;
  hoverId?: Id | null;
  /** Màu viền toà đang chọn (mặc định cam như editor). */
  accent?: string;
  /** Hiện tên phòng và mốc trong toà (khi phóng đủ gần). */
  detail?: boolean;
  highlightLandmarkId?: Id | null;
}) {
  const px = usePx();
  const scale = useViewportScale();
  const showDetail = detail && scale >= 6;
  const highlight = accent ?? SELECT;
  return (
    <Group listening={false}>
      {buildings.map((b) => {
        const { placement } = b;
        const selected = placement.buildingId === selectedId;
        const hovered = placement.buildingId === hoverId;
        const center = toSite(placement, footprintCenter(b.footprint));
        return (
          <Group key={placement.buildingId} opacity={b.dim ? 0.45 : 1}>
            <LocalFrame frame={placement}>
              {b.footprint.length >= 3 && (
                <Line
                  points={flattenPoints(b.footprint)}
                  closed
                  fill={b.floor ? theme.floor : withAlpha(theme.roomStroke, 0.25)}
                  stroke={theme.wall}
                  strokeWidth={1}
                  strokeScaleEnabled={false}
                />
              )}
              {b.floor && (
                <>
                  <Rooms rooms={b.floor.rooms} departments={b.departments} theme={theme} />
                  <Connectors connectors={b.floor.connectors} theme={theme} />
                  {showDetail && !!b.floor.furniture?.length && (
                    <FurnitureLayer furniture={b.floor.furniture} theme={theme} />
                  )}
                  <Walls floor={b.floor} theme={theme} />
                  {showDetail && <Labels floor={b.floor} theme={theme} />}
                  {detail && !!b.floor.landmarks?.length && (
                    <Landmarks
                      landmarks={b.floor.landmarks}
                      theme={theme}
                      showLabels={showDetail}
                      highlightId={highlightLandmarkId}
                    />
                  )}
                </>
              )}
              {(selected || hovered) && b.footprint.length >= 3 && (
                <Line
                  points={flattenPoints(b.footprint)}
                  closed
                  stroke={selected ? highlight : withAlpha(highlight, 0.55)}
                  strokeWidth={selected ? 3 : 2}
                  fill={withAlpha(highlight, selected ? 0.08 : 0.04)}
                  strokeScaleEnabled={false}
                />
              )}
            </LocalFrame>
            {/* Phóng gần thì nhường chỗ cho tên phòng. */}
            {!showDetail && (
              <Text
                text={b.name}
                x={center.x - px(90)}
                y={center.y - px(9)}
                width={px(180)}
                align="center"
                fontSize={px(14)}
                fontStyle="bold"
                fill={selected ? highlight : theme.roomLabel}
                stroke={theme.labelHalo}
                strokeWidth={px(4)}
                fillAfterStrokeEnabled
                wrap="word"
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
}

/** Toà nhà (trên mặt bằng tổng thể) chứa điểm `p`, toà đặt sau được ưu tiên. */
export function siteBuildingAt(buildings: readonly SiteBuilding[], p: Point): Id | null {
  for (let i = buildings.length - 1; i >= 0; i--) {
    const b = buildings[i]!;
    if (b.footprint.length >= 3 && pointInPolygon(p, placedFootprint(b.placement, b.footprint))) {
      return b.placement.buildingId;
    }
  }
  return null;
}

export interface SiteMapProps {
  buildings: readonly SiteBuilding[];
  selectedId?: Id | null;
  onSelect?: (buildingId: Id) => void;
  theme?: ThemeSetting;
  className?: string;
  style?: CSSProperties;
}

/** Bản đồ khuôn viên chỉ đọc: chạm vào một toà để chọn. */
export function SiteMap({
  buildings,
  selectedId,
  onSelect,
  theme: themeSetting = 'auto',
  className,
  style,
}: SiteMapProps) {
  const theme = useMapTheme(themeSetting);
  const bounds = useMemo(
    () =>
      campusBounds(
        { buildings: buildings.map((b) => b.placement) },
        new Map(buildings.map((b) => [b.placement.buildingId, b.footprint])),
      ),
    [buildings],
  );
  return (
    <MapStage
      bounds={bounds}
      background={theme.background}
      className={className}
      style={style}
      cursor={onSelect ? 'pointer' : undefined}
      onWorldClick={(p) => {
        const id = siteBuildingAt(buildings, p);
        if (id) onSelect?.(id);
      }}
    >
      <Layer listening={false}>
        <SiteBuildings
          buildings={buildings}
          theme={theme}
          selectedId={selectedId}
          accent={theme.route}
        />
      </Layer>
    </MapStage>
  );
}
