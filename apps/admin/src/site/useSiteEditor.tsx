/**
 * Lớp "Ngoài trời" của trang Bản đồ: sắp xếp vị trí (chọn nhiều, kéo, xoay, nhập toạ độ) các toà,
 * đường, khu vực, cổng, điểm trên mặt bằng tổng thể; chế độ "Vẽ thêm" để tạo đường, dốc, khu vực,
 * cổng, điểm ngoài trời, cầu nối — trên cùng khung với mặt bằng các toà.
 * Toạ độ ở đây là toạ độ mặt bằng tổng thể (m).
 *
 * Cùng bộ điều khiển này dùng cho lớp "Sảnh & dốc" của trang Vẽ toà nhà (`scope: 'building'`):
 * `campus` là một cơ sở ảo chứa đúng toà đó ở gốc toạ độ, `site` = phần ngoài trời CỦA TOÀ
 * (`Building.exterior`, hệ trục của toà). Ở Khuôn viên, phần của các toà được vẽ chung với khuôn
 * viên, đi theo toà khi kéo / xoay; các đầu nối (chân dốc, đầu lối đi bộ) hiện chấm cam khi chưa có
 * đường nối tới — đường vẽ mới bắt dính vào đó, và có nút tự nối vào đường gần nhất.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Circle, Group, Line, Rect } from 'react-konva';
import {
  add,
  buildingDoors,
  campusSiteParts,
  campusSockets,
  createId,
  emptySitePlan,
  lobbyParts,
  lobbyPolygon,
  newLobby,
  rampCenterline,
  socketConnector,
  DEFAULT_LINK_HEIGHT,
  DEFAULT_LINK_WIDTH,
  distance,
  footprintCenter,
  fromSite,
  linkElevation,
  placedFootprint,
  rotatePlacement,
  snapToGrid,
  sub,
  type BBox,
  toSite,
  validateCampus,
  type Building,
  type BuildingPlacement,
  type Campus,
  type CampusBuildingInfo,
  type CampusSocket,
  type Id,
  type Point,
  type SiteAreaKind,
  type SiteGateKind,
  type SiteLobby,
  type SitePath,
  type SitePathKind,
  type SitePoiKind,
  type SiteRampUse,
} from '@hwn/map-core';
import {
  flattenPoints,
  SITE_POI_STYLE,
  SITE_RAMP_USE_STYLE,
  SiteGround,
  siteBuildingAt,
  usePx,
  type MapStageHandle,
  type MapTheme,
  type SiteBuilding,
} from '@hwn/map-render';
import { calibrateBackground } from '../editor/ops';
import { ACCENT, BackgroundImage, CalibrationOverlay } from '../editor/overlays';
import { isTyping, letterOf } from '../editor/keyboard';
import { ARROW_DIRS, panByArrow } from '../editor/useShortcuts';
import { readImageAsDataUrl } from '../editor/image';
import { BuildingHeightFields } from '../editor/BuildingHeightFields';
import { NumberField, Panel } from '../editor/fields';
import { useEditor } from '../editor/store';
import {
  AREA_KINDS,
  EXTERIOR_AREA_OPTIONS,
  EXTERIOR_PATH_OPTIONS,
  GATE_KINDS,
  PATH_KINDS,
  POI_KINDS,
  RAMP_USES,
} from './kinds';
import { AreaPanel, GatePanel, LinkPanel, LobbyPanel, PathPanel, PoiPanel } from './SitePanels';
import {
  addArea,
  addLobby,
  dragLobbyHandle,
  lobbyHandles,
  patchItem,
  addGate,
  addLink,
  addPath,
  addPoi,
  applyGroupMove,
  deleteItems,
  findLink,
  groupOrigin,
  hitSite,
  hitVertex,
  insertPath,
  magnetToRoad,
  refPoints,
  removeVertex,
  rotateItems,
  sameSiteRef,
  selectionCenter,
  setVertex,
  siteItemsInBox,
  SITE_TYPE_LABEL,
  snapToSitePath,
  snapToSiteVertex,
  toggleRef,
  unlinkedEntrances,
  type GroupOrigin,
  type LobbyHandle,
  type SiteRef,
} from './siteOps';

const GRID = 1;
/** Lưới bắt dính khi vẽ sảnh / dốc trong toà (m). */
const BUILDING_GRID = 0.5;
const PICK_PX = 8;
const SNAP_PX = 10;
/** Bán kính hút chân dốc vào làn xe khi kéo toà (px). */
const MAGNET_PX = 16;

export type SiteTool = 'select' | 'path' | 'area' | 'gate' | 'poi' | 'link' | 'lobby';

/** `campus`: trang Khuôn viên. `building`: lớp Sảnh & dốc của trang Vẽ toà nhà. */
export type SiteScope = 'campus' | 'building';

/** Công cụ của từng phạm vi (theo thứ tự trên thanh công cụ). */
const SCOPE_TOOLS: Record<SiteScope, readonly SiteTool[]> = {
  campus: ['select', 'path', 'area', 'gate', 'poi', 'link'],
  building: ['select', 'lobby', 'path', 'area'],
};

/** Gợi ý riêng khi vẽ sảnh / dốc của toà. */
const BUILDING_HINTS: Partial<Record<SiteTool, { label?: string; hint: string }>> = {
  select: {
    hint: 'Click chọn sảnh / làn / dốc · Shift+click hoặc Shift+kéo khung để chọn nhiều · kéo để dời (Alt = không bám lưới) · R / Shift+R xoay 15° · sảnh: kéo ô vuông giữa cạnh để đổi kích thước · đường / khu vực: kéo ô vuông ở đỉnh để sửa hình (Alt+click xoá đỉnh)',
  },
  path: {
    label: 'Dốc / làn xe / lối đi',
    hint: 'Click từng điểm theo tim đường · dốc vẽ từ CHÂN DỐC (phía đường khuôn viên) lên sảnh — chân dốc là đầu nối · Enter / double-click để kết thúc · bắt dính vào đỉnh có sẵn, cửa chính và tim làn khác',
  },
  area: {
    label: 'Sảnh / khu đón khách',
    hint: 'Click từng đỉnh · click lại đỉnh đầu hoặc Enter để khép vùng · sảnh (sân lát) đặt sát tường trước cửa chính',
  },
};

/** Cửa ra ngoài trời ở tầng trệt (hệ trục toà) — để đặt sảnh đón dựng sẵn. */
export interface ExteriorDoor {
  openingId: Id;
  position: Point;
  /** Hướng từ cửa nhìn ra ngoài toà (vector đơn vị). */
  outward: Point;
  /** Cửa ra vào chính (ưu tiên). */
  entrance: boolean;
}

const icon = (children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {children}
  </svg>
);

export const SITE_TOOLS: {
  tool: SiteTool;
  label: string;
  key: string;
  icon: ReactNode;
  hint: string;
}[] = [
  {
    tool: 'select',
    label: 'Chọn / di chuyển',
    key: 'V',
    icon: icon(<path d="M5 3l13 8-6 1.5L9 19z" />),
    hint: 'Click chọn toà / đường / khu vực / cổng / điểm · Shift+click hoặc Shift+kéo khung để chọn nhiều · kéo để di chuyển cả nhóm (Alt = không bám lưới) · R / Shift+R xoay 15° · mũi tên dời 1 m · double-click vào toà để vẽ trong toà đó',
  },
  {
    tool: 'path',
    label: 'Đường / dốc / lối đi',
    key: 'P',
    icon: icon(<path d="M5 21L9 3M19 21L15 3M12 5v2M12 11v2M12 17v2" />),
    hint: 'Click từng điểm theo tim đường · Enter / double-click để kết thúc · Backspace bỏ điểm cuối · bắt dính vào đỉnh có sẵn và cửa chính · dốc vẽ từ chân dốc lên sảnh',
  },
  {
    tool: 'area',
    label: 'Khu vực',
    key: 'A',
    icon: icon(<path d="M4 8l7-4 9 5-3 11H6z" />),
    hint: 'Click từng đỉnh · click lại đỉnh đầu hoặc Enter để khép vùng · Esc để huỷ',
  },
  {
    tool: 'gate',
    label: 'Cổng',
    key: 'G',
    icon: icon(<path d="M4 21V5M20 21V5M4 9h16M9 9v12M15 9v12" />),
    hint: 'Click để đặt cổng ra vào khuôn viên (đặt lên hàng rào / đầu đường)',
  },
  {
    tool: 'poi',
    label: 'Điểm ngoài trời',
    key: 'O',
    icon: icon(<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11zM12 10h.01" />),
    hint: 'Click để đặt ATM, ki-ốt, căng tin, điểm đón xe, điểm Cấp cứu…',
  },
  {
    tool: 'link',
    label: 'Cầu nối giữa toà',
    key: 'L',
    icon: icon(<path d="M3 16c3-6 15-6 18 0M3 16v4M21 16v4M8 12.5V20M16 12.5V20" />),
    hint: 'Click một cửa trên tường ngoài (chấm tím) của toà thứ nhất rồi một cửa của toà thứ hai — cùng tầng đang xem. Chưa có cửa thì vẽ cửa trên tường ngoài trước',
  },
  {
    tool: 'lobby',
    label: 'Sảnh',
    key: 'S',
    icon: icon(
      <>
        <path d="M15 3v18" strokeWidth="3" />
        <path d="M15 8h-4v8h4" />
        <path d="M6 21c0-4 3-5 3-9S6 7 6 3" strokeDasharray="2 2" />
      </>,
    ),
    hint: 'Rê chuột tới một cửa ra ngoài (chấm xanh) rồi click: đặt một sảnh (bệ sảnh + bậc / dốc ở các cạnh, tuỳ chọn làn đón ô tô với dốc lên / dốc xuống) · sảnh là một đối tượng: chỉnh cạnh, kích thước ở bảng bên phải hoặc kéo ô vuông giữa cạnh',
  },
];

/** Công cụ (kèm nhãn / gợi ý) theo phạm vi. */
function toolsOf(scope: SiteScope) {
  return SCOPE_TOOLS[scope].map((t) => {
    const def = SITE_TOOLS.find((x) => x.tool === t)!;
    const extra = scope === 'building' ? BUILDING_HINTS[t] : undefined;
    return extra ? { ...def, label: extra.label ?? def.label, hint: extra.hint } : def;
  });
}

type Gesture =
  | { kind: 'group'; origin: GroupOrigin; start: Point; moved: boolean }
  | { kind: 'marquee'; start: Point; end: Point; additive: boolean }
  | { kind: 'vertex'; type: 'area' | 'path'; id: Id; index: number; moved: boolean }
  | { kind: 'lobby'; id: Id; handle: LobbyHandle; origin: SiteLobby; moved: boolean };

/** Kéo ít hơn chừng này (px) khi chọn theo khung thì coi như click. */
const MARQUEE_MIN_PX = 4;

interface DoorAt {
  buildingId: Id;
  floorId: Id;
  openingId: Id;
  site: Point;
  /** Cửa trên tường ngoài — chỉ cửa này mới làm đầu cầu được. */
  exterior: boolean;
}

export interface SiteEditorInput {
  campus: Campus;
  change(fn: (c: Campus) => Campus, merge?: boolean): void;
  undo(): void;
  redo(): void;
  stageRef: RefObject<MapStageHandle | null>;
  /** Mọi toà của cơ sở (kể cả toà đang sửa) — để chọn / kéo toà. */
  buildings: readonly SiteBuilding[];
  /** Dữ liệu đầy đủ đã tải của các toà (toà đang sửa = bản nháp). */
  fullById: ReadonlyMap<Id, Building>;
  infoById: ReadonlyMap<Id, CampusBuildingInfo>;
  /** Tầng chung đang xem. */
  level: number;
  groundLevel: number;
  /** Toà đang mở trong editor (các toà khác sửa độ cao vào bản nháp của chính toà đó). */
  currentBuildingId: Id;
  /** Đang ở trang Khuôn viên (bật phím tắt). */
  active: boolean;
  onSave(): void;
  /** Double-click vào một toà: chuyển sang vẽ trong toà đó. */
  onOpenBuilding(id: Id): void;
  /** Mở trang Vẽ toà nhà ở lớp Sảnh & dốc của toà `id`. */
  onEditExterior?(id: Id): void;
  /** Phạm vi (mặc định `campus`). */
  scope?: SiteScope;
  /** Phạm vi toà: cửa ra ngoài trời ở tầng trệt (hệ trục toà). */
  doors?: readonly ExteriorDoor[];
  /** Phạm vi toà: đầu nối của toà (hệ trục toà), kèm trạng thái đã nối với đường khuôn viên. */
  sockets?: readonly CampusSocket[];
}

/** Bộ điều khiển lớp Ngoài trời. */
export function useSiteEditor(input: SiteEditorInput) {
  const { campus: draft, change, stageRef, buildings, fullById, infoById, level, active } = input;
  const scope = input.scope ?? 'campus';
  const inBuilding = scope === 'building';
  const grid = inBuilding ? BUILDING_GRID : GRID;
  const [tool, setToolState] = useState<SiteTool>('select');
  const [areaKind, setAreaKind] = useState<SiteAreaKind>(inBuilding ? 'plaza' : 'parking');
  const [pathKind, setPathKind] = useState<SitePathKind>(inBuilding ? 'ramp' : 'pedestrian');
  /** Sảnh đón dựng sẵn: khu phục vụ và lối đi bộ trên dốc. */
  const [lobbyUse, setLobbyUse] = useState<SiteRampUse | 'none'>('outpatient');
  const [lobbyWalkway, setLobbyWalkway] = useState(true);
  /** Sảnh mới có làn đón ô tô (dốc lên / dốc xuống). */
  const [lobbyDropoff, setLobbyDropoff] = useState(true);
  /** Cửa đang trỏ khi dùng công cụ Sảnh đón (xem trước cụm sảnh). */
  const [hoverDoor, setHoverDoor] = useState<ExteriorDoor | null>(null);
  const [gateKind, setGateKind] = useState<SiteGateKind>('both');
  const [poiKind, setPoiKind] = useState<SitePoiKind>('atm');
  const [draw, setDraw] = useState<Point[]>([]);
  const [linkFirst, setLinkFirst] = useState<DoorAt | null>(null);
  /** Thông báo của công cụ cầu nối (đã chọn cửa nào, vì sao chưa nối được…). */
  const [linkNote, setLinkNote] = useState<string | null>(null);
  /** Vùng chọn (nhiều đối tượng, kể cả toà). */
  const [selection, setSelection] = useState<SiteRef[]>([]);
  /** Đối tượng đang chọn khi chỉ chọn đúng một. */
  const selected = selection.length === 1 ? selection[0]! : null;
  const setSelected = (ref: SiteRef | null) => setSelection(ref ? [ref] : []);
  /**
   * Chế độ "Vẽ thêm": hiện các công cụ tạo đường, khu vực, cổng, điểm, cầu nối và cho sửa đỉnh.
   * Tắt (mặc định) thì lớp Ngoài trời chỉ để sắp xếp: chọn, kéo, xoay, nhập toạ độ.
   */
  const [drawModeState, setDrawModeState] = useState(false);
  // Lớp Sảnh & dốc luôn ở chế độ vẽ (không có phần sắp xếp toà).
  const drawMode = inBuilding || drawModeState;
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  const [shiftDown, setShiftDown] = useState(false);
  const [hover, setHover] = useState<SiteRef | null>(null);
  const [calibrating, setCalibrating] = useState<Point[] | null>(null);
  const [calDistance, setCalDistance] = useState('');
  const [cursor, setCursor] = useState<Point | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const gesture = useRef<Gesture | null>(null);

  const setTool = (t: SiteTool) => {
    setToolState(t);
    setHoverDoor(null);
    if (t !== 'select') setDrawModeState(true);
    setDraw([]);
    setLinkFirst(null);
    setLinkNote(null);
    setCalibrating(null);
  };
  const setDrawMode = (on: boolean) => {
    if (inBuilding) return;
    setDrawModeState(on);
    if (!on) setTool('select');
  };

  // Rời lớp Ngoài trời thì bỏ thao tác vẽ dở.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) {
      setDraw([]);
      setLinkFirst(null);
      setLinkNote(null);
      setCalibrating(null);
      setHover(null);
      setCursor(null);
      setMarquee(null);
    }
  }

  const placementOf = (id: Id) => draft.buildings.find((pl) => pl.buildingId === id);

  /*
   * Phần ngoài trời đầy đủ: khuôn viên + sảnh, dốc… của các toà (đặt theo vị trí toà). Ở phạm vi toà,
   * cơ sở ảo đã chứa đúng phần của toà nên không ghép thêm.
   */
  const footprintOf = (id: Id) => infoById.get(id)?.footprint;
  const parts = campusSiteParts(
    draft,
    inBuilding ? () => undefined : (id) => infoById.get(id)?.exterior,
  );
  const fullSite = parts.site;
  /** Cơ sở với phần ngoài trời đầy đủ (để bắt dính, kiểm tra lối đi tới cửa chính…). */
  const fullCampus = { ...draft, site: fullSite };
  /** Chỉ phần ngoài trời của các toà — click vào đó là chọn toà. */
  const ownedOnly = useMemo(
    () => ({
      ...draft,
      site: {
        ...emptySitePlan(),
        areas: parts.site.areas.filter((a) => parts.owner.has(a.id)),
        paths: parts.site.paths.filter((x) => parts.owner.has(x.id)),
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theo phần ngoài trời đã ghép
    [parts],
  );
  /** Đầu nối của các toà (chân dốc, đầu lối đi bộ) kèm trạng thái đã nối. */
  const sockets: readonly CampusSocket[] = useMemo(
    () =>
      inBuilding
        ? (input.sockets ?? [])
        : campusSockets(draft, (id) => infoById.get(id)?.exterior, footprintOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theo phần ngoài trời đã ghép + vị trí toà
    [inBuilding, input.sockets, parts, draft.buildings, infoById],
  );
  const unlinkedSockets = sockets.filter((s) => !s.linked);
  const doors = input.doors ?? [];

  /** Cửa (cửa đi + cửa chính) của các toà ở tầng đang xem, theo toạ độ mặt bằng. */
  const doorsAtLevel: DoorAt[] = draft.buildings.flatMap((pl) => {
    const full = fullById.get(pl.buildingId);
    const floor = full?.floors.find((f) => f.level + (pl.levelOffset ?? 0) === level);
    if (!floor) return [];
    return buildingDoors({ floors: [floor] }).map((d) => ({
      buildingId: pl.buildingId,
      floorId: d.floorId,
      openingId: d.openingId,
      site: toSite(pl, d.position),
      exterior: d.exterior ?? true,
    }));
  });
  /** Cửa làm đầu cầu được (trên tường ngoài) ở tầng đang xem. */
  const linkDoors = doorsAtLevel.filter((d) => d.exterior);
  const entrances = draft.buildings.flatMap((pl) => {
    const full = fullById.get(pl.buildingId);
    return full
      ? buildingDoors(full)
          .filter((d) => d.type === 'entrance')
          .map((d) => ({
            buildingId: pl.buildingId,
            openingId: d.openingId,
            site: toSite(pl, d.position),
          }))
      : [];
  });

  const doorSite = (end: { buildingId: Id; openingId: Id }) => {
    const pl = placementOf(end.buildingId);
    const full = fullById.get(end.buildingId);
    const d = full && buildingDoors(full).find((x) => x.openingId === end.openingId);
    return pl && d ? toSite(pl, d.position) : undefined;
  };
  const floorOf = (buildingId: Id, floorId: Id) =>
    fullById.get(buildingId)?.floors.find((x) => x.id === floorId);
  const floorLevel = (buildingId: Id, floorId: Id) => {
    const pl = placementOf(buildingId);
    const f = floorOf(buildingId, floorId);
    return pl && f ? f.level + (pl.levelOffset ?? 0) : null;
  };
  /** Mọi cầu nối với vị trí hai đầu trên mặt bằng, tầng chung và cao độ (cho 2D / 3D). */
  const allLinks = (draft.links ?? []).flatMap((l) => {
    const from = doorSite(l.a);
    const to = doorSite(l.b);
    if (!from || !to) return [];
    return [
      {
        id: l.id,
        name: l.name,
        kind: l.kind,
        from,
        to,
        covered: l.covered,
        width: l.width ?? DEFAULT_LINK_WIDTH,
        height: l.height ?? DEFAULT_LINK_HEIGHT,
        elevation: linkElevation(l, (b, f) => floorOf(b, f)?.elevation),
        autoElevation: linkElevation(
          { ...l, elevation: undefined },
          (b, f) => floorOf(b, f)?.elevation,
        ),
        levels: [floorLevel(l.a.buildingId, l.a.floorId), floorLevel(l.b.buildingId, l.b.floorId)],
      },
    ];
  });
  const linksAtLevel = allLinks.filter((l) => l.levels.includes(level));

  const validation = validateCampus(draft, infoById);
  const unlinked = inBuilding ? [] : unlinkedEntrances(fullCampus, entrances);
  const buildingName = (id: Id) => infoById.get(id)?.name ?? id;

  const updatePlacement = (
    id: Id,
    fn: (pl: BuildingPlacement) => BuildingPlacement,
    merge = false,
  ) =>
    change(
      (c) => ({ ...c, buildings: c.buildings.map((pl) => (pl.buildingId === id ? fn(pl) : pl)) }),
      merge,
    );

  const rotateBy = (id: Id, deg: number) => {
    const fp = infoById.get(id)?.footprint ?? [];
    updatePlacement(id, (pl) => rotatePlacement(pl, footprintCenter(fp), pl.rotation + deg));
  };

  /** Phần vùng chọn dời / xoay được (cầu nối đi theo cửa của toà). */
  const movable = (refs: readonly SiteRef[] = selection) => refs.filter((r) => r.type !== 'link');

  /** Dời vùng chọn đi `d` (m). */
  const moveSelection = (d: Point, refs: readonly SiteRef[] = selection) => {
    const list = movable(refs);
    if (list.length && (d.x || d.y)) change((c) => applyGroupMove(c, groupOrigin(c, list), d));
  };

  /** Xoay vùng chọn `deg` độ (chiều kim đồng hồ): một toà xoay quanh tâm toà, nhóm quanh tâm nhóm. */
  const rotateSelection = (deg: number, refs: readonly SiteRef[] = selection) => {
    const list = movable(refs);
    const only = list.length === 1 ? list[0]! : null;
    if (!list.length || !deg || only?.type === 'gate' || only?.type === 'poi') return;
    if (only?.type === 'building') {
      rotateBy(only.id, deg);
      return;
    }
    const pivot = selectionCenter(draft, list, footprintOf);
    if (pivot) change((c) => rotateItems(c, list, pivot, deg));
  };

  /** Tâm vùng chọn (toạ độ mặt bằng). */
  const center = (refs: readonly SiteRef[] = selection) =>
    selectionCenter(draft, movable(refs), footprintOf);

  /**
   * Nối đầu nối `s` vào đường / lối đi gần nhất (thêm một đoạn đường vào khuôn viên). Trả về ID
   * đường mới, null nếu không tìm được đường nào đủ gần.
   */
  const connectSocket = (s: CampusSocket): Id | null => {
    const conn = socketConnector(s, fullSite, (id) => parts.owner.get(id) === s.buildingId);
    if (!conn) return null;
    const id = createId('path');
    change((c) => insertPath(c, { ...conn, id }));
    setSelected({ type: 'path', id });
    return id;
  };
  /** Nối mọi đầu nối chưa nối (một bước Hoàn tác); trả về số đoạn đã nối. */
  const connectAll = (): number => {
    let plan = fullSite;
    const added: SitePath[] = [];
    for (const s of unlinkedSockets) {
      const conn = socketConnector(s, plan, (id) => parts.owner.get(id) === s.buildingId);
      if (!conn) continue;
      const path = { ...conn, id: createId('path') };
      added.push(path);
      plan = { ...plan, paths: [...plan.paths, path] };
    }
    if (added.length) change((c) => added.reduce(insertPath, c));
    return added.length;
  };

  /** Cửa gần điểm `p` để đặt sảnh dựng sẵn (cửa chính được ưu tiên). */
  const doorNear = (p: Point): ExteriorDoor | null => {
    const reach = Math.max(px2m(PICK_PX * 4), 3);
    return (
      [...doors]
        .map((d) => ({ d, dist: distance(d.position, p) - (d.entrance ? 1 : 0) }))
        .filter((x) => x.dist <= reach)
        .sort((a, b) => a.dist - b.dist)[0]?.d ?? null
    );
  };
  /** Sảnh mới trước cửa `door` theo lựa chọn hiện tại. */
  const lobbyAt = (door: ExteriorDoor, id?: Id) => {
    const label = lobbyUse === 'none' ? null : SITE_RAMP_USE_STYLE[lobbyUse].label;
    return newLobby({
      door: door.position,
      outward: door.outward,
      ...(lobbyUse === 'none' ? {} : { use: lobbyUse }),
      name: label ? `Sảnh ${label}` : 'Sảnh chính',
      dropoff: lobbyDropoff,
      walkway: lobbyWalkway,
      ...(id ? { id } : {}),
    });
  };
  /** Sảnh đang chọn (khi chọn đúng một sảnh). */
  const selectedLobby =
    selected?.type === 'lobby' ? draft.site?.lobbies?.find((l) => l.id === selected.id) : undefined;

  const finishDraw = () => {
    if (tool === 'path' && draw.length >= 2) {
      const id = createId('path');
      change((c) => addPath(c, pathKind, draw, id)[0]);
      setSelected({ type: 'path', id });
    } else if (tool === 'area' && draw.length >= 3) {
      const id = createId('area');
      change((c) => addArea(c, areaKind, draw, id)[0]);
      setSelected({ type: 'area', id });
    }
    setDraw([]);
  };

  /** Xoá các đối tượng ngoài trời / cầu nối đang chọn (toà không bị xoá). */
  const deleteSelected = () => {
    const list = selection.filter((r) => r.type !== 'building');
    if (!list.length) return;
    change((c) => deleteItems(c, list));
    setSelection(selection.filter((r) => r.type === 'building'));
  };

  /* ---------------- Bàn phím ---------------- */

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftDown(e.type === 'keydown');
        return;
      }
      if (e.code === 'Space') {
        if (!isTyping(e)) {
          e.preventDefault();
          setSpaceDown(e.type === 'keydown');
        }
        return;
      }
      if (e.type !== 'keydown' || e.defaultPrevented || isTyping(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = letterOf(e);
      if (mod && key === 's') {
        e.preventDefault();
        input.onSave();
      } else if (mod && key === 'z') {
        e.preventDefault();
        if (draw.length) setDraw(draw.slice(0, -1));
        else if (e.shiftKey) input.redo();
        else input.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        input.redo();
      } else if (e.key === 'Escape') {
        if (draw.length) setDraw([]);
        else if (linkFirst) {
          setLinkFirst(null);
          setLinkNote(null);
        } else if (calibrating) setCalibrating(null);
        else if (selection.length) setSelection([]);
        else if (tool !== 'select') setTool('select');
        else if (drawMode) setDrawMode(false);
      } else if (e.key === 'Enter') {
        finishDraw();
      } else if (e.key === 'Backspace' && draw.length) {
        e.preventDefault();
        setDraw(draw.slice(0, -1));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
        e.preventDefault();
        deleteSelected();
      } else if (selection.length && !mod && key === 'r') {
        rotateSelection(e.shiftKey ? -15 : 15);
      } else if (ARROW_DIRS[e.key] && (!selection.length || e.altKey)) {
        // Không chọn gì (hoặc giữ Alt): di chuyển bản đồ.
        e.preventDefault();
        panByArrow(stageRef.current, ARROW_DIRS[e.key]!, e.shiftKey);
      } else if (selection.length && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const d = {
          ArrowLeft: { x: -step, y: 0 },
          ArrowRight: { x: step, y: 0 },
          ArrowUp: { x: 0, y: -step },
          ArrowDown: { x: 0, y: step },
        }[e.key];
        if (d) moveSelection(d);
      } else if (e.key === '+' || e.key === '=') {
        stageRef.current?.zoomBy(1.25);
      } else if (e.key === '-' || e.key === '_') {
        stageRef.current?.zoomBy(1 / 1.25);
      } else if (!mod && !e.altKey && !e.shiftKey && key) {
        const t = toolsOf(scope).find((x) => x.key.toLowerCase() === key);
        if (t) setTool(t.tool);
      }
    };
  });
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keyup', handler);
      setSpaceDown(false);
    };
  }, [active]);

  /* ---------------- Chuột ---------------- */

  const px2m = (px: number) => px / (stageRef.current?.getTransform().scale ?? 10);

  /**
   * Bắt dính: đầu nối của toà (chân dốc, đầu lối đi bộ) > đỉnh có sẵn / cửa chính (trong 10 px) >
   * tim đường khác (khi vẽ đường — tạo ngã ba) > lưới. Alt = tự do.
   * @param skipPathId đường đang sửa đỉnh (không bắt dính vào chính nó).
   */
  const snap = (p: Point, alt: boolean, exclude?: Point, skipPathId?: Id): Point => {
    if (alt) return p;
    const r = px2m(SNAP_PX);
    const socket = sockets
      .map((x) => ({ x, d: distance(x.position, p) }))
      .filter((c) => c.d <= r * 1.6 && c.x.position !== exclude)
      .sort((a, b) => a.d - b.d)[0]?.x;
    if (socket) return socket.position;
    const v = snapToSiteVertex(
      fullCampus,
      p,
      r,
      inBuilding ? doors.map((d) => d.position) : entrances.map((e) => e.site),
      exclude,
    );
    if (v) return v;
    const drawingPath = tool === 'path' || skipPathId !== undefined;
    const onPath = drawingPath ? snapToSitePath(fullCampus, p, r * 0.8, skipPathId) : null;
    return onPath ?? snapToGrid(p, grid);
  };

  /**
   * Đối tượng dưới con trỏ: điểm/cổng/cầu nối/đường > sảnh, dốc… của toà (= chọn toà đó) > toà >
   * khu vực. Phạm vi toà: chỉ sảnh, dốc… của toà (không chọn được toà).
   */
  const pick = (p: Point): SiteRef | null => {
    const tol = px2m(PICK_PX);
    const site = hitSite(draft, p, tol, linksAtLevel);
    if (inBuilding) return site;
    if (site && site.type !== 'area') return site;
    const owned = parts.owner.size ? hitSite(ownedOnly, p, tol) : null;
    const owner = owned && parts.owner.get(owned.id);
    if (owner) return { type: 'building', id: owner };
    const building = siteBuildingAt(buildings, p);
    if (building) return { type: 'building', id: building };
    return site;
  };

  const down = (p: Point, evt: PointerEvent) => {
    if (evt.button !== 0 || spaceDown) return;
    if (calibrating) {
      setCalibrating(calibrating.length >= 2 ? [p] : [...calibrating, p]);
      return;
    }
    switch (tool) {
      case 'lobby': {
        const door = doorNear(p);
        if (!door) {
          setLinkNote(
            doors.length
              ? 'Hãy click gần một cửa ra ngoài trời (chấm xanh) ở tầng trệt.'
              : 'Tầng trệt chưa có cửa ra ngoài trời — vẽ cửa ra vào chính (lớp Trong toà, phím E) trước.',
          );
          return;
        }
        const lobby = lobbyAt(door);
        change((c) => addLobby(c, lobby));
        setLinkNote(null);
        setSelected({ type: 'lobby', id: lobby.id });
        setToolState('select');
        setHoverDoor(null);
        return;
      }
      case 'select': {
        // Tay nắm đổi kích thước sảnh đang chọn.
        if (drawMode && selectedLobby) {
          const r = px2m(PICK_PX) * 1.3;
          const handles = lobbyHandles(selectedLobby);
          const handle = (Object.keys(handles) as LobbyHandle[]).find(
            (k) => distance(handles[k], p) <= r,
          );
          if (handle) {
            gesture.current = {
              kind: 'lobby',
              id: selectedLobby.id,
              handle,
              origin: selectedLobby,
              moved: false,
            };
            return;
          }
        }
        // Sửa hình (kéo đỉnh) chỉ trong chế độ Vẽ thêm.
        const vertex = drawMode ? hitVertex(draft, selected, p, px2m(PICK_PX)) : null;
        if (vertex !== null && selected && (selected.type === 'area' || selected.type === 'path')) {
          if (evt.altKey)
            change((c) => removeVertex(c, selected.type as 'area', selected.id, vertex));
          else
            gesture.current = {
              kind: 'vertex',
              type: selected.type,
              id: selected.id,
              index: vertex,
              moved: false,
            };
          return;
        }
        const hit = pick(p);
        if (evt.shiftKey) {
          // Shift+click: thêm / bỏ khỏi vùng chọn; Shift+kéo từ chỗ trống: chọn theo khung.
          if (hit) setSelection(toggleRef(selection, hit));
          else {
            gesture.current = { kind: 'marquee', start: p, end: p, additive: true };
            setMarquee({ a: p, b: p });
          }
          return;
        }
        if (!hit) {
          setSelection([]); // kéo tiếp = di chuyển bản đồ
          return;
        }
        const inSelection = selection.some((r) => sameSiteRef(r, hit));
        const next = inSelection ? selection : [hit];
        if (!inSelection) setSelection(next);
        const list = movable(next);
        if (list.length)
          gesture.current = {
            kind: 'group',
            origin: groupOrigin(draft, list),
            start: p,
            moved: false,
          };
        return;
      }
      case 'path':
      case 'area': {
        const q = snap(p, evt.altKey);
        const first = draw[0];
        const last = draw[draw.length - 1];
        if (last && distance(q, last) < px2m(3)) {
          finishDraw(); // click lại điểm cuối / double-click
          return;
        }
        if (tool === 'area' && first && draw.length >= 3 && distance(q, first) <= px2m(SNAP_PX)) {
          finishDraw(); // click lại đỉnh đầu: khép vùng
          return;
        }
        setDraw([...draw, q]);
        return;
      }
      case 'gate':
      case 'poi': {
        const q = snap(p, evt.altKey);
        const id = createId(tool);
        change((c) =>
          tool === 'gate'
            ? addGate(c, gateKind, q, id)[0]
            : addPoi(c, poiKind, q, SITE_POI_STYLE[poiKind].label, id)[0],
        );
        setSelected({ type: tool, id });
        return;
      }
      case 'link': {
        const nearest = (list: DoorAt[]) =>
          list
            .map((d) => ({ d, dist: distance(d.site, p) }))
            .filter((x) => x.dist <= Math.max(px2m(PICK_PX * 2), 0.6))
            .sort((a, b) => a.dist - b.dist)[0]?.d;
        const door = nearest(linkDoors);
        if (!door) {
          const inner = nearest(doorsAtLevel);
          const building = siteBuildingAt(buildings, p);
          setLinkNote(
            inner
              ? `Cửa này nằm bên trong toà "${buildingName(inner.buildingId)}" — đầu cầu phải là cửa trên tường ngoài.`
              : building && !linkDoors.some((d) => d.buildingId === building)
                ? `Toà "${buildingName(building)}" chưa có cửa trên tường ngoài ở tầng ${level} — mở toà đó (double-click ở công cụ Chọn) và vẽ một cửa trên tường ngoài trước.`
                : 'Hãy click đúng vào một chấm tím (cửa trên tường ngoài).',
          );
          return;
        }
        if (!linkFirst || linkFirst.buildingId === door.buildingId) {
          setLinkFirst(door);
          setLinkNote(
            `Đã chọn cửa của "${buildingName(door.buildingId)}" — giờ click một cửa của toà khác (Esc để huỷ).`,
          );
          return;
        }
        const a = {
          buildingId: linkFirst.buildingId,
          floorId: linkFirst.floorId,
          openingId: linkFirst.openingId,
        };
        const b = { buildingId: door.buildingId, floorId: door.floorId, openingId: door.openingId };
        setLinkFirst(null);
        const existing = findLink(draft, a, b);
        if (existing) {
          setLinkNote(`Hai cửa này đã được nối bằng "${existing.name}".`);
          setSelected({ type: 'link', id: existing.id });
          return;
        }
        const id = createId('link');
        change((c) => addLink(c, a, b, id)[0]);
        setLinkNote(null);
        setSelected({ type: 'link', id });
      }
    }
  };

  const move = (p: Point | null, evt?: PointerEvent) => {
    setCursor(
      p && tool !== 'select' && tool !== 'link' && tool !== 'lobby' ? snap(p, !!evt?.altKey) : p,
    );
    if (tool === 'lobby') {
      const door = p ? doorNear(p) : null;
      if (door?.openingId !== hoverDoor?.openingId) setHoverDoor(door);
    }
    if (!p) return;
    const g = gesture.current;
    if (!g) {
      setHover(tool === 'select' && !calibrating ? pick(p) : null);
      return;
    }
    const alt = !!evt?.altKey;
    if (g.kind === 'marquee') {
      g.end = p;
      setMarquee({ a: g.start, b: p });
      return;
    }
    if (g.kind === 'group') {
      let d = alt ? sub(p, g.start) : snapToGrid(sub(p, g.start), grid);
      // Kéo đúng một toà: chân dốc của toà gần đường xe thì hút vào làn xe (giống Cities: Skylines).
      const only = g.origin.buildings.length === 1 && !g.origin.items.length;
      if (only && !alt && !inBuilding) {
        const b = g.origin.buildings[0]!;
        const mine = sockets.filter((x) => x.buildingId === b.id && x.kind === 'road');
        const pl = placementOf(b.id);
        if (mine.length && pl) {
          const shift = sub(add(b.position, d), pl.position);
          const roads = fullSite.paths.filter((x) => !parts.owner.has(x.id));
          const pull = magnetToRoad(
            mine.map((x) => add(x.position, shift)),
            roads,
            px2m(MAGNET_PX),
          );
          if (pull) d = add(d, pull);
        }
      }
      change((c) => applyGroupMove(c, g.origin, d), g.moved);
    } else if (g.kind === 'lobby') {
      const next = dragLobbyHandle(g.origin, g.handle, p, alt ? 0 : grid);
      change((c) => patchItem(c, 'lobby', g.id, next), g.moved);
    } else {
      const s = draft.site;
      const current =
        g.type === 'area'
          ? s?.areas.find((a) => a.id === g.id)?.polygon[g.index]
          : s?.paths.find((x) => x.id === g.id)?.points[g.index];
      const to = snap(p, alt, current, g.type === 'path' ? g.id : undefined);
      change((c) => setVertex(c, g.type, g.id, g.index, to), g.moved);
    }
    g.moved = true;
  };

  const up = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind !== 'marquee') return;
    setMarquee(null);
    const box: BBox = {
      minX: Math.min(g.start.x, g.end.x),
      minY: Math.min(g.start.y, g.end.y),
      maxX: Math.max(g.start.x, g.end.x),
      maxY: Math.max(g.start.y, g.end.y),
    };
    const min = px2m(MARQUEE_MIN_PX);
    if (box.maxX - box.minX < min && box.maxY - box.minY < min) return;
    const mode = g.end.x >= g.start.x ? 'contain' : 'cross';
    const found = siteItemsInBox(draft, box, mode, footprintOf, linksAtLevel);
    setSelection(
      g.additive
        ? [...selection, ...found.filter((r) => !selection.some((x) => sameSiteRef(x, r)))]
        : found,
    );
  };

  const dblClick = (p: Point) => {
    if (tool !== 'select' || inBuilding) return;
    const id = siteBuildingAt(buildings, p);
    if (id) input.onOpenBuilding(id);
  };

  /** Cụm sảnh xem trước khi rê công cụ Sảnh đón tới gần một cửa. */
  const ghostKey = hoverDoor
    ? `${hoverDoor.openingId}:${lobbyUse}:${lobbyWalkway}:${lobbyDropoff}`
    : '';
  const lobbyGhost = useMemo(
    () => (hoverDoor ? lobbyParts(lobbyAt(hoverDoor, 'ghost')) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theo cửa đang trỏ + lựa chọn
    [ghostKey],
  );

  const panning = spaceDown;
  const cursorStyle = panning
    ? 'grab'
    : calibrating || tool !== 'select'
      ? 'crosshair'
      : hover
        ? 'move'
        : shiftDown
          ? 'crosshair'
          : 'grab';
  // Giữ Shift: kéo từ chỗ trống là chọn theo khung thay vì di chuyển bản đồ.
  const panButtons =
    panning || (tool === 'select' && !hover && !calibrating && !shiftDown) ? [0, 1] : [1];

  /** Đưa khung nhìn tới điểm `p` (toạ độ mặt bằng; khung vẽ nhận toạ độ theo toà đang mở). */
  const centerOnSite = (p: Point) => {
    const pl = placementOf(input.currentBuildingId);
    stageRef.current?.centerOn(pl ? fromSite(pl, p) : p);
  };

  return {
    input,
    draft,
    scope,
    centerOnSite,
    fullSite,
    owner: parts.owner,
    sockets,
    unlinkedSockets,
    connectSocket,
    connectAll,
    doors,
    hoverDoor,
    lobbyGhost,
    lobbyUse,
    setLobbyUse,
    lobbyWalkway,
    setLobbyWalkway,
    lobbyDropoff,
    setLobbyDropoff,
    selectedLobby,
    tool,
    setTool,
    areaKind,
    setAreaKind,
    pathKind,
    setPathKind,
    gateKind,
    setGateKind,
    poiKind,
    setPoiKind,
    draw,
    cursor,
    linkFirst,
    linkNote,
    doorsAtLevel,
    linkDoors,
    allLinks,
    linksAtLevel,
    entrances,
    selected,
    setSelected,
    selection,
    setSelection,
    drawMode,
    setDrawMode,
    marquee,
    moveSelection,
    rotateSelection,
    center,
    footprintOf,
    hover,
    calibrating,
    setCalibrating,
    calDistance,
    setCalDistance,
    validation,
    unlinked,
    buildingName,
    updatePlacement,
    rotateBy,
    deleteSelected,
    down,
    move,
    up,
    dblClick,
    cursorStyle,
    panButtons,
  };
}

export type SiteEditor = ReturnType<typeof useSiteEditor>;

/* ------------------------------------------------------------------ */
/* Lớp vẽ                                                              */
/* ------------------------------------------------------------------ */

/** Ảnh nền mặt bằng tổng thể (toạ độ mặt bằng). */
export function SiteBackground({ campus }: { campus: Campus }) {
  return campus.background ? <BackgroundImage background={campus.background} /> : null;
}

/**
 * Hình đang vẽ (đường / khu vực), đỉnh của đối tượng đang chọn, các cửa có thể làm cầu nối và viền
 * toà đang chọn — vẽ trên cùng (toạ độ mặt bằng).
 */
/**
 * `clipFunc` của Konva: chỉ vẽ phần NẰM NGOÀI đa giác `polygon` (khung rất lớn trừ đi đa giác, quy tắc
 * even-odd).
 */
const outsideOf =
  (polygon: readonly Point[]) =>
  (ctx: {
    rect(x: number, y: number, w: number, h: number): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    closePath(): void;
  }): ['evenodd'] => {
    const R = 1e5;
    ctx.rect(-R, -R, 2 * R, 2 * R);
    polygon.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    return ['evenodd'];
  };

export function SiteEditorOverlay({ ed, theme }: { ed: SiteEditor; theme: MapTheme }) {
  const px = usePx();
  const inBuilding = ed.scope === 'building';
  /**
   * Đầu nối của toà: chưa nối = chấm cam kèm mũi tên chỉ hướng đường cần nối; đã nối = chấm xanh
   * nhỏ (chỉ hiện khi đang vẽ đường, ở lớp Sảnh & dốc hoặc khi chọn toà).
   */
  const showLinked =
    inBuilding || ed.tool === 'path' || ed.selection.some((r) => r.type === 'building');
  const shownSockets = ed.sockets.filter(
    (x) =>
      !x.linked ||
      showLinked ||
      ed.selection.some((r) => r.type === 'building' && r.id === x.buildingId),
  );
  const ghost = ed.lobbyGhost
    ? { areas: ed.lobbyGhost.areas, paths: ed.lobbyGhost.paths, gates: [], pois: [] }
    : null;
  const { tool, draw, cursor, selected, draft, linkFirst } = ed;
  const pts = cursor && draw.length ? [...draw, cursor] : draw;
  const site = draft.site;
  // Ô vuông ở đỉnh (kéo để sửa hình) chỉ hiện trong chế độ Vẽ thêm.
  const vertices = !ed.drawMode
    ? null
    : selected?.type === 'area'
      ? site?.areas.find((a) => a.id === selected.id)?.polygon
      : selected?.type === 'path'
        ? site?.paths.find((x) => x.id === selected.id)?.points
        : null;
  /** Viền các đối tượng ngoài trời trong vùng chọn nhiều (một đối tượng: lớp vẽ tự tô sáng). */
  const multi = ed.selection.length > 1;
  const outline = (id: Id) => {
    const pl = draft.buildings.find((x) => x.buildingId === id);
    const fp = ed.input.buildings.find((b) => b.placement.buildingId === id)?.footprint;
    return pl && fp && fp.length >= 3 ? placedFootprint(pl, fp) : null;
  };
  const selectedOutline = selected?.type === 'building' ? outline(selected.id) : null;
  const groupOutlines = multi
    ? ed.selection.flatMap((r) => {
        if (r.type === 'building') {
          const o = outline(r.id);
          return o ? [{ key: `b:${r.id}`, points: o, closed: true }] : [];
        }
        if (r.type === 'link') {
          const l = ed.allLinks.find((x) => x.id === r.id);
          return l ? [{ key: `l:${r.id}`, points: [l.from, l.to], closed: false }] : [];
        }
        const points = refPoints(draft, r, ed.footprintOf);
        return points.length
          ? [{ key: `${r.type}:${r.id}`, points, closed: r.type === 'area' || r.type === 'lobby' }]
          : [];
      })
    : [];
  const hoverOutline =
    ed.hover?.type === 'building' && ed.hover.id !== selected?.id ? outline(ed.hover.id) : null;

  return (
    <Group listening={false}>
      {ghost && (
        <Group opacity={0.75}>
          <SiteGround site={ghost} theme={theme} labels={false} />
        </Group>
      )}
      {ed.tool === 'lobby' &&
        ed.doors.map((d) => {
          const hot = ed.hoverDoor?.openingId === d.openingId;
          return (
            <Group key={d.openingId}>
              <Line
                points={[
                  d.position.x,
                  d.position.y,
                  d.position.x + d.outward.x * px(22),
                  d.position.y + d.outward.y * px(22),
                ]}
                stroke="#16a34a"
                strokeWidth={2}
                strokeScaleEnabled={false}
                dash={[px(4), px(3)]}
              />
              <Circle
                x={d.position.x}
                y={d.position.y}
                radius={px(hot ? 8 : d.entrance ? 6 : 4.5)}
                fill={hot ? ACCENT : '#16a34a'}
                stroke="#ffffff"
                strokeWidth={1.5}
                strokeScaleEnabled={false}
              />
            </Group>
          );
        })}
      {shownSockets.map((x) => {
        const road = x.kind === 'road';
        const color = x.linked ? '#16a34a' : road ? '#ea580c' : '#d97706';
        const r = px(road ? 7 : 5);
        const tip = {
          x: x.position.x + x.dir.x * px(26),
          y: x.position.y + x.dir.y * px(26),
        };
        const n = { x: -x.dir.y, y: x.dir.x };
        const head = px(6);
        return (
          <Group key={`${x.buildingId}:${x.id}`}>
            {!x.linked && (
              <>
                <Line
                  points={[x.position.x, x.position.y, tip.x, tip.y]}
                  stroke={color}
                  strokeWidth={2.5}
                  strokeScaleEnabled={false}
                  dash={[px(5), px(3)]}
                />
                <Line
                  points={[
                    tip.x - x.dir.x * head + n.x * head * 0.7,
                    tip.y - x.dir.y * head + n.y * head * 0.7,
                    tip.x,
                    tip.y,
                    tip.x - x.dir.x * head - n.x * head * 0.7,
                    tip.y - x.dir.y * head - n.y * head * 0.7,
                  ]}
                  stroke={color}
                  strokeWidth={2.5}
                  strokeScaleEnabled={false}
                  lineCap="round"
                  lineJoin="round"
                />
                <Circle
                  x={x.position.x}
                  y={x.position.y}
                  radius={r * 1.9}
                  stroke={color}
                  strokeWidth={1.5}
                  strokeScaleEnabled={false}
                  opacity={0.6}
                />
              </>
            )}
            <Circle
              x={x.position.x}
              y={x.position.y}
              radius={x.linked ? r * 0.7 : r}
              fill={color}
              stroke="#ffffff"
              strokeWidth={2}
              strokeScaleEnabled={false}
            />
          </Group>
        );
      })}
      {hoverOutline && (
        <Line
          points={flattenPoints(hoverOutline)}
          closed
          stroke={ACCENT}
          opacity={0.55}
          strokeWidth={2}
          strokeScaleEnabled={false}
        />
      )}
      {selectedOutline && (
        <Line
          points={flattenPoints(selectedOutline)}
          closed
          stroke={ACCENT}
          strokeWidth={3}
          fill="rgba(249,115,22,0.06)"
          strokeScaleEnabled={false}
        />
      )}
      {groupOutlines.map((o) =>
        o.points.length === 1 ? (
          <Circle
            key={o.key}
            x={o.points[0]!.x}
            y={o.points[0]!.y}
            radius={px(11)}
            stroke={ACCENT}
            strokeWidth={2.5}
            strokeScaleEnabled={false}
          />
        ) : (
          <Line
            key={o.key}
            points={flattenPoints(o.points)}
            closed={o.closed}
            stroke={ACCENT}
            strokeWidth={3}
            fill={o.closed ? 'rgba(249,115,22,0.06)' : undefined}
            strokeScaleEnabled={false}
          />
        ),
      )}
      {ed.marquee && (
        <Rect
          x={Math.min(ed.marquee.a.x, ed.marquee.b.x)}
          y={Math.min(ed.marquee.a.y, ed.marquee.b.y)}
          width={Math.abs(ed.marquee.b.x - ed.marquee.a.x)}
          height={Math.abs(ed.marquee.b.y - ed.marquee.a.y)}
          stroke={ACCENT}
          strokeWidth={1}
          dash={ed.marquee.b.x >= ed.marquee.a.x ? undefined : [px(6), px(4)]}
          fill="rgba(249,115,22,0.08)"
          strokeScaleEnabled={false}
        />
      )}
      {pts.length >= 2 && (
        <Line
          points={flattenPoints(pts)}
          closed={tool === 'area' && pts.length >= 3}
          fill={tool === 'area' ? 'rgba(249,115,22,0.12)' : undefined}
          stroke={ACCENT}
          strokeWidth={2}
          dash={[px(6), px(4)]}
          strokeScaleEnabled={false}
        />
      )}
      {draw.map((p, i) => (
        <Circle
          key={i}
          x={p.x}
          y={p.y}
          radius={px(4)}
          fill={i === 0 ? '#ffffff' : ACCENT}
          stroke={ACCENT}
          strokeWidth={1.5}
          strokeScaleEnabled={false}
        />
      ))}
      {ed.selectedLobby && (
        <>
          {/*
           * Sảnh đang chọn: tô nhạt các phần (bậc, dốc) ngoài mặt sảnh + viền bệ sảnh. Cắt bỏ phần nằm
           * dưới mặt sảnh (đỉnh dốc, làn đón) để không lộ thân dốc lên trên sảnh; tô cả nhóm một lần
           * (độ mờ của nhóm) để chỗ các phần chồng nhau không đậm hơn.
           */}
          <Group opacity={0.14} clipFunc={outsideOf(lobbyPolygon(ed.selectedLobby))}>
            {lobbyParts(ed.selectedLobby).paths.map((x, _i, all) => (
              <Line
                key={`lp:${x.id}`}
                points={flattenPoints(x.kind === 'ramp' ? rampCenterline(x, all) : x.points)}
                stroke={ACCENT}
                strokeWidth={x.width}
                lineCap="butt"
                lineJoin="round"
              />
            ))}
          </Group>
          <Line
            points={flattenPoints(lobbyPolygon(ed.selectedLobby))}
            closed
            stroke={ACCENT}
            strokeWidth={2.5}
            strokeScaleEnabled={false}
          />
          {ed.drawMode &&
            Object.entries(lobbyHandles(ed.selectedLobby)).map(([k, p]) => (
              <Rect
                key={`lh:${k}`}
                x={p.x - px(6)}
                y={p.y - px(6)}
                width={px(12)}
                height={px(12)}
                fill="#ffffff"
                stroke={ACCENT}
                strokeWidth={2}
                strokeScaleEnabled={false}
              />
            ))}
        </>
      )}
      {vertices?.map((p, i) => (
        <Rect
          key={`v${i}`}
          x={p.x - px(5)}
          y={p.y - px(5)}
          width={px(10)}
          height={px(10)}
          fill="#ffffff"
          stroke={ACCENT}
          strokeWidth={2}
          strokeScaleEnabled={false}
        />
      ))}
      {tool === 'link' &&
        ed.linkDoors.map((d) => {
          const first =
            linkFirst?.buildingId === d.buildingId && linkFirst.openingId === d.openingId;
          return (
            <Circle
              key={`${d.buildingId}:${d.openingId}`}
              x={d.site.x}
              y={d.site.y}
              radius={px(first ? 8 : 5)}
              fill={first ? ACCENT : '#8b5cf6'}
              stroke="#ffffff"
              strokeWidth={1.5}
              strokeScaleEnabled={false}
            />
          );
        })}
      {cursor && tool !== 'select' && tool !== 'link' && (
        <Circle x={cursor.x} y={cursor.y} radius={px(3)} fill={ACCENT} />
      )}
      {ed.calibrating && (
        <CalibrationOverlay
          points={ed.calibrating}
          cursor={ed.calibrating.length === 1 ? cursor : null}
          theme={theme}
        />
      )}
    </Group>
  );
}

/* ------------------------------------------------------------------ */
/* Thanh công cụ                                                       */
/* ------------------------------------------------------------------ */

/** Thanh công cụ dọc của lớp Ngoài trời (cùng chỗ với thanh công cụ trong toà). */
export function SiteToolbar({ ed }: { ed: SiteEditor }) {
  if (ed.scope === 'building') {
    return (
      <div
        className="editor-toolbar"
        role="toolbar"
        aria-label="Công cụ sảnh & dốc"
        aria-orientation="vertical"
      >
        {[['select'], ['lobby'], ['path', 'area']].map((group) => (
          <div key={group.join()} className="editor-toolbar-group">
            {toolsOf('building')
              .filter((t) => group.includes(t.tool))
              .map((t) => (
                <button
                  key={t.tool}
                  type="button"
                  className={ed.tool === t.tool ? 'active' : ''}
                  aria-pressed={ed.tool === t.tool}
                  title={`${t.label} (${t.key})`}
                  aria-label={t.label}
                  onClick={() => ed.setTool(t.tool)}
                >
                  {t.icon}
                </button>
              ))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div
      className="editor-toolbar"
      role="toolbar"
      aria-label="Công cụ ngoài trời"
      aria-orientation="vertical"
    >
      <div className="editor-toolbar-group">
        {SITE_TOOLS.filter((t) => t.tool === 'select').map((t) => (
          <button
            key={t.tool}
            type="button"
            className={ed.tool === t.tool ? 'active' : ''}
            aria-pressed={ed.tool === t.tool}
            title={`${t.label} (${t.key})`}
            aria-label={t.label}
            onClick={() => ed.setTool(t.tool)}
          >
            {t.icon}
          </button>
        ))}
        <button
          type="button"
          className={ed.drawMode ? 'active' : ''}
          aria-pressed={ed.drawMode}
          aria-expanded={ed.drawMode}
          title={
            ed.drawMode
              ? 'Đóng nhóm công cụ vẽ (về chế độ sắp xếp vị trí)'
              : 'Vẽ thêm: đường, khu vực, cổng, điểm, cầu nối; sửa đỉnh (P / A / G / O / L)'
          }
          aria-label="Vẽ thêm"
          onClick={() => ed.setDrawMode(!ed.drawMode)}
        >
          {icon(<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />)}
        </button>
      </div>
      {ed.drawMode && (
        <div className="editor-toolbar-group" role="group" aria-label="Vẽ thêm">
          {toolsOf('campus')
            .filter((t) => t.tool !== 'select')
            .map((t) => (
              <button
                key={t.tool}
                type="button"
                className={ed.tool === t.tool ? 'active' : ''}
                aria-pressed={ed.tool === t.tool}
                title={`${t.label} (${t.key})`}
                aria-label={t.label}
                onClick={() => ed.setTool(t.tool)}
              >
                {t.icon}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/** Dải gợi ý + chọn loại (đường / khu vực / cổng / điểm) phía trên khung vẽ. */
export function SiteToolHint({ ed }: { ed: SiteEditor }) {
  const inBuilding = ed.scope === 'building';
  const def = toolsOf(ed.scope).find((t) => t.tool === ed.tool) ?? SITE_TOOLS[0]!;
  const select = <T extends string>(
    value: T,
    options: readonly { value: T; label: string }[],
    onChange: (v: T) => void,
    label: string,
  ) => (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label}>
      {options.map((k) => (
        <option key={k.value} value={k.value}>
          {k.label}
        </option>
      ))}
    </select>
  );
  const kind =
    ed.tool === 'area' ? (
      select(
        ed.areaKind,
        inBuilding ? EXTERIOR_AREA_OPTIONS : AREA_KINDS,
        ed.setAreaKind,
        'Loại khu vực',
      )
    ) : ed.tool === 'path' ? (
      select(
        ed.pathKind,
        inBuilding ? EXTERIOR_PATH_OPTIONS : PATH_KINDS,
        ed.setPathKind,
        'Loại đường',
      )
    ) : ed.tool === 'lobby' ? (
      <>
        {select(ed.lobbyUse, RAMP_USES, ed.setLobbyUse, 'Sảnh phục vụ khu')}
        <label className="small">
          <input
            type="checkbox"
            checked={ed.lobbyDropoff}
            onChange={(e) => ed.setLobbyDropoff(e.target.checked)}
          />{' '}
          Làn đón ô tô
        </label>
        {ed.lobbyDropoff && (
          <label className="small">
            <input
              type="checkbox"
              checked={ed.lobbyWalkway}
              onChange={(e) => ed.setLobbyWalkway(e.target.checked)}
            />{' '}
            Lối đi bộ trên dốc
          </label>
        )}
      </>
    ) : ed.tool === 'gate' ? (
      select(ed.gateKind, GATE_KINDS, ed.setGateKind, 'Loại cổng')
    ) : ed.tool === 'poi' ? (
      select(ed.poiKind, POI_KINDS, ed.setPoiKind, 'Loại điểm')
    ) : null;
  return (
    <div className="site-hint-bar">
      <strong>
        {inBuilding
          ? `Sảnh & dốc · ${def.label}`
          : ed.tool === 'select' && ed.drawMode
            ? 'Vẽ thêm · Chọn'
            : def.label}
      </strong>
      {kind && <span className="site-kind">{kind}</span>}
      <span className="muted small">
        {def.hint}
        {ed.tool === 'select' &&
          !inBuilding &&
          (ed.drawMode
            ? ' · kéo ô vuông ở đỉnh để sửa hình (Alt+click xoá đỉnh)'
            : ' · bấm ✎ Vẽ thêm để tạo đường, khu vực, cổng, điểm, cầu nối')}
        {!inBuilding &&
          ed.unlinkedSockets.length > 0 &&
          ` · ${ed.unlinkedSockets.length} đầu nối của toà (chấm cam) chưa có đường tới`}
      </span>
      {(ed.tool === 'link' || ed.tool === 'lobby') && ed.linkNote && (
        <span className="small site-note">{ed.linkNote}</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bảng bên phải                                                       */
/* ------------------------------------------------------------------ */

/** Độ cao một toà khác toà đang mở — sửa vào bản nháp của toà đó, lưu cùng nút Lưu. */
function OtherBuildingHeightFields({ id }: { id: Id }) {
  const building = useEditor((s) => s.drafts[id]);
  if (!building) return <p className="muted small">Đang tải dữ liệu toà…</p>;
  const edit = (fn: (b: Building) => void) =>
    useEditor.getState().editMany((d) => {
      const b = d[id];
      if (b) fn(b);
    });
  return <BuildingHeightFields building={building} edit={edit} />;
}

/** Nút xoay nhanh vùng chọn. */
function RotateButtons({ ed }: { ed: SiteEditor }) {
  return (
    <div className="btn-row">
      {[-90, -15, 15, 90].map((deg) => (
        <button
          key={deg}
          type="button"
          className="btn btn-sm"
          title={`Xoay ${Math.abs(deg)}° ${deg < 0 ? 'ngược' : 'theo'} chiều kim đồng hồ`}
          onClick={() => ed.rotateSelection(deg)}
        >
          {deg < 0 ? '↺' : '↻'} {Math.abs(deg)}°
        </button>
      ))}
    </div>
  );
}

/**
 * Vị trí của đối tượng ngoài trời đang chọn: toạ độ (cổng, điểm) hoặc toạ độ tâm (khu vực, đường —
 * đổi thì dời cả hình), và xoay quanh tâm.
 */
function PlacePanel({ ed, target }: { ed: SiteEditor; target: SiteRef }) {
  const point = target.type === 'gate' || target.type === 'poi';
  const c = ed.center([target]);
  if (!c) return null;
  const moveTo = (to: Point) => ed.moveSelection(sub(to, c), [target]);
  return (
    <Panel title="Vị trí">
      <div className="pf-grid">
        <NumberField
          label={point ? 'X' : 'Tâm X'}
          value={c.x}
          onCommit={(x) => moveTo({ x, y: c.y })}
        />
        <NumberField
          label={point ? 'Y' : 'Tâm Y'}
          value={c.y}
          onCommit={(y) => moveTo({ x: c.x, y })}
        />
      </div>
      {!point && (
        <>
          <NumberField
            label="Xoay thêm"
            unit="°"
            step={1}
            value={0}
            onCommit={(deg) => ed.rotateSelection(deg, [target])}
          />
          <RotateButtons ed={ed} />
        </>
      )}
      <p className="muted small">
        Kéo trên bản đồ để di chuyển · mũi tên dời 1 m (Shift = 10 m)
        {point ? '' : ' · R / Shift+R xoay 15°'}.
      </p>
    </Panel>
  );
}

/** Nhiều đối tượng được chọn: dời / xoay cả nhóm. */
function GroupPanel({ ed }: { ed: SiteEditor }) {
  const counts = new Map<SiteRef['type'], number>();
  for (const r of ed.selection) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  const c = ed.center();
  const deletable = ed.selection.some((r) => r.type !== 'building');
  return (
    <Panel title={`Đang chọn ${ed.selection.length} đối tượng`}>
      <p className="muted small">
        {[...counts].map(([type, n]) => `${n} ${SITE_TYPE_LABEL[type].toLowerCase()}`).join(' · ')}
      </p>
      {c && (
        <div className="pf-grid">
          <NumberField
            label="Tâm nhóm X"
            value={c.x}
            onCommit={(x) => ed.moveSelection({ x: x - c.x, y: 0 })}
          />
          <NumberField
            label="Tâm nhóm Y"
            value={c.y}
            onCommit={(y) => ed.moveSelection({ x: 0, y: y - c.y })}
          />
        </div>
      )}
      <NumberField
        label="Xoay nhóm thêm"
        unit="°"
        step={1}
        value={0}
        onCommit={(deg) => ed.rotateSelection(deg)}
      />
      <RotateButtons ed={ed} />
      <div className="btn-row">
        <button type="button" className="btn btn-sm" onClick={() => ed.setSelection([])}>
          Bỏ chọn
        </button>
        {deletable && (
          <button type="button" className="btn btn-sm btn-danger" onClick={ed.deleteSelected}>
            {ed.scope === 'building' ? 'Xoá' : 'Xoá (trừ toà)'}
          </button>
        )}
      </div>
      <p className="muted small">
        Kéo bất kỳ đối tượng nào trong nhóm để dời cả nhóm · mũi tên dời 1 m · R / Shift+R xoay 15°
        quanh tâm nhóm · Shift+click để thêm / bỏ.
      </p>
    </Panel>
  );
}

/** Tên dễ hiểu của một đầu nối (theo đường chứa nó). */
function socketLabel(ed: SiteEditor, x: CampusSocket) {
  const path = ed.fullSite.paths.find((p) => p.id === x.pathId);
  const name = path?.name || (path ? SITE_TYPE_LABEL.path : x.pathId);
  if (x.kind === 'road')
    return path?.kind === 'ramp' ? `Chân dốc · ${name}` : `Đầu đường · ${name}`;
  return path?.kind === 'ramp' ? `Lối đi bộ trên dốc · ${name}` : `Đầu lối đi · ${name}`;
}

/**
 * Danh sách đầu nối của một toà: đã nối / chưa nối với đường khuôn viên. Ở Khuôn viên có nút nối
 * vào đường gần nhất.
 */
function SocketList({ ed, sockets }: { ed: SiteEditor; sockets: readonly CampusSocket[] }) {
  const [note, setNote] = useState<string | null>(null);
  if (!sockets.length) {
    return (
      <p className="muted small">
        Chưa có đầu nối — vẽ dốc (từ chân dốc lên sảnh) hoặc lối đi bộ ra phía đường để có chỗ nối
        với đường khuôn viên.
      </p>
    );
  }
  const campusMode = ed.scope === 'campus';
  return (
    <>
      <ul className="socket-list">
        {sockets.map((x) => (
          <li key={x.id} className={x.linked ? 'ok' : 'warning'}>
            <span
              className="socket-dot"
              style={{
                background: x.linked ? '#16a34a' : x.kind === 'road' ? '#ea580c' : '#d97706',
              }}
              aria-hidden
            />
            <span className="small">
              {socketLabel(ed, x)}
              <br />
              <span className="muted">
                {x.linked
                  ? x.kind === 'road'
                    ? 'Đã nối vào đường xe'
                    : 'Đã nối vào lối đi bộ / vỉa hè'
                  : x.kind === 'road'
                    ? 'Chưa có đường xe tới'
                    : 'Chưa có lối đi bộ tới'}
              </span>
            </span>
            {campusMode && !x.linked && (
              <button
                type="button"
                className="btn btn-sm"
                title="Thêm một đoạn đường từ đầu nối này vào đường / lối đi gần nhất"
                onClick={() => {
                  const id = ed.connectSocket(x);
                  setNote(id ? null : 'Không có đường / lối đi nào đủ gần để nối — hãy vẽ tay.');
                }}
              >
                Nối
              </button>
            )}
          </li>
        ))}
      </ul>
      {note && <p className="small site-note">{note}</p>}
    </>
  );
}

/** Bảng bên phải của lớp Sảnh & dốc (trang Vẽ toà nhà). */
function ExteriorSidePanel({ ed }: { ed: SiteEditor }) {
  const { draft, selected, input } = ed;
  const { change } = input;
  const site = draft.site;
  const area = selected?.type === 'area' ? site?.areas.find((a) => a.id === selected.id) : null;
  const path = selected?.type === 'path' ? site?.paths.find((x) => x.id === selected.id) : null;
  const lobby = ed.selectedLobby;
  const issues = ed.validation.issues.filter((i) => i.code === 'INVALID_SITE_SHAPE');
  const placeTarget =
    selected && (selected.type === 'area' || selected.type === 'path') ? selected : null;
  const linked = ed.sockets.filter((x) => x.linked).length;
  return (
    <>
      {ed.selection.length > 1 && <GroupPanel ed={ed} />}
      {placeTarget && <PlacePanel ed={ed} target={placeTarget} />}
      {ed.selection.length > 1 ? null : lobby ? (
        <LobbyPanel lobby={lobby} change={change} onDelete={ed.deleteSelected} />
      ) : area ? (
        <AreaPanel
          area={area}
          change={change}
          onDelete={ed.deleteSelected}
          kinds={EXTERIOR_AREA_OPTIONS}
        />
      ) : path ? (
        <PathPanel
          path={path}
          change={change}
          onDelete={ed.deleteSelected}
          kinds={EXTERIOR_PATH_OPTIONS}
        />
      ) : (
        <Panel title="Sảnh & dốc của toà">
          <p className="muted small">
            Phần ngoài trời gắn với toà (như lô đất của công trình trong SimCity / Cities:
            Skylines): sảnh (kèm bậc thang, dốc xe lăn, làn đón và dốc ô tô), lối đi bộ. Vẽ theo hệ
            trục của toà ở tầng trệt; ở trang Khuôn viên phần này đi theo toà khi dời / xoay, chỉ
            cần nối đường nội bộ vào các đầu nối.
          </p>
          <p className="muted small">
            {site?.lobbies?.length ?? 0} sảnh · {site?.areas.length ?? 0} khu vực ·{' '}
            {site?.paths.length ?? 0} đường / dốc · {ed.doors.length} cửa ra ngoài trời
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={!ed.doors.length}
              title={
                ed.doors.length
                  ? 'Rê chuột tới cửa chính rồi click để đặt sảnh (bậc / dốc các cạnh, làn đón ô tô)'
                  : 'Tầng trệt chưa có cửa ra ngoài trời'
              }
              onClick={() => ed.setTool('lobby')}
            >
              + Sảnh
            </button>
            <button type="button" className="btn btn-sm" onClick={() => ed.setTool('path')}>
              Vẽ dốc / làn
            </button>
            <button type="button" className="btn btn-sm" onClick={() => ed.setTool('area')}>
              Vẽ khu vực
            </button>
          </div>
        </Panel>
      )}
      <Panel
        title={
          ed.sockets.length
            ? `Đầu nối với khuôn viên (${linked}/${ed.sockets.length} đã nối)`
            : 'Đầu nối với khuôn viên'
        }
      >
        <SocketList ed={ed} sockets={ed.sockets} />
        {ed.sockets.some((x) => !x.linked) && (
          <p className="muted small">
            Mở trang Khuôn viên để vẽ đường tới các chấm cam (đường mới tự bắt dính vào đầu nối),
            hoặc bấm "Nối" ở bảng của toà để tự nối vào đường gần nhất.
          </p>
        )}
      </Panel>
      {issues.length > 0 && (
        <Panel title={`Kiểm tra sảnh & dốc (${issues.length})`}>
          <ul className="issues">
            {issues.map((i, k) => (
              <li key={k} className={i.severity === 'error' ? 'error' : 'warning'}>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    i.refId &&
                    ed.setSelected({
                      type: site?.areas.some((a) => a.id === i.refId) ? 'area' : 'path',
                      id: i.refId,
                    })
                  }
                >
                  {i.message}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

export function SiteSidePanel({
  ed,
  bounds,
  campusInfo,
}: {
  ed: SiteEditor;
  /** Hộp bao khuôn viên — để đặt ảnh nền lần đầu. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** Bảng thông tin cơ sở (tên, địa chỉ…) khi chưa chọn gì. */
  campusInfo?: ReactNode;
}) {
  if (ed.scope === 'building') return <ExteriorSidePanel ed={ed} />;
  return <CampusSidePanel ed={ed} bounds={bounds} campusInfo={campusInfo} />;
}

function CampusSidePanel({
  ed,
  bounds,
  campusInfo,
}: {
  ed: SiteEditor;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  campusInfo?: ReactNode;
}) {
  const { draft, selected, input } = ed;
  const { change } = input;
  const site = draft.site;
  const selectedPl =
    selected?.type === 'building'
      ? draft.buildings.find((pl) => pl.buildingId === selected.id)
      : undefined;
  const issues = ed.validation.issues;
  const background = draft.background;
  const setBackground = (patch: Partial<NonNullable<Campus['background']>>) =>
    change((c) => (c.background ? { ...c, background: { ...c.background, ...patch } } : c));
  const [bgError, setBgError] = useState<string | null>(null);

  const uploadBackground = async (file: File) => {
    try {
      setBgError(null);
      const img = await readImageAsDataUrl(file);
      const width = bounds ? Math.max(bounds.maxX - bounds.minX, 40) * 1.5 : 200;
      change((c) => ({
        ...c,
        background: {
          url: img.url,
          metersPerPixel: width / img.width,
          offset: bounds
            ? { x: bounds.minX - width / 6, y: bounds.minY - width / 6 }
            : { x: 0, y: 0 },
          rotation: 0,
          opacity: 0.6,
        },
      }));
    } catch {
      setBgError('Không đọc được ảnh.');
    }
  };

  const applyCalibration = () => {
    const [a, b] = ed.calibrating ?? [];
    const d = Number(ed.calDistance.replace(',', '.'));
    if (!a || !b || !background || !(d > 0)) return;
    change((c) => ({ ...c, background: calibrateBackground(background, a, b, d) }));
    ed.setCalibrating(null);
    ed.setCalDistance('');
  };

  const placeTarget =
    selected && selected.type !== 'building' && selected.type !== 'link' ? selected : null;

  return (
    <>
      {ed.selection.length > 1 && <GroupPanel ed={ed} />}
      {placeTarget && <PlacePanel ed={ed} target={placeTarget} />}
      {ed.selection.length > 1 ? null : selectedPl ? (
        <Panel title={ed.buildingName(selectedPl.buildingId)}>
          <div className="pf-grid">
            <NumberField
              label="Vị trí X"
              value={selectedPl.position.x}
              onCommit={(x) =>
                ed.updatePlacement(selectedPl.buildingId, (pl) => ({
                  ...pl,
                  position: { ...pl.position, x },
                }))
              }
            />
            <NumberField
              label="Vị trí Y"
              value={selectedPl.position.y}
              onCommit={(y) =>
                ed.updatePlacement(selectedPl.buildingId, (pl) => ({
                  ...pl,
                  position: { ...pl.position, y },
                }))
              }
            />
          </div>
          <NumberField
            label="Góc xoay"
            unit="°"
            step={1}
            value={selectedPl.rotation}
            onCommit={(deg) => ed.rotateBy(selectedPl.buildingId, deg - selectedPl.rotation)}
          />
          <NumberField
            label="Lệch tầng"
            unit=""
            step={1}
            precision={0}
            value={selectedPl.levelOffset ?? 0}
            onCommit={(v) =>
              ed.updatePlacement(selectedPl.buildingId, (pl) => ({
                ...pl,
                levelOffset: Math.round(v) || undefined,
              }))
            }
          />
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => ed.rotateBy(selectedPl.buildingId, -90)}
            >
              ↺ 90°
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => ed.rotateBy(selectedPl.buildingId, 90)}
            >
              ↻ 90°
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => input.onOpenBuilding(selectedPl.buildingId)}
            >
              Vẽ trong toà này
            </button>
          </div>
          <p className="muted small">
            Kéo để di chuyển (bám lưới 1 m, giữ Alt để tự do) · R / Shift+R xoay 15° · "Lệch tầng"
            dùng khi toà đánh số tầng khác các toà còn lại.
          </p>
          <h4 className="pf-subtitle">Sảnh & dốc của toà</h4>
          {(() => {
            const mine = ed.sockets.filter((x) => x.buildingId === selectedPl.buildingId);
            const ext = input.infoById.get(selectedPl.buildingId)?.exterior;
            return (
              <>
                <p className="muted small">
                  {ext
                    ? `${ext.areas.length} khu vực · ${ext.paths.length} đường / dốc — đi theo toà khi dời / xoay.`
                    : 'Toà chưa có sảnh / dốc riêng.'}{' '}
                  Vẽ / sửa ở trang Vẽ toà nhà, lớp "Sảnh & dốc".
                </p>
                <SocketList ed={ed} sockets={mine} />
                {input.onEditExterior && (
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => input.onEditExterior?.(selectedPl.buildingId)}
                    >
                      Sửa sảnh & dốc
                    </button>
                  </div>
                )}
              </>
            );
          })()}
          <h4 className="pf-subtitle">Độ cao toà</h4>
          {selectedPl.buildingId === input.currentBuildingId ? (
            <BuildingHeightFields />
          ) : (
            <OtherBuildingHeightFields id={selectedPl.buildingId} />
          )}
        </Panel>
      ) : selected?.type === 'area' && site?.areas.find((a) => a.id === selected.id) ? (
        <AreaPanel
          area={site.areas.find((a) => a.id === selected.id)!}
          change={change}
          onDelete={ed.deleteSelected}
        />
      ) : selected?.type === 'path' && site?.paths.find((x) => x.id === selected.id) ? (
        <PathPanel
          path={site.paths.find((x) => x.id === selected.id)!}
          change={change}
          onDelete={ed.deleteSelected}
        />
      ) : selected?.type === 'gate' && site?.gates.find((x) => x.id === selected.id) ? (
        <GatePanel
          gate={site.gates.find((x) => x.id === selected.id)!}
          change={change}
          onDelete={ed.deleteSelected}
        />
      ) : selected?.type === 'poi' && site?.pois.find((x) => x.id === selected.id) ? (
        <PoiPanel
          poi={site.pois.find((x) => x.id === selected.id)!}
          change={change}
          onDelete={ed.deleteSelected}
        />
      ) : selected?.type === 'link' && draft.links?.find((l) => l.id === selected.id) ? (
        <LinkPanel
          link={draft.links.find((l) => l.id === selected.id)!}
          autoElevation={ed.allLinks.find((l) => l.id === selected.id)?.autoElevation ?? 0}
          buildingName={ed.buildingName}
          change={change}
          onDelete={ed.deleteSelected}
        />
      ) : (
        <>
          {campusInfo}
          <Panel title="Ngoài trời">
            <p className="muted small">
              Đang xem tầng {input.level}
              {input.level === input.groundLevel
                ? ' (mặt đất — phần ngoài trời hiện đầy đủ)'
                : ' — đổi tầng ở thanh trên để về mặt đất'}
              . Click / kéo để đặt lại vị trí toà, đường, khu vực, cổng, điểm (Shift để chọn nhiều);
              bấm ✎ Vẽ thêm ở thanh bên trái để tạo đường, dốc, khu vực, cổng, điểm hoặc cầu nối.
            </p>
            <p className="muted small">
              {site?.paths.length ?? 0} đường · {site?.areas.length ?? 0} khu vực ·{' '}
              {site?.gates.length ?? 0} cổng · {site?.pois.length ?? 0} điểm ·{' '}
              {draft.links?.length ?? 0} cầu nối
            </p>
          </Panel>
        </>
      )}

      <Panel title="Ảnh nền khuôn viên (vệ tinh / quy hoạch)">
        <label className="btn btn-sm">
          {background ? 'Đổi ảnh…' : 'Tải ảnh lên…'}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadBackground(file);
              e.target.value = '';
            }}
          />
        </label>
        {bgError && <p className="error small">{bgError}</p>}
        {background && (
          <>
            <NumberField
              label="Độ mờ"
              unit=""
              min={0.1}
              max={1}
              step={0.1}
              value={background.opacity}
              onCommit={(opacity) => setBackground({ opacity })}
            />
            <NumberField
              label="Góc xoay ảnh"
              unit="°"
              step={1}
              value={background.rotation}
              onCommit={(rotation) => setBackground({ rotation })}
            />
            <div className="pf-grid">
              <NumberField
                label="Lệch X"
                value={background.offset.x}
                onCommit={(x) => setBackground({ offset: { ...background.offset, x } })}
              />
              <NumberField
                label="Lệch Y"
                value={background.offset.y}
                onCommit={(y) => setBackground({ offset: { ...background.offset, y } })}
              />
            </div>
            {ed.calibrating ? (
              <div className="site-calibrate">
                <p className="small">
                  {ed.calibrating.length < 2
                    ? `Click điểm ${ed.calibrating.length + 1}/2 trên ảnh có khoảng cách đã biết.`
                    : 'Nhập khoảng cách thực giữa 2 điểm:'}
                </p>
                {ed.calibrating.length === 2 && (
                  <input
                    className="cell-input"
                    inputMode="decimal"
                    placeholder="mét"
                    value={ed.calDistance}
                    autoFocus
                    onChange={(e) => ed.setCalDistance(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && applyCalibration()}
                  />
                )}
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={ed.calibrating.length < 2}
                    onClick={applyCalibration}
                  >
                    Áp dụng
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => ed.setCalibrating(null)}
                  >
                    Huỷ
                  </button>
                </div>
              </div>
            ) : (
              <div className="btn-row">
                <button type="button" className="btn btn-sm" onClick={() => ed.setCalibrating([])}>
                  Hiệu chỉnh tỉ lệ
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => change((c) => ({ ...c, background: undefined }))}
                >
                  Bỏ ảnh
                </button>
              </div>
            )}
          </>
        )}
      </Panel>

      <Panel
        title={
          issues.length + ed.unlinked.length + ed.unlinkedSockets.length
            ? `Kiểm tra ngoài trời (${issues.length + ed.unlinked.length + ed.unlinkedSockets.length})`
            : 'Kiểm tra ngoài trời'
        }
        actions={
          ed.unlinkedSockets.length > 1 ? (
            <button
              type="button"
              className="btn btn-sm"
              title="Nối mọi chân dốc / đầu lối đi chưa nối vào đường gần nhất (một bước hoàn tác)"
              onClick={() => ed.connectAll()}
            >
              Nối tất cả
            </button>
          ) : undefined
        }
      >
        {issues.length + ed.unlinked.length + ed.unlinkedSockets.length ? (
          <ul className="issues">
            {ed.unlinkedSockets.map((x) => (
              <li key={`${x.buildingId}:${x.id}`} className="warning">
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    ed.setSelected({ type: 'building', id: x.buildingId });
                    ed.centerOnSite(x.position);
                  }}
                >
                  {socketLabel(ed, x)} ({ed.buildingName(x.buildingId)}) chưa nối với{' '}
                  {x.kind === 'road' ? 'đường xe' : 'lối đi bộ'} nào
                </button>{' '}
                <button type="button" className="btn btn-sm" onClick={() => ed.connectSocket(x)}>
                  Nối
                </button>
              </li>
            ))}
            {issues.map((i, k) => (
              <li key={k} className={i.severity === 'error' ? 'error' : 'warning'}>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    if (i.refId) {
                      const type = draft.links?.some((l) => l.id === i.refId)
                        ? 'link'
                        : site?.areas.some((a) => a.id === i.refId)
                          ? 'area'
                          : site?.gates.some((g) => g.id === i.refId)
                            ? 'gate'
                            : 'path';
                      ed.setSelected({ type, id: i.refId });
                    } else if (i.buildingId) ed.setSelected({ type: 'building', id: i.buildingId });
                  }}
                >
                  {i.message}
                </button>
              </li>
            ))}
            {ed.unlinked.map((u) => (
              <li key={`${u.buildingId}:${u.openingId}`} className="warning">
                <button
                  type="button"
                  className="link-button"
                  onClick={() => ed.setSelected({ type: 'building', id: u.buildingId })}
                >
                  Cửa chính của "{ed.buildingName(u.buildingId)}" chưa có lối đi bộ nào gần — vẽ lối
                  đi tới cửa để chỉ đường liên toà chính xác.
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ok small">Không có vấn đề.</p>
        )}
      </Panel>
    </>
  );
}
