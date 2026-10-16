// Phần 2D + viewer. Building3D nằm ở entry riêng `@hwn/map-render/3d` (được MapViewer tải lười).
export * from './types';
export * from './core/theme';
export * from './core/hooks';
export * from './core/viewport';
export * from './core/walls';
export * from './core/route';
export {
  invertFrame,
  LocalFrame,
  MapStage,
  usePx,
  useViewportRotation,
  useViewportScale,
  useViewRect,
  type FrameTransform,
  type MapStageHandle,
  type MapStageProps,
} from './two-d/MapStage';
export {
  CampusUnderlay,
  campusContextBounds,
  neighborAt,
  type CampusContext,
  type CampusNeighbor,
  type CampusUnderlayProps,
} from './two-d/campusContext';
export * from './two-d/layers';
export {
  SiteBuildings,
  siteBuildingAt,
  SiteMap,
  type SiteBuilding,
  type SiteMapProps,
} from './two-d/site';
export {
  GATE_CLOSED_COLOR,
  GATE_COLOR,
  gateShape,
  SITE_AREA_STYLE,
  SITE_PATH_STYLE,
  SITE_POI_STYLE,
  SITE_RAMP_USE_STYLE,
  rampLabel,
  rampStyle,
  SiteGround,
  SiteLinks,
  sitePathLegend,
  sitePlanBounds,
  VEHICLE_ACCESS_STYLE,
  type SiteGroundProps,
  type SitePathLegendItem,
  type SiteSwatch,
} from './two-d/siteLayers';
export { CampusViewer, campusLevelLabel, type CampusViewerProps } from './viewer/CampusViewer';
export { FloorPlan2D, type FloorPlan2DProps } from './two-d/FloorPlan2D';
export { MapViewer, shortFloorLabel, type MapViewerProps } from './viewer/MapViewer';
export * from './core/doors';
export * from './core/connectors';
export * from './core/landmarks';
