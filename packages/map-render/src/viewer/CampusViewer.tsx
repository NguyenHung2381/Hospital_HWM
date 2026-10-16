/**
 * Bản đồ cả cơ sở ở một tầng chung: tầng tương ứng của mọi toà + đường xe, lối đi bộ, bãi xe, cổng,
 * điểm ngoài trời, cầu nối và tuyến chỉ đường liên toà (dạng `Route` theo toạ độ mặt bằng tổng thể,
 * `floorId` = `L<tầng>` — xem `campusRouteToSiteRoute`).
 */
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { Layer } from 'react-konva';
import {
  boundsOf,
  campusBounds,
  placedFootprint,
  campusLevel,
  campusViewSite,
  isGateOpen,
  toSite,
  distance,
  doorSitePosition,
  levelFloorId,
  levelOfFloorId,
  type CampusMapView,
  type Id,
  type Point,
  type Route,
  type SitePoi,
} from '@hwn/map-core';
import { useMapTheme, type ThemeSetting } from '../core/hooks';
import { routeSegmentsOnFloor } from '../core/route';
import { mergeBounds } from '../core/viewport';
import { MapStage, type MapStageHandle } from '../two-d/MapStage';
import { LocationMarker, RouteLayer } from '../two-d/layers';
import { siteBuildingAt, SiteBuildings, type SiteBuilding } from '../two-d/site';
import {
  GATE_CLOSED_COLOR,
  GATE_COLOR,
  SITE_AREA_STYLE,
  SITE_POI_STYLE,
  SiteGround,
  SiteLinks,
  sitePathLegend,
  sitePlanBounds,
} from '../two-d/siteLayers';
import './MapViewer.css';
import './CampusViewer.css';

/** Nhãn ngắn của tầng chung trên nút chọn tầng. */
export const campusLevelLabel = (level: number) => (level < 0 ? `B${-level}` : String(level));

export interface CampusViewerProps {
  /** Dữ liệu tầng đang xem (GET /campuses/:id/map?level=). */
  data: CampusMapView;
  onLevelChange?: (level: number) => void;
  /** Tuyến liên toà theo toạ độ mặt bằng tổng thể. */
  route?: Route | null;
  /** Vị trí người dùng trên mặt bằng tổng thể. */
  location?: { position: Point; level: number; heading?: number } | null;
  selectedBuildingId?: Id | null;
  highlightPoiId?: Id | null;
  highlightLandmarkId?: Id | null;
  onBuildingClick?: (buildingId: Id) => void;
  onPoiClick?: (poi: SitePoi) => void;
  theme?: ThemeSetting;
  className?: string;
  style?: CSSProperties;
}

export function CampusViewer({
  data,
  onLevelChange,
  route,
  location,
  selectedBuildingId,
  highlightPoiId,
  highlightLandmarkId,
  onBuildingClick,
  onPoiClick,
  theme: themeSetting = 'auto',
  className,
  style,
}: CampusViewerProps) {
  const theme = useMapTheme(themeSetting);
  const stageRef = useRef<MapStageHandle>(null);
  const [legend, setLegend] = useState(false);
  const { campus, level } = data;
  // Phần ngoài trời của cơ sở + sảnh, làn đón, dốc của từng toà.
  const site = campusViewSite(campus);

  const info = useMemo(() => new Map(campus.buildingInfo.map((i) => [i.id, i])), [campus]);
  const bounds = useMemo(
    () =>
      mergeBounds([
        campusBounds(campus, new Map(campus.buildingInfo.map((i) => [i.id, i.footprint]))),
        sitePlanBounds(site),
      ]),
    [campus, site],
  );

  const buildings: SiteBuilding[] = campus.buildings.flatMap((pl) => {
    const i = info.get(pl.buildingId);
    if (!i) return [];
    const floor = data.floors.find((f) => f.buildingId === pl.buildingId)?.floor;
    return [
      {
        placement: pl,
        name: i.name,
        footprint: i.footprint,
        floor,
        departments: data.departments,
        dim: !floor,
      },
    ];
  });

  /** Đường bao các toà trên mặt bằng tổng thể. */
  const footprints = useMemo(
    () =>
      campus.buildings.map((pl) => placedFootprint(pl, info.get(pl.buildingId)?.footprint ?? [])),
    [campus.buildings, info],
  );
  const avoid = useMemo(
    () =>
      footprints.flatMap((fp) => {
        const b = boundsOf(fp);
        return b ? [b] : [];
      }),
    [footprints],
  );

  const floorIds = new Set(data.floors.map((f) => f.floor.id));
  const links = (campus.links ?? []).flatMap((l) => {
    if (!floorIds.has(l.a.floorId) || !floorIds.has(l.b.floorId)) return [];
    const from = doorSitePosition(campus, info, l.a);
    const to = doorSitePosition(campus, info, l.b);
    return from && to ? [{ id: l.id, name: l.name, from, to, covered: l.covered }] : [];
  });

  /** Cửa chính các toà ở tầng mặt đất — để nối lối đi ngoài trời vào cửa. */
  const entrances = useMemo(
    () =>
      campus.buildings.flatMap((pl) =>
        (info.get(pl.buildingId)?.doors ?? [])
          .filter((d) => d.type === 'entrance' && campusLevel(pl, d.level) === data.groundLevel)
          .map((d) => toSite(pl, d.position)),
      ),
    [campus.buildings, info, data.groundLevel],
  );

  const levelKey = levelFloorId(level);
  const segments = useMemo(
    () => (route ? routeSegmentsOnFloor(route, levelKey) : []),
    [route, levelKey],
  );
  const routeLevels = new Set(
    (route?.segments ?? []).map((s) => levelOfFloorId(s.floorId)).filter((l) => l !== null),
  );

  const handleClick = (p: Point) => {
    const scale = stageRef.current?.getTransform().scale ?? 10;
    const poi = site?.pois.find((x) => distance(x.position, p) <= 16 / scale);
    if (poi && onPoiClick) {
      onPoiClick(poi);
      return;
    }
    const id = siteBuildingAt(buildings, p);
    if (id) onBuildingClick?.(id);
  };

  const poiKinds = [...new Set(site?.pois.map((p) => p.kind) ?? [])];
  const pathLegend = sitePathLegend(site?.paths ?? []);
  const areaKinds = [...new Set(site?.areas.map((a) => a.kind) ?? [])];

  return (
    <div className={`hwn-map-viewer hwn-campus-viewer ${className ?? ''}`} style={style}>
      <MapStage
        ref={stageRef}
        bounds={bounds}
        fitKey={campus.id}
        background={theme.background}
        cursor={onBuildingClick || onPoiClick ? 'pointer' : undefined}
        onWorldClick={handleClick}
      >
        <Layer listening={false}>
          {site && (
            <SiteGround
              site={site}
              theme={theme}
              dim={level !== data.groundLevel}
              highlightPoiId={highlightPoiId}
              entrances={entrances}
              avoid={avoid}
              obstacles={footprints}
            />
          )}
          <SiteBuildings
            buildings={buildings}
            theme={theme}
            selectedId={selectedBuildingId}
            accent={theme.route}
            detail
            highlightLandmarkId={highlightLandmarkId}
          />
          <SiteLinks links={links} theme={theme} />
        </Layer>
        <Layer listening={false}>
          {segments.length > 0 && route && (
            <RouteLayer
              segments={segments}
              theme={theme}
              floorName={(id) => `Tầng ${levelOfFloorId(id) ?? id}`}
              entry={route.entry?.floorId === levelKey ? route.entry : null}
            />
          )}
          {location && location.level === level && (
            <LocationMarker position={location.position} heading={location.heading} theme={theme} />
          )}
        </Layer>
      </MapStage>

      {(site?.paths.length || site?.pois.length || site?.areas.length) && (
        <div className="hwn-campus-legend-wrap">
          <button
            type="button"
            className={`hwn-map-chip${legend ? ' active' : ''}`}
            aria-expanded={legend}
            onClick={() => setLegend(!legend)}
          >
            Chú giải
          </button>
          {legend && (
            <ul className="hwn-campus-legend">
              {pathLegend.map((item) => (
                <li key={item.key}>
                  <span
                    className={`hwn-campus-swatch line ${item.swatch}`}
                    style={{ borderColor: item.color, color: item.color }}
                  />
                  {item.label}
                </li>
              ))}
              {(site?.gates.length ?? 0) > 0 && (
                <li>
                  <span className="hwn-campus-swatch" style={{ background: GATE_COLOR }} />
                  Cổng đang mở
                </li>
              )}
              {site?.gates.some((g) => !isGateOpen(g, new Date())) && (
                <li>
                  <span className="hwn-campus-swatch" style={{ background: GATE_CLOSED_COLOR }} />
                  Cổng đang đóng (theo giờ)
                </li>
              )}
              {areaKinds.map((k) => (
                <li key={k}>
                  <span
                    className="hwn-campus-swatch"
                    style={{
                      background: SITE_AREA_STYLE[k].fill,
                      borderColor: SITE_AREA_STYLE[k].stroke,
                    }}
                  />
                  {SITE_AREA_STYLE[k].label}
                </li>
              ))}
              {poiKinds.map((k) => (
                <li key={k}>
                  <span
                    className="hwn-campus-swatch dot"
                    style={{ background: SITE_POI_STYLE[k].color }}
                  />
                  {SITE_POI_STYLE[k].label}
                </li>
              ))}
              {(campus.links?.length ?? 0) > 0 && (
                <li>
                  <span className="hwn-campus-swatch line" style={{ borderColor: '#8b5cf6' }} />
                  Cầu nối
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {data.levels.length > 1 && (
        <div className="hwn-map-floors" role="group" aria-label="Chọn tầng (toàn cơ sở)">
          {[...data.levels].reverse().map((l) => (
            <button
              key={l}
              type="button"
              title={`Tầng ${l}`}
              className={l === level ? 'active' : ''}
              aria-pressed={l === level}
              onClick={() => onLevelChange?.(l)}
            >
              {campusLevelLabel(l)}
              {routeLevels.has(l) && (
                <span className="hwn-map-floor-dot" aria-label="có lộ trình" />
              )}
            </button>
          ))}
        </div>
      )}

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

      <div className="hwn-map-floor-name">
        Tầng {level} · {campus.name}
      </div>
    </div>
  );
}
