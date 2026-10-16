/**
 * Khuôn viên quanh một toà: phần ngoài trời + các toà khác của cơ sở, vẽ theo hệ trục của toà đang
 * xem (bên dưới mặt bằng của toà). Nhờ vậy bản đồ một toà vẫn thấy được cả bệnh viện mà mọi toạ độ
 * (tuyến đường, vị trí, chạm chọn) vẫn giữ theo hệ trục của toà như cũ.
 */
import { useMemo } from 'react';
import {
  boundsOf,
  campusLevel,
  fromSite,
  placedFootprint,
  pointInPolygon,
  toSite,
  type BBox,
  type BuildingPlacement,
  type Department,
  type Floor,
  type Id,
  type Point,
  type SitePlan,
} from '@hwn/map-core';
import type { MapTheme } from '../core/theme';
import { invertFrame, LocalFrame } from './MapStage';
import { SiteBuildings, type SiteBuilding } from './site';
import { SiteGround, sitePlanBounds } from './siteLayers';

export interface CampusNeighbor {
  placement: BuildingPlacement;
  name: string;
  /** Đường bao theo hệ trục của toà đó. */
  footprint: readonly Point[];
  /** Các tầng (đã tải) — để vẽ chi tiết tầng cùng số tầng chung. Bỏ trống = chỉ vẽ đường bao. */
  floors?: readonly Floor[];
}

export interface CampusContext {
  /** Vị trí của toà đang xem trên mặt bằng tổng thể. */
  placement: BuildingPlacement;
  site?: SitePlan;
  /** Tầng chung ứng với mặt đất — phần ngoài trời chỉ vẽ rõ ở tầng này. */
  groundLevel: number;
  /** Các toà khác trong cơ sở. */
  neighbors: readonly CampusNeighbor[];
  departments?: readonly Department[];
  /** Tâm cửa chính các toà (toạ độ mặt bằng tổng thể) — lối đi gần nhất được nối vào cửa. */
  entrances?: readonly Point[];
  /** Đường bao toà đang xem trên mặt bằng tổng thể — để nhãn ngoài trời không bị toà che. */
  ownFootprint?: readonly Point[];
}

/** Hộp bao cả khuôn viên theo hệ trục của toà đang xem. */
export function campusContextBounds(ctx: CampusContext): BBox | null {
  const site = sitePlanBounds(ctx.site);
  const corners = site
    ? [
        { x: site.minX, y: site.minY },
        { x: site.maxX, y: site.minY },
        { x: site.maxX, y: site.maxY },
        { x: site.minX, y: site.maxY },
      ]
    : [];
  return boundsOf(
    [...corners, ...ctx.neighbors.flatMap((n) => placedFootprint(n.placement, n.footprint))].map(
      (p) => fromSite(ctx.placement, p),
    ),
  );
}

/** Toà khác (trong khuôn viên) chứa điểm `p` — `p` theo hệ trục của toà đang xem. */
export function neighborAt(ctx: CampusContext, p: Point): Id | null {
  const q = toSite(ctx.placement, p);
  for (const n of ctx.neighbors) {
    if (n.footprint.length >= 3 && pointInPolygon(q, placedFootprint(n.placement, n.footprint))) {
      return n.placement.buildingId;
    }
  }
  return null;
}

export interface CampusUnderlayProps {
  context: CampusContext;
  /** Số tầng (của toà đang xem) đang hiển thị. */
  floorLevel: number;
  theme: MapTheme;
  /** Toà khác đang được trỏ / chọn (viền nổi bật). */
  highlightId?: Id | null;
  selectedSiteId?: Id | null;
}

/** Khuôn viên (ngoài trời + các toà khác ở cùng tầng chung) vẽ theo hệ trục của toà đang xem. */
export function CampusUnderlay({
  context,
  floorLevel,
  theme,
  highlightId,
  selectedSiteId,
}: CampusUnderlayProps) {
  const level = campusLevel(context.placement, floorLevel);
  /** Nhãn ngoài trời tránh mọi toà (kể cả toà đang xem — vẽ đè lên trên). */
  /** Đường bao mọi toà (kể cả toà đang xem) trên mặt bằng tổng thể. */
  const footprints = useMemo(
    () => [
      ...(context.ownFootprint?.length ? [context.ownFootprint] : []),
      ...context.neighbors.map((n) => placedFootprint(n.placement, n.footprint)),
    ],
    [context.neighbors, context.ownFootprint],
  );
  const avoid = useMemo(
    () =>
      footprints.flatMap((fp) => {
        const b = boundsOf(fp);
        return b ? [b] : [];
      }),
    [footprints],
  );
  const buildings = useMemo<SiteBuilding[]>(
    () =>
      context.neighbors.map((n) => {
        const floor = n.floors?.find((f) => campusLevel(n.placement, f.level) === level);
        return {
          placement: n.placement,
          name: n.name,
          footprint: n.footprint,
          floor,
          departments: context.departments,
          dim: !!n.floors && !floor,
        };
      }),
    [context.neighbors, context.departments, level],
  );
  return (
    <LocalFrame frame={invertFrame(context.placement)}>
      {context.site && (
        <SiteGround
          site={context.site}
          theme={theme}
          dim={level !== context.groundLevel}
          entrances={context.entrances}
          avoid={avoid}
          obstacles={footprints}
          selectedId={selectedSiteId}
        />
      )}
      <SiteBuildings buildings={buildings} theme={theme} hoverId={highlightId} detail />
    </LocalFrame>
  );
}
