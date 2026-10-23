import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Group } from 'react-konva';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  boundsOf,
  buildingFootprint,
  campusBuildingInfo,
  campusGroundLevel,
  campusLevel,
  campusSiteParts,
  campusSockets,
  doorOutward,
  emptySitePlan,
  exteriorSockets,
  floorAtLevel,
  fromSite,
  groundFloor,
  hasExterior,
  lerp,
  mergeLobbies,
  placedFootprint,
  pointInPolygon,
  pointOnWall,
  polygonCentroid,
  rotatePoint,
  validateBuilding,
  type Building,
  type BuildingPlacement,
  type Campus,
  type CampusSocket,
  type Id,
  type Point,
  type ValidationIssue,
} from '@hwn/map-core';
import {
  invertFrame,
  LocalFrame,
  mergeBounds,
  SiteBuildings,
  SiteGround,
  SiteLinks,
  sitePlanBounds,
  useMapTheme,
  type SiteBuilding,
} from '@hwn/map-render';
import { saveAll, useSaveStatus } from '../editor/draft';
import { EditorCanvas, type CanvasCampus, type EditorStageHandle } from '../editor/EditorCanvas';
import { NumberField, Panel, TextField } from '../editor/fields';
import { useFloor3DEditor } from '../editor/edit3d';
import { ExportMenu } from '../editor/ExportMenu';
import { FloorBar } from '../editor/FloorBar';
import { HelpDialog } from '../editor/HelpDialog';
import { IssuesPanel } from '../editor/IssuesPanel';
import { clearBuilding } from '../editor/ops';
import { Grid } from '../editor/overlays';
import { PropertiesPanel } from '../editor/PropertiesPanel';
import { RouteTester } from '../editor/RouteTester';
import { computeTestRoute, ENTRANCE, type RouteQuery } from '../editor/routeTest';
import { StatusBar } from '../editor/StatusBar';
import { dirtyIds, useCurrentFloor, useEditor } from '../editor/store';
import { Toolbar } from '../editor/Toolbar';
import type { ItemRef } from '../editor/types';
import { editorCommands, useEditorShortcuts } from '../editor/useShortcuts';
import { selectionCount } from '../editor/workspace';
import { api, errorMessage } from '../lib/api';
import { createBuilding } from '../lib/buildingActions';
import { useActiveBuilding, useActiveBuildingId, useBuildings, useCampus } from '../lib/queries';
import { useCampusDraft, type MapLayer } from '../site/campusDraft';
import { clearSite } from '../site/siteOps';
import {
  SiteBackground,
  SiteEditorOverlay,
  SiteSidePanel,
  SiteToolbar,
  SiteToolHint,
  useSiteEditor,
  type ExteriorDoor,
} from '../site/useSiteEditor';

const Building3D = lazy(() =>
  import('@hwn/map-render/3d').then((m) => ({ default: m.Building3D })),
);
const Campus3D = lazy(() => import('@hwn/map-render/3d').then((m) => ({ default: m.Campus3D })));

type SideTab = 'props' | 'issues' | 'route';
const SIDE_TABS: readonly SideTab[] = ['props', 'issues', 'route'];

/** Cơ sở rỗng — để hook lớp Ngoài trời luôn được gọi kể cả khi toà chưa thuộc cơ sở nào. */
const NO_CAMPUS: Campus = { id: '', name: '', buildings: [], version: 0, updatedAt: '' };

/** Lớp đang vẽ ở trang Vẽ toà nhà: bên trong toà hay sảnh, dốc… ngoài toà (tầng trệt). */
type BuildingLayer = 'interior' | 'exterior';

const ORIGIN: Pick<BuildingPlacement, 'position' | 'rotation'> = {
  position: { x: 0, y: 0 },
  rotation: 0,
};

/**
 * Cơ sở ảo cho lớp Sảnh & dốc: đúng một toà đặt ở gốc toạ độ, phần ngoài trời = `Building.exterior`
 * (hệ trục của toà) — để dùng lại bộ công cụ vẽ ngoài trời. Sảnh kiểu cũ (sảnh, làn đón, dốc rời)
 * được gộp thành sảnh một đối tượng; lần sửa đầu tiên lưu luôn kiểu mới.
 */
const exteriorCampusOf = (b: Pick<Building, 'id' | 'name' | 'exterior' | 'floors'>): Campus => {
  const ext = b.exterior && mergeLobbies(b.exterior, buildingFootprint(b));
  return {
    id: `exterior:${b.id}`,
    name: b.name,
    buildings: [{ buildingId: b.id, ...ORIGIN }],
    site: {
      ...emptySitePlan(),
      areas: ext?.areas ?? [],
      paths: ext?.paths ?? [],
      lobbies: ext?.lobbies ?? [],
    },
    links: [],
    version: 0,
    updatedAt: '',
  };
};

/** Loại & vị trí của đối tượng có ID `id` trên tầng (dùng để chọn & đưa khung nhìn tới). */
function locate(building: Building, floorId: string, id: string): { ref?: ItemRef; at?: Point } {
  const floor = building.floors.find((f) => f.id === floorId);
  if (!floor) return {};
  const wall = floor.walls.find((w) => w.id === id);
  if (wall) return { ref: { type: 'wall', id }, at: lerp(wall.start, wall.end, 0.5) };
  const opening = floor.openings.find((o) => o.id === id);
  if (opening) {
    const w = floor.walls.find((x) => x.id === opening.wallId);
    return { ref: { type: 'opening', id }, at: w ? pointOnWall(w, opening.offset) : undefined };
  }
  const connector = floor.connectors.find((c) => c.id === id);
  if (connector) return { ref: { type: 'connector', id }, at: polygonCentroid(connector.polygon) };
  const room = floor.rooms.find((r) => r.id === id);
  if (room) return { ref: { type: 'room', id }, at: polygonCentroid(room.polygon) };
  const furniture = floor.furniture?.find((f) => f.id === id);
  if (furniture) return { ref: { type: 'furniture', id }, at: furniture.position };
  const landmark = floor.landmarks?.find((l) => l.id === id);
  if (landmark) return { ref: { type: 'landmark', id }, at: landmark.position };
  const node = floor.navGraph.nodes.find((n) => n.id === id);
  return node ? { ref: { type: 'navNode', id }, at: node.position } : {};
}

/** Thông tin chung của cơ sở (tên, địa chỉ, GPS, hướng Bắc) — sửa trong bản nháp, lưu cùng nút Lưu. */
function CampusInfoPanel({ campus }: { campus: Campus }) {
  const change = useCampusDraft((s) => s.change);
  const geo = campus.geo;
  return (
    <Panel title="Cơ sở">
      <TextField
        label="Tên cơ sở"
        value={campus.name}
        onCommit={(name) => change((c) => ({ ...c, name }))}
      />
      <TextField
        label="Mã"
        value={campus.code ?? ''}
        allowEmpty
        placeholder="vd. CS1"
        onCommit={(code) => change((c) => ({ ...c, code: code || undefined }))}
      />
      <TextField
        label="Địa chỉ"
        value={campus.address ?? ''}
        allowEmpty
        onCommit={(address) => change((c) => ({ ...c, address: address || undefined }))}
      />
      <div className="pf-grid">
        <NumberField
          label="Vĩ độ"
          unit=""
          step={0.0001}
          precision={6}
          value={geo?.lat ?? 0}
          onCommit={(lat) => change((c) => ({ ...c, geo: { lat, lng: c.geo?.lng ?? 0 } }))}
        />
        <NumberField
          label="Kinh độ"
          unit=""
          step={0.0001}
          precision={6}
          value={geo?.lng ?? 0}
          onCommit={(lng) => change((c) => ({ ...c, geo: { lat: c.geo?.lat ?? 0, lng } }))}
        />
      </div>
      <NumberField
        label="Hướng Bắc"
        unit="°"
        step={1}
        value={campus.northAngle ?? 0}
        onCommit={(northAngle) => change((c) => ({ ...c, northAngle }))}
      />
      <p className="muted small">
        Thêm cơ sở, chuyển toà sang cơ sở khác: <Link to="/campuses">Quản lý cơ sở</Link>.
      </p>
    </Panel>
  );
}

/**
 * Trang vẽ bản đồ. Hai trang riêng dùng chung khung vẽ và bản nháp:
 * - `building` (Vẽ toà nhà, /map): tường, cửa, phòng, thang… của mọi toà;
 * - `site` (Khuôn viên, /site): sắp xếp vị trí toà, đường, khu vực, cổng, điểm; vẽ thêm phần ngoài trời.
 */
export function MapEditorPage({ mode }: { mode: MapLayer }) {
  const query = useActiveBuilding();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const theme = useMapTheme('auto');
  const stageRef = useRef<EditorStageHandle>(null);
  const [params, setParams] = useSearchParams();

  const building = useEditor((s) => s.building);
  const show3d = useEditor((s) => s.settings.show3d);
  const editor3d = useFloor3DEditor();
  const gridUnit = useEditor((s) => s.settings.gridUnit);
  const floor = useCurrentFloor();
  const { setSettings, setFloor, select } = useEditor.getState();
  const saveError = useSaveStatus((s) => s.error);

  /* ---------------- Cơ sở chứa toà đang sửa ---------------- */

  const summaries = useBuildings();
  const campusId = summaries.data?.find((b) => b.id === building?.id)?.campusId;
  const campusQuery = useCampus(campusId);
  useEffect(() => {
    if (campusQuery.data) useCampusDraft.getState().load(campusQuery.data);
  }, [campusQuery.data]);
  const storedDraft = useCampusDraft((s) => s.draft);
  const campus = storedDraft && storedDraft.id === campusId ? storedDraft : null;
  const layer = mode;
  /** Từ trang Khuôn viên sang trang Vẽ toà nhà (vd. để vẽ trong một toà). */
  const goBuilding = (search = '') => {
    if (mode === 'site') void navigate(`/map${search}`);
  };

  // Dữ liệu đầy đủ các toà khác để vẽ chi tiết tầng (dùng chung cache với trang khác).
  const otherIds = (campus?.buildings ?? [])
    .map((pl) => pl.buildingId)
    .filter((id) => id !== building?.id);
  const fullQueries = useQueries({
    queries: otherIds.map((id) => ({
      queryKey: ['building-full', id],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.buildings.get(id, { signal }),
    })),
  });
  // Mọi toà của cơ sở đều sửa được: nạp vào editor (giữ bản nháp nếu đã có).
  const loadedOthers = fullQueries.flatMap((q) => (q.data ? [q.data] : []));
  useEffect(() => {
    for (const b of loadedOthers) useEditor.getState().adopt(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theo dữ liệu đã tải
  }, [loadedOthers.map((b) => `${b.id}@${b.version}`).join(',')]);
  const drafts = useEditor((s) => s.drafts);
  // Ưu tiên bản nháp (đã có ngay cả khi query của toà đó đang tải lại).
  const fullById = new Map<Id, Building>(loadedOthers.map((b) => [b.id, b] as const));
  for (const pl of campus?.buildings ?? []) {
    const d = drafts[pl.buildingId];
    if (d) fullById.set(d.id, d);
  }
  if (building) fullById.set(building.id, building);

  // Thông tin rút gọn các toà; toà có bản nháp lấy từ bản nháp (đường bao, cửa mới vẽ).
  const liveInfo = useMemo(() => (building ? campusBuildingInfo(building) : null), [building]);
  const infoById = useMemo(() => {
    const m = new Map((campusQuery.data?.buildingInfo ?? []).map((i) => [i.id, i]));
    for (const id of m.keys()) {
      const d = drafts[id];
      if (d && id !== liveInfo?.id) m.set(id, campusBuildingInfo(d));
    }
    if (liveInfo && m.has(liveInfo.id)) m.set(liveInfo.id, liveInfo);
    return m;
  }, [campusQuery.data, liveInfo, drafts]);

  const placement = campus?.buildings.find((pl) => pl.buildingId === building?.id);
  const level = floor && placement ? campusLevel(placement, floor.level) : (floor?.level ?? 1);
  const levelsOf = (id: Id) =>
    fullById.get(id)?.floors.map((f) => f.level) ?? infoById.get(id)?.levels;
  const groundLevel = campus ? campusGroundLevel(campus, levelsOf) : 1;

  const siteBuildings: SiteBuilding[] = (campus?.buildings ?? []).flatMap((pl) => {
    const info = infoById.get(pl.buildingId);
    if (!info) return [];
    const full = fullById.get(pl.buildingId);
    const f = full && floorAtLevel(full, pl, level);
    return [
      {
        placement: pl,
        name: info.name,
        footprint: info.footprint,
        floor: f,
        departments: building?.departments,
        dim: !!full && !f,
      },
    ];
  });
  const neighbors = siteBuildings.filter((b) => b.placement.buildingId !== building?.id);

  // Vị trí đặt các toà — để dịch vùng chọn trên nhiều toà theo đúng hướng.
  useEffect(() => {
    const frames: Record<Id, Pick<BuildingPlacement, 'position' | 'rotation'>> = {};
    for (const pl of campus?.buildings ?? []) frames[pl.buildingId] = pl;
    useEditor.getState().setFrames(frames);
  }, [campus?.buildings]);

  /* ---------------- Đổi toà ---------------- */

  /** Tầng chung cần mở sau khi chuyển sang toà khác (khi toà đó chưa tải xong). */
  const pendingLevel = useRef<number | null>(null);
  /** Mở toà khác để sửa (bản nháp mọi toà được giữ nguyên, không cần lưu trước). */
  const openBuilding = (id: Id, search = '') => {
    if (!building) return;
    goBuilding(search);
    if (id === building.id) return;
    const target = useEditor.getState().drafts[id];
    const pl = campus?.buildings.find((x) => x.buildingId === id);
    const f = target && pl ? floorAtLevel(target, pl, level) : undefined;
    if (target) useEditor.getState().activate(id, { floorId: f?.id });
    else pendingLevel.current = level;
    useActiveBuildingId.getState().setBuildingId(id);
  };
  useEffect(() => {
    if (!building) return;
    const want = pendingLevel.current;
    if (want === null || !campus) return;
    const pl = campus.buildings.find((x) => x.buildingId === building.id);
    const f = pl && floorAtLevel(building, pl, want);
    if (f) setFloor(f.id);
    pendingLevel.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ khi đổi toà
  }, [building?.id]);

  /* ---------------- Lớp Ngoài trời ---------------- */

  const site = useSiteEditor({
    campus: campus ?? NO_CAMPUS,
    change: (fn, merge) => useCampusDraft.getState().change(fn, merge),
    undo: () => useCampusDraft.getState().undo(),
    redo: () => useCampusDraft.getState().redo(),
    stageRef,
    buildings: siteBuildings,
    fullById,
    infoById,
    level,
    groundLevel,
    currentBuildingId: building?.id ?? '',
    active: layer === 'site',
    onSave: () => void saveAll(queryClient),
    onOpenBuilding: openBuilding,
    onEditExterior: (id) => openBuilding(id, '?layer=exterior'),
  });

  /* ---------------- Lớp Sảnh & dốc (trang Vẽ toà nhà) ---------------- */

  const [buildingLayer, setBuildingLayer] = useState<BuildingLayer>('interior');
  const exteriorLayer = mode === 'building' && buildingLayer === 'exterior';
  const ground = building ? groundFloor(building) : undefined;
  const onGround = !!ground && floor?.id === ground.id;
  /** Đổi lớp; lớp Sảnh & dốc luôn vẽ ở tầng trệt. */
  const switchLayer = (next: BuildingLayer) => {
    if (next === 'exterior' && ground && floor?.id !== ground.id) setFloor(ground.id);
    setBuildingLayer(next);
  };
  // Đổi sang tầng khác khi đang ở lớp Sảnh & dốc: về lớp Trong toà.
  const [lastFloorId, setLastFloorId] = useState(floor?.id);
  if (lastFloorId !== floor?.id) {
    setLastFloorId(floor?.id);
    if (buildingLayer === 'exterior' && ground && floor && floor.id !== ground.id) {
      setBuildingLayer('interior');
    }
  }
  // Mở từ Khuôn viên ("Sửa sảnh & dốc"): /map?layer=exterior.
  const layerParam = params.get('layer');
  const [seenLayerParam, setSeenLayerParam] = useState<string | null>(null);
  if (layerParam !== seenLayerParam) {
    setSeenLayerParam(layerParam);
    if (layerParam === 'exterior') setBuildingLayer('exterior');
  }
  useEffect(() => {
    if (layerParam !== 'exterior' || !building) return;
    if (ground) setFloor(ground.id);
    const next = new URLSearchParams(params);
    next.delete('layer');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ khi có tham số mới
  }, [layerParam, building?.id]);

  const exteriorCampus = useMemo(
    () => (building ? exteriorCampusOf(building) : NO_CAMPUS),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theo phần ngoài trời của toà
    [building?.id, building?.name, building?.exterior],
  );
  /** Cửa ra ngoài trời ở tầng trệt — để đặt sảnh đón dựng sẵn. */
  const exteriorDoors = useMemo<ExteriorDoor[]>(() => {
    if (!ground) return [];
    return ground.openings.flatMap((o) => {
      if (o.type === 'window') return [];
      const wall = ground.walls.find((w) => w.id === o.wallId);
      if (!wall) return [];
      const position = pointOnWall(wall, o.offset);
      const outward = doorOutward(ground, wall, position);
      return outward
        ? [{ openingId: o.id, position, outward, entrance: o.type === 'entrance' }]
        : [];
    });
  }, [ground]);
  /** Đầu nối của toà (hệ trục toà) kèm trạng thái đã nối với đường khuôn viên. */
  const ownSockets = useMemo<CampusSocket[]>(() => {
    if (!building || !hasExterior(building.exterior) || !liveInfo) return [];
    if (campus && placement) {
      return campusSockets(
        campus,
        (id) => infoById.get(id)?.exterior,
        (id) => infoById.get(id)?.footprint,
      )
        .filter((x) => x.buildingId === building.id)
        .map((x) => ({
          ...x,
          position: fromSite(placement, x.position),
          dir: rotatePoint(x.dir, { x: 0, y: 0 }, -placement.rotation),
        }));
    }
    return exteriorSockets(building.exterior, liveInfo.footprint).map((x) => ({
      ...x,
      buildingId: building.id,
      linked: false,
    }));
  }, [building, liveInfo, campus, placement, infoById]);
  const exteriorInfo = useMemo(
    () => new Map(liveInfo ? [[liveInfo.id, liveInfo] as const] : []),
    [liveInfo],
  );
  const exteriorFull = useMemo(
    () => new Map(building ? [[building.id, building] as const] : []),
    [building],
  );
  const exterior = useSiteEditor({
    scope: 'building',
    campus: exteriorCampus,
    // Sửa phần ngoài trời của toà đang mở (bản nháp toà, lưu cùng nút Lưu, hoàn tác chung với toà).
    change: (fn, merge) => {
      const b = useEditor.getState().building;
      if (!b) return;
      const next = fn(exteriorCampusOf(b)).site;
      useEditor.getState().edit(
        (d) => {
          if (next && (next.areas.length || next.paths.length || next.lobbies?.length)) {
            d.exterior = {
              areas: next.areas,
              paths: next.paths,
              ...(next.lobbies?.length ? { lobbies: next.lobbies } : {}),
            };
          } else {
            delete d.exterior;
          }
        },
        { merge },
      );
    },
    undo: () => useEditor.getState().undo(),
    redo: () => useEditor.getState().redo(),
    stageRef,
    buildings: [],
    fullById: exteriorFull,
    infoById: exteriorInfo,
    level,
    groundLevel,
    currentBuildingId: building?.id ?? '',
    active: exteriorLayer,
    onSave: () => void saveAll(queryClient),
    onOpenBuilding: () => {},
    doors: exteriorDoors,
    sockets: ownSockets,
  });
  /** Sảnh, dốc… của toà đang mở (hệ trục toà) để vẽ ở tầng trệt. */
  const ownExterior = exterior.fullSite;
  /** Khuôn viên quanh toà (trừ phần của chính toà) — làm nền mờ ở lớp Sảnh & dốc để căn chân dốc. */
  const campusAround = useMemo(
    () =>
      campus && placement && exteriorLayer
        ? campusSiteParts(campus, (id) =>
            id === building?.id ? undefined : infoById.get(id)?.exterior,
          ).site
        : null,
    [campus, placement, exteriorLayer, infoById, building?.id],
  );
  const ownObstacles = useMemo(
    () => (liveInfo && liveInfo.footprint.length >= 3 ? [liveInfo.footprint] : []),
    [liveInfo],
  );
  const exteriorBounds = useMemo(
    () =>
      exteriorLayer
        ? mergeBounds([boundsOf(liveInfo?.footprint ?? []), sitePlanBounds(ownExterior)])
        : null,
    [exteriorLayer, liveInfo, ownExterior],
  );

  const campusBounds = useMemo(
    () =>
      campus
        ? mergeBounds([
            boundsOf(
              campus.buildings.flatMap((pl) =>
                placedFootprint(pl, infoById.get(pl.buildingId)?.footprint ?? []),
              ),
            ),
            sitePlanBounds(site.fullSite),
          ])
        : null,
    [campus, infoById, site.fullSite],
  );
  const ownFootprint = useMemo(
    () => (placement && liveInfo ? placedFootprint(placement, liveInfo.footprint) : []),
    [placement, liveInfo],
  );
  /** Đường bao mọi toà trên mặt bằng tổng thể (toà đang sửa theo bản nháp). */
  const siteFootprints = useMemo(
    () =>
      (campus?.buildings ?? []).flatMap((pl) => {
        if (pl.buildingId === building?.id) return ownFootprint.length ? [ownFootprint] : [];
        const info = infoById.get(pl.buildingId);
        return info ? [placedFootprint(pl, info.footprint)] : [];
      }),
    [campus?.buildings, building?.id, ownFootprint, infoById],
  );
  const entranceSites = site.entrances.map((e) => e.site);
  const labelAvoid = useMemo(
    () =>
      siteBuildings.flatMap((b) => {
        const bb = boundsOf(placedFootprint(b.placement, b.footprint));
        return bb ? [bb] : [];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campus?.buildings, infoById],
  );

  // Trang Vẽ toà nhà vẽ đúng một toà (toà đang mở, theo hệ trục của toà) — không có toà khác hay
  // phần ngoài trời. Khung vẽ theo mặt bằng tổng thể chỉ dùng ở trang Khuôn viên.
  const canvasCampus: CanvasCampus | null =
    mode === 'site' && campus && placement
      ? {
          placement,
          underlay: (
            <Group>
              <SiteBackground campus={campus} />
              <Grid unit={gridUnit} minor={1} theme={theme} />
              {(campus.site || site.owner.size > 0) && (
                <SiteGround
                  site={site.fullSite}
                  theme={theme}
                  dim={level !== groundLevel}
                  selectedId={site.selected?.type !== 'building' ? site.selected?.id : null}
                  entrances={entranceSites}
                  avoid={labelAvoid}
                  obstacles={siteFootprints}
                />
              )}
              <SiteBuildings
                buildings={neighbors}
                theme={theme}
                detail
                selectedId={null}
                hoverId={null}
              />
              <SiteLinks
                links={site.linksAtLevel}
                theme={theme}
                selectedId={site.selected?.type === 'link' ? site.selected.id : null}
              />
            </Group>
          ),
          fitKey: `${campus.id}:${building?.id}`,
          overlay: layer === 'site' ? <SiteEditorOverlay ed={site} theme={theme} /> : null,
          site:
            layer === 'site'
              ? {
                  down: site.down,
                  move: site.move,
                  up: site.up,
                  cursor: site.cursorStyle,
                  panButtons: site.panButtons,
                }
              : null,
          onDblClick: (p) => {
            if (layer === 'site') {
              site.dblClick(p);
              return;
            }
            // Lớp Trong toà: double-click vào toà khác để chuyển sang vẽ toà đó.
            if (pointInPolygon(p, ownFootprint)) return;
            const other = neighbors.find(
              (b) =>
                b.footprint.length >= 3 &&
                pointInPolygon(p, placedFootprint(b.placement, b.footprint)),
            );
            if (other) openBuilding(other.placement.buildingId);
          },
        }
      : mode === 'building'
        ? {
            // Trang Vẽ toà nhà: hệ trục của toà; sảnh, dốc… vẽ dưới tầng trệt.
            placement: ORIGIN,
            underlay: (
              <Group>
                {exteriorLayer && <Grid unit={gridUnit} minor={0.5} theme={theme} />}
                {campusAround && placement && (
                  <LocalFrame frame={invertFrame(placement)}>
                    <SiteGround
                      site={campusAround}
                      theme={theme}
                      dim
                      labels={false}
                      obstacles={siteFootprints}
                    />
                    <SiteBuildings
                      buildings={neighbors.map((b) => ({ ...b, floor: undefined, dim: true }))}
                      theme={theme}
                      selectedId={null}
                      hoverId={null}
                    />
                  </LocalFrame>
                )}
                {onGround && hasExterior(building?.exterior) && (
                  <SiteGround
                    site={ownExterior}
                    theme={theme}
                    selectedId={
                      exteriorLayer && exterior.selected?.type !== 'building'
                        ? exterior.selected?.id
                        : null
                    }
                    entrances={exteriorDoors.filter((d) => d.entrance).map((d) => d.position)}
                    obstacles={ownObstacles}
                  />
                )}
              </Group>
            ),
            fitKey: `${building?.id}:${floor?.id}:${buildingLayer}`,
            bounds: exteriorBounds,
            overlay: exteriorLayer ? <SiteEditorOverlay ed={exterior} theme={theme} /> : null,
            site: exteriorLayer
              ? {
                  down: exterior.down,
                  move: exterior.move,
                  up: exterior.up,
                  cursor: exterior.cursorStyle,
                  panButtons: exterior.panButtons,
                }
              : null,
          }
        : null;

  /* ---------------- Bảng bên phải (lớp Trong toà) ---------------- */

  const paramTab = params.get('tab') as SideTab | null;
  const [tab, setTab] = useState<SideTab>(
    paramTab && SIDE_TABS.includes(paramTab) ? paramTab : 'props',
  );
  // Lưu thất bại vì dữ liệu còn lỗi → mở tab Kiểm tra.
  const [lastError, setLastError] = useState(saveError);
  if (lastError !== saveError) {
    setLastError(saveError);
    if (saveError?.invalid) setTab('issues');
  }
  // Ở trang Khuôn viên mà lưu bị chặn vì toà còn lỗi: sang trang Vẽ toà nhà để xem lỗi.
  useEffect(() => {
    if (saveError?.invalid) goBuilding('?tab=issues');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveError]);

  const [routeQuery, setRouteQuery] = useState<RouteQuery>({
    fromId: ENTRANCE,
    toId: '',
    accessibleOnly: false,
  });

  const validation = useMemo(() => (building ? validateBuilding(building) : null), [building]);
  const errorCount = validation?.issues.filter((i) => i.severity === 'error').length ?? 0;
  /** Số lỗi của các toà khác có thay đổi chưa lưu (lưu sẽ bị chặn). */
  const otherErrors = useMemo(
    () =>
      dirtyIds({ drafts, savedById: useEditor.getState().savedById })
        .filter((id) => id !== building?.id)
        .map((id) => ({
          id,
          name: drafts[id]!.name,
          count: validateBuilding(drafts[id]!).issues.filter((i) => i.severity === 'error').length,
        }))
        .filter((x) => x.count > 0),
    [drafts, building?.id],
  );
  const peerSelected = useEditor((s) => selectionCount(s) - s.selection.length);
  const totalErrors = errorCount + otherErrors.reduce((n, x) => n + x.count, 0);
  const routeResult = useMemo(
    () => (building && tab === 'route' ? computeTestRoute(building, routeQuery) : null),
    [building, routeQuery, tab],
  );

  useEditorShortcuts({
    onSave: () => void saveAll(queryClient),
    stageRef,
    active: layer === 'building' && !exteriorLayer,
  });

  const focus = (floorId: string, id: string) => {
    if (!building) return;
    setFloor(floorId);
    const { ref, at } = locate(building, floorId, id);
    if (ref) select([ref]);
    // Đợi tầng mới được căn khung xong rồi mới đưa tới đối tượng.
    if (at) setTimeout(() => stageRef.current?.centerOn(at, 30), 50);
  };

  // Mở từ trang Khoa phòng: /map?room=<id> → chuyển tới phòng đó.
  const roomParam = params.get('room');
  useEffect(() => {
    if (!roomParam || !building) return;
    const floorOfRoom = building.floors.find((f) => f.rooms.some((r) => r.id === roomParam));
    if (floorOfRoom) focus(floorOfRoom.id, roomParam);
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy khi có tham số mới
  }, [roomParam, building !== null]);

  const focusIssue = (issue: ValidationIssue) => {
    if (issue.floorId && issue.refId) focus(issue.floorId, issue.refId);
    else if (issue.floorId) setFloor(issue.floorId);
  };

  if (query.isPending && !building) return <p className="muted">Đang tải…</p>;
  if (query.isError && !building) return <p className="error">{errorMessage(query.error)}</p>;
  if (!building || !floor) return null;
  if (mode === 'site' && !campus) {
    if (campusId && campusQuery.isPending) return <p className="muted">Đang tải…</p>;
    return (
      <div className="stack">
        <h1>Khuôn viên</h1>
        <p className="muted">
          Toà "{building.name}" chưa thuộc cơ sở nào. Thêm toà vào một cơ sở ở trang{' '}
          <Link to="/campuses">Quản lý cơ sở</Link> để sắp xếp khuôn viên.
        </p>
      </div>
    );
  }

  const siteIssueCount =
    site.validation.issues.length + site.unlinked.length + site.unlinkedSockets.length;

  /** Các toà của cơ sở (mỗi lần vẽ một toà — bấm để đổi, bản nháp các toà được giữ). */
  const unsaved = new Set(dirtyIds({ drafts, savedById: useEditor.getState().savedById }));
  const buildingTabs = (campus?.buildings.map((pl) => pl.buildingId) ?? [building.id]).map(
    (id) => ({
      id,
      name: drafts[id]?.name ?? infoById.get(id)?.name ?? id,
      dirty: unsaved.has(id),
    }),
  );

  /** Thêm toà mới (vào cơ sở đang xem) rồi mở luôn toà đó để vẽ. */
  const addBuilding = async () => {
    const name = window.prompt('Tên toà nhà mới, vd. Khu C – Ngoại trú')?.trim();
    if (!name) return;
    try {
      if (await createBuilding(queryClient, { name, campusId: campus?.id })) goBuilding();
    } catch (err) {
      window.alert(errorMessage(err));
    }
  };

  /** Xoá toàn bộ: trang Vẽ toà nhà xoá nội dung mọi tầng của toà đang mở; trang Khuôn viên xoá phần ngoài trời. */
  const clearAll = () => {
    if (mode === 'site') {
      if (!campus) return;
      const ok = window.confirm(
        `Xoá toàn bộ đường, khu vực, cổng, điểm ngoài trời và cầu nối của "${campus.name}"?\n\nVị trí các toà và ảnh nền được giữ lại. Chưa bấm Lưu thì vẫn hoàn tác được (Ctrl+Z).`,
      );
      if (!ok) return;
      useCampusDraft.getState().change(clearSite);
      site.setSelected(null);
      return;
    }
    const ok = window.confirm(
      `Xoá mọi tường, cửa, phòng, thang… trên ${building.floors.length} tầng của "${building.name}"?\n\nCác tầng được giữ lại. Chưa bấm Lưu thì vẫn hoàn tác được (Ctrl+Z).`,
    );
    if (!ok) return;
    const editor = useEditor.getState();
    editor.edit((b) => clearBuilding(b));
    editor.clearSelection();
  };

  return (
    <div className="editor">
      <header className="editor-header">
        <h1>{mode === 'site' ? 'Khuôn viên' : 'Vẽ toà nhà'}</h1>
        {mode === 'building' && (
          <div className="building-tabs" role="tablist" aria-label="Toà đang vẽ">
            {buildingTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === building.id}
                className={`floor-tab${t.id === building.id ? ' active' : ''}`}
                title={t.dirty ? `${t.name} — có thay đổi chưa lưu` : t.name}
                onClick={() => openBuilding(t.id)}
              >
                {t.name}
                {t.dirty && <span aria-hidden> •</span>}
              </button>
            ))}
          </div>
        )}
        <div className="editor-context" hidden={mode !== 'site'}>
          {mode === 'site' ? (
            <>
              <strong>{campus?.name}</strong>
              {siteIssueCount > 0 && (
                <span className="muted small"> · {siteIssueCount} cảnh báo</span>
              )}
            </>
          ) : null}
        </div>
        {mode === 'building' && (
          <div className="layer-switch" role="tablist" aria-label="Lớp đang vẽ">
            <button
              type="button"
              role="tab"
              aria-selected={!exteriorLayer}
              className={!exteriorLayer ? 'active' : ''}
              title="Tường, cửa, phòng, thang… bên trong toà"
              onClick={() => switchLayer('interior')}
            >
              Trong toà
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={exteriorLayer}
              className={exteriorLayer ? 'active' : ''}
              title="Sảnh, khu đón trả khách, làn đón, dốc lên sảnh… ngoài toà (tầng trệt) — đi theo toà ở trang Khuôn viên"
              onClick={() => switchLayer('exterior')}
            >
              Sảnh & dốc
              {ownSockets.some((x) => !x.linked) && campus ? (
                <span aria-label="có đầu nối chưa nối"> •</span>
              ) : null}
            </button>
          </div>
        )}
        <FloorBar />
        <div className="editor-actions">
          <button
            type="button"
            className="btn btn-sm"
            title={
              campus
                ? `Thêm toà mới vào "${campus.name}" (đặt cạnh các toà hiện có)`
                : 'Thêm toà nhà mới'
            }
            onClick={() => void addBuilding()}
          >
            + Thêm toà
          </button>
          <button
            type="button"
            className="btn btn-sm"
            title="Phím tắt và cách dùng các công cụ (? hoặc F1)"
            onClick={() => editorCommands.toggleHelp(true)}
          >
            ? Hướng dẫn
          </button>
          <button
            type="button"
            className={`btn btn-sm${show3d ? ' btn-active' : ''}`}
            aria-pressed={show3d}
            onClick={() => setSettings({ show3d: !show3d })}
          >
            Xem 3D
          </button>
          {mode === 'building' && <ExportMenu />}
          <button
            type="button"
            className="btn btn-sm btn-danger"
            title={
              mode === 'site'
                ? 'Xoá toàn bộ đường, khu vực, cổng, điểm ngoài trời và cầu nối'
                : 'Xoá mọi tường, cửa, phòng, thang… của toà đang mở'
            }
            onClick={clearAll}
          >
            Xoá toàn bộ
          </button>
        </div>
      </header>

      <div className="editor-body">
        {layer === 'site' ? (
          <SiteToolbar ed={site} />
        ) : exteriorLayer ? (
          <SiteToolbar ed={exterior} />
        ) : (
          <Toolbar />
        )}
        <div className={`editor-viewports${show3d ? ' split' : ''}`}>
          <div className="editor-canvas">
            <EditorCanvas
              stageRef={stageRef}
              route={routeResult && 'route' in routeResult ? routeResult.route : null}
              campus={canvasCampus}
              campusBounds={campusBounds}
            />
            {layer === 'site' && <SiteToolHint ed={site} />}
            {exteriorLayer && <SiteToolHint ed={exterior} />}
            <div className="editor-zoom">
              <button
                type="button"
                aria-label="Phóng to"
                title="Phóng to (+)"
                onClick={() => stageRef.current?.zoomBy(1.4)}
              >
                +
              </button>
              <button
                type="button"
                aria-label="Thu nhỏ"
                title="Thu nhỏ (-)"
                onClick={() => stageRef.current?.zoomBy(1 / 1.4)}
              >
                −
              </button>
              <button
                type="button"
                aria-label="Xem cả toà"
                title="Xem cả toà (Shift+1)"
                onClick={() => stageRef.current?.fit()}
              >
                ⤢
              </button>
              {campus && mode === 'site' && (
                <button
                  type="button"
                  aria-label="Xem cả khuôn viên"
                  title="Xem cả khuôn viên"
                  onClick={() => stageRef.current?.fitAll()}
                >
                  ⛶
                </button>
              )}
            </div>
          </div>
          {show3d && (
            <div className="editor-3d">
              <Suspense fallback={<p className="muted center">Đang tải 3D…</p>}>
                {campus && mode === 'site' ? (
                  <Campus3D
                    buildings={campus.buildings.map((pl) => ({
                      placement: pl,
                      id: pl.buildingId,
                      name: infoById.get(pl.buildingId)?.name ?? pl.buildingId,
                      footprint: infoById.get(pl.buildingId)?.footprint ?? [],
                      floors: fullById.get(pl.buildingId)?.floors,
                    }))}
                    site={site.fullSite}
                    links={site.allLinks}
                    selectedLinkId={site.selected?.type === 'link' ? site.selected.id : null}
                    departments={building.departments}
                    level={level}
                    focusBuildingId={building.id}
                    onBuildingClick={openBuilding}
                  />
                ) : hasExterior(building.exterior) && onGround ? (
                  // Toà có sảnh / dốc: dựng cả phần ngoài trời của toà quanh tầng trệt.
                  <Campus3D
                    buildings={[
                      {
                        placement: { buildingId: building.id, ...ORIGIN },
                        id: building.id,
                        name: building.name,
                        footprint: liveInfo?.footprint ?? [],
                        floors: building.floors,
                      },
                    ]}
                    site={ownExterior}
                    departments={building.departments}
                    level={floor.level}
                    focusBuildingId={building.id}
                    editor={editor3d}
                  />
                ) : (
                  <Building3D building={building} floorIds={[floor.id]} editor={editor3d} />
                )}
              </Suspense>
            </div>
          )}
        </div>
        <aside className="editor-side">
          {layer === 'site' && campus ? (
            <div className="editor-side-body">
              <SiteSidePanel
                ed={site}
                bounds={campusBounds}
                campusInfo={<CampusInfoPanel campus={campus} />}
              />
            </div>
          ) : exteriorLayer ? (
            <div className="editor-side-body">
              <SiteSidePanel ed={exterior} bounds={exteriorBounds} />
            </div>
          ) : (
            <>
              <div className="tabs" role="tablist">
                {(
                  [
                    ['props', 'Thuộc tính'],
                    ['issues', totalErrors ? `Kiểm tra (${totalErrors})` : 'Kiểm tra'],
                    ['route', 'Thử chỉ đường'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    className={`tab${tab === id ? ' active' : ''}${id === 'issues' && totalErrors ? ' has-error' : ''}`}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="editor-side-body">
                {tab === 'props' && peerSelected > 0 && (
                  <p className="peer-note small">
                    Đang chọn thêm {peerSelected} đối tượng ở toà khác — kéo, phím mũi tên và Delete
                    áp dụng cho tất cả. Bảng dưới là phần thuộc "{building.name}".
                  </p>
                )}
                {tab === 'props' && <PropertiesPanel />}
                {tab === 'issues' && otherErrors.length > 0 && (
                  <div className="peer-note small">
                    Toà khác còn lỗi (chưa lưu được):
                    {otherErrors.map((x) => (
                      <button
                        key={x.id}
                        type="button"
                        className="link-button"
                        onClick={() => openBuilding(x.id)}
                      >
                        {x.name} ({x.count})
                      </button>
                    ))}
                  </div>
                )}
                {tab === 'issues' && validation && (
                  <IssuesPanel issues={validation.issues} onFocus={focusIssue} />
                )}
                {tab === 'route' && (
                  <RouteTester
                    building={building}
                    query={routeQuery}
                    onChange={setRouteQuery}
                    result={routeResult}
                  />
                )}
              </div>
            </>
          )}
        </aside>
      </div>
      <StatusBar />
      <HelpDialog />
    </div>
  );
}
