import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Layer, Line } from 'react-konva';
import {
  add,
  boundsOf,
  buildingFootprint,
  enclosedAreas,
  fromSite,
  toSite,
  type BBox,
  type BuildingPlacement,
  length,
  normalize,
  pointInPolygon,
  pointsEqual,
  polygonArea,
  scale,
  sub,
  type Building,
  type Floor,
  type Id,
  LANDMARK_KINDS,
  type Point,
  type Route,
} from '@hwn/map-core';
import {
  Connectors,
  floorBounds,
  flattenPoints,
  Labels,
  Landmarks,
  LocalFrame,
  MapStage,
  NavGraph,
  Rooms,
  RouteLayer,
  routeSegmentsOnFloor,
  Walls,
  useMapTheme,
  type MapStageHandle,
} from '@hwn/map-render';
import { inOverlay, isTyping, letterOf, onBackspace } from './keyboard';
import {
  addConnector,
  addLandmark,
  addNavEdge,
  addNavNode,
  addOpening,
  addRectWalls,
  addRoom,
  addWall,
  deleteItems,
  endpointsAt,
  findOpeningPlacement,
  itemsInRect,
  moveOpening,
  newConnectorSize,
  nextConnectorName,
  nextLandmarkName,
  nextRoomName,
  newOpeningWidth,
  rectFromPoints,
  setEndpoints,
  setRoomDestination,
  setRoomVertex,
  type OpeningPlacement,
} from './ops';
import {
  AreaGhost,
  BackgroundImage,
  CalibrationOverlay,
  Grid,
  LandmarkGhost,
  MarqueeRect,
  MeasureOverlay,
  NavEdgePreview,
  OpeningGhost,
  RectGhost,
  RectWallPreview,
  RoomDestinations,
  RoomPreview,
  SelectionOverlay,
  SnapMarker,
  WallPreview,
} from './overlays';
import {
  hitEndpointHandle,
  hitNavNode,
  hitRoomDestination,
  hitRoomVertex,
  hitTest,
  snapDelta,
  snapPoint,
  type SnapResult,
} from './snap';
import { useCurrentFloor, useEditor } from './store';
import { useTransient } from './transient';
import {
  CONNECTOR_TOOLS,
  isConnectorTool,
  isNavTool,
  isOpeningTool,
  OPENING_TOOLS,
  sameRef,
  type EndpointRef,
  type ItemRef,
} from './types';
import { applyMultiDrag, makeMultiDragPlan, selectionParts, type MultiDragPlan } from './workspace';

/** Dung sai tính theo pixel màn hình, quy đổi sang mét theo mức zoom. */
const PICK_PX = 8;
const SNAP_PX = 10;
const OPENING_REACH_PX = 28;
/** Kéo ít hơn chừng này (px) khi chọn vùng thì coi như click. */
const MARQUEE_MIN_PX = 4;

type Gesture =
  | { kind: 'endpoint'; refs: EndpointRef[]; exclude: Set<Id> }
  | { kind: 'roomVertex'; roomId: Id; index: number }
  | { kind: 'roomDestination'; roomId: Id }
  | { kind: 'move'; start: Point; plan: MultiDragPlan }
  | { kind: 'opening'; id: Id }
  | { kind: 'marquee'; start: Point; end: Point; additive: boolean };

type Preview =
  | { kind: 'snap'; snap: SnapResult }
  | { kind: 'opening'; placement: OpeningPlacement | null; width: number }
  | { kind: 'connector'; snap: SnapResult; width: number; depth: number }
  | { kind: 'area'; polygon: Point[] | null; existing: boolean }
  | { kind: 'point'; point: Point };

const FALLBACK_BOUNDS = { minX: 0, minY: 0, maxX: 40, maxY: 30 };
const NO_PLACEMENT: Pick<BuildingPlacement, 'position' | 'rotation'> = {
  position: { x: 0, y: 0 },
  rotation: 0,
};

/** Hộp bao (theo hệ trục cha) của hộp `b` theo hệ trục của toà đặt ở `pl`. */
const placedBounds = (pl: Pick<BuildingPlacement, 'position' | 'rotation'>, b: BBox): BBox =>
  boundsOf(
    [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
    ].map((p) => toSite({ ...pl, buildingId: '' }, p)),
  )!;

/** Một toà khác (cùng tầng chung) sửa được ngay trên khung vẽ. */
export interface CanvasPeer {
  buildingId: Id;
  placement: Pick<BuildingPlacement, 'position' | 'rotation'>;
  /** Tầng của toà này ở tầng chung đang xem. */
  floor: Floor;
  /** Đường bao tầng đó (toạ độ mặt bằng tổng thể). */
  outline: readonly Point[];
}

/**
 * Khuôn viên quanh toà đang sửa: khung vẽ dùng toạ độ mặt bằng tổng thể, mặt bằng toà vẽ theo
 * `placement`, phần ngoài trời + các toà khác vẽ bên dưới. Khi đang ở lớp Ngoài trời (`site`),
 * mọi thao tác chuột chuyển cho lớp đó thay vì các công cụ trong toà.
 *
 * Các toà khác (`peers`) cũng sửa được: click / bắt đầu vẽ trên toà nào thì toà đó thành toà đang
 * mở (`onActivate`); Shift+click / kéo khung chọn được đối tượng trên nhiều toà cùng lúc.
 */
export interface CanvasCampus {
  placement: Pick<BuildingPlacement, 'position' | 'rotation'>;
  /** Các toà khác ở tầng chung đang xem. */
  peers?: readonly CanvasPeer[];
  /** Chuyển sang sửa toà khác (`keepSelection`: giữ vùng chọn trên mọi toà). */
  onActivate?(buildingId: Id, floorId: Id, keepSelection: boolean): void;
  /** Đổi giá trị này thì căn lại khung nhìn (mặc định: khi đổi tầng). */
  fitKey?: string;
  /** Vùng căn khung nhìn (toạ độ mặt bằng) thay cho hộp bao tầng (vd. kèm sảnh, dốc của toà). */
  bounds?: BBox | null;
  /** Vẽ dưới mặt bằng toà (toạ độ mặt bằng tổng thể). */
  underlay: ReactNode;
  /** Vẽ trên cùng (toạ độ mặt bằng tổng thể). */
  overlay?: ReactNode;
  /** Lớp Ngoài trời đang bật: nhận thao tác chuột. */
  site?: {
    down(p: Point, evt: PointerEvent): void;
    move(p: Point | null, evt?: PointerEvent): void;
    up(): void;
    cursor: string;
    panButtons: number[];
  } | null;
  /** Double-click (toạ độ mặt bằng tổng thể). */
  onDblClick?(p: Point): void;
}

/** Khung nhìn của editor: thêm "xem cả khuôn viên"; toạ độ truyền vào theo hệ trục của toà. */
export interface EditorStageHandle extends MapStageHandle {
  fitAll(): void;
}

/** Chiều dài đang gõ → số mét (null nếu chưa hợp lệ). */
const parseLength = (text: string) => {
  const v = Number.parseFloat(text);
  return Number.isFinite(v) && v > 0 ? v : null;
};

interface EditorCanvasProps {
  stageRef: RefObject<EditorStageHandle | null>;
  /** Tuyến chỉ đường thử, vẽ đè lên bản đồ. */
  route?: Route | null;
  campus?: CanvasCampus | null;
  /** Hộp bao cả khuôn viên (toạ độ mặt bằng tổng thể) — cho nút "xem cả khuôn viên". */
  campusBounds?: BBox | null;
}

export function EditorCanvas(props: EditorCanvasProps) {
  const floor = useCurrentFloor();
  const building = useEditor((s) => s.building);
  if (!floor || !building) return null;
  return <CanvasView {...props} floor={floor} building={building} />;
}

function CanvasView({
  stageRef,
  route,
  campus,
  campusBounds,
  floor,
  building,
}: EditorCanvasProps & { floor: Floor; building: Building }) {
  const pl = campus?.placement ?? NO_PLACEMENT;
  const siteMode = campus?.site ?? null;
  const placed = { ...pl, buildingId: building.id };
  const toLocal = (p: Point) => fromSite(placed, p);
  const innerRef = useRef<MapStageHandle>(null);
  const theme = useMapTheme('auto');
  const tool = useEditor((s) => s.tool);
  const doorStyle = useEditor((s) => s.doorStyle);
  const wallKind = useEditor((s) => s.wallKind);
  const elevatorKind = useEditor((s) => s.elevatorKind);
  const landmarkKind = useEditor((s) => s.landmarkKind);
  const selection = useEditor((s) => s.selection);
  const peerSelection = useEditor((s) => s.peerSelection);
  const settings = useEditor((s) => s.settings);
  const {
    edit,
    editMany,
    select,
    selectPeer,
    clearSelection,
    beginGesture,
    endGesture,
    cancelGesture,
  } = useEditor.getState();
  const peers = campus?.peers ?? [];
  const calibration = useTransient((s) => s.calibration);

  /** Chuỗi điểm đang vẽ (tường / đa giác phòng / góc đầu của tường chữ nhật). */
  const [chain, setChain] = useState<Point[]>([]);
  /** Nút đồ thị bắt đầu cạnh đang nối. */
  const [navFrom, setNavFrom] = useState<Id | null>(null);
  /** Chiều dài đoạn kế tiếp đang gõ từ bàn phím. */
  const [lengthInput, setLengthInput] = useState('');
  /** Hai điểm của thước đo. */
  const [measure, setMeasure] = useState<Point[]>([]);
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [hoverItem, setHoverItem] = useState<ItemRef | null>(null);
  /** Đối tượng của toà khác dưới con trỏ. */
  const [peerHover, setPeerHover] = useState<{ buildingId: Id; ref: ItemRef } | null>(null);
  /** Lần nhấn chuột trên toà khác: chuyển sang toà đó rồi xử lý lại (toạ độ mặt bằng tổng thể). */
  const pendingDown = useRef<{ p: Point; evt: PointerEvent } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  /** Phím bổ trợ đang giữ: Shift = đảo khoá góc / hình vuông, Alt = tạm tắt bắt dính. */
  const mods = useRef({ shift: false, alt: false });
  /** Vị trí con trỏ gần nhất (chưa bắt dính) — để vẽ lại khi nhấn/thả phím bổ trợ. */
  const lastCursor = useRef<Point | null>(null);

  // Đổi công cụ / tầng thì huỷ thao tác vẽ dở.
  const resetKey = `${tool}:${building.id}:${floor.id}:${siteMode ? 'site' : 'building'}`;
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setChain([]);
    setNavFrom(null);
    setLengthInput('');
    setMeasure([]);
    setMarquee(null);
    setPreview(null);
    setHoverItem(null);
    setPeerHover(null);
  }

  useEffect(() => {
    useTransient.getState().patch({ chainLength: chain.length, lengthInput });
  }, [chain.length, lengthInput]);

  useEffect(() => {
    if (!measure.length) useTransient.getState().patch({ measure: null });
  }, [measure.length]);

  /** Kết thúc thao tác vẽ dở: phòng đủ ≥ 3 đỉnh thì tạo phòng. */
  const finishDrawing = (commit: boolean) => {
    if (commit && tool === 'room' && chain.length >= 3) {
      let id = '';
      edit((b, f) => {
        id = addRoom(f, chain, { name: nextRoomName(b) }).id;
      });
      select([{ type: 'room', id }]);
    }
    setChain([]);
    setNavFrom(null);
    setLengthInput('');
  };
  const drawing = chain.length > 0 || navFrom !== null;

  // Thả chuột ngoài canvas vẫn kết thúc thao tác kéo.
  const finishGestureRef = useRef<() => void>(() => {});
  useEffect(() => {
    const up = () => finishGestureRef.current();
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  // Phím tắt riêng của canvas, bắt ở pha capture để chạy trước phím tắt chung.
  // Hàm xử lý đọc state mới nhất qua ref nên chỉ cần đăng ký một lần.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const handle = (e: KeyboardEvent) => keyRef.current(e);
    const reset = () => {
      setSpaceDown(false);
      mods.current = { shift: false, alt: false };
    };
    window.addEventListener('keydown', handle, true);
    window.addEventListener('keyup', handle, true);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', handle, true);
      window.removeEventListener('keyup', handle, true);
      window.removeEventListener('blur', reset);
    };
  }, []);

  const localBounds = useMemo(() => floorBounds(floor) ?? FALLBACK_BOUNDS, [floor]);
  const px = pl.position.x;
  const py = pl.position.y;
  const rot = pl.rotation;
  const fitOverride = campus?.bounds;
  const bounds = useMemo(
    () => fitOverride ?? placedBounds({ position: { x: px, y: py }, rotation: rot }, localBounds),
    [fitOverride, localBounds, px, py, rot],
  );
  /** Đường bao tầng đang sửa — tô nền để phần ngoài trời bên dưới không lộ qua hành lang. */
  const footprint = useMemo(
    () => (campus ? buildingFootprint({ floors: [floor] }) : []),
    [campus, floor],
  );

  // Các lệnh khung nhìn nhận toạ độ theo hệ trục của toà (vd. đưa tới đối tượng đang chọn).
  useImperativeHandle(
    stageRef,
    () => ({
      fit: () => innerRef.current?.fit(),
      fitAll: () => {
        if (campusBounds) innerRef.current?.fitBounds(campusBounds, 24);
        else innerRef.current?.fit();
      },
      zoomBy: (f) => innerRef.current?.zoomBy(f),
      panBy: (dx, dy) => innerRef.current?.panBy(dx, dy),
      fitBounds: (b, pad) => innerRef.current?.fitBounds(placedBounds(placed, b), pad),
      centerOn: (p, s) => innerRef.current?.centerOn(toSite(placed, p), s),
      getTransform: () => innerRef.current!.getTransform(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campusBounds, px, py, rot],
  );
  const routeSegments = useMemo(
    () => (route ? routeSegmentsOnFloor(route, floor.id) : []),
    [route, floor],
  );
  // Các vùng kín tạo bởi tường — chỉ tính khi dùng công cụ "click vào vùng kín".
  const walls = floor.walls;
  const areas = useMemo(() => (tool === 'roomAuto' ? enclosedAreas(walls) : []), [tool, walls]);

  const navVisible = settings.showNavGraph || isNavTool(tool);
  const px2m = (n: number) => n / (innerRef.current?.getTransform().scale ?? 20);
  const snapOptions = (from?: Point, exclude?: Set<Id>) => {
    const free = mods.current.alt;
    // Shift đảo trạng thái khoá góc trong lúc giữ.
    const lockAngle = settings.snapAngle !== mods.current.shift;
    return {
      floor,
      radius: px2m(SNAP_PX),
      gridSize: settings.gridSize,
      snapGrid: settings.snapGrid && !free,
      snapObjects: settings.snapObjects && !free,
      from,
      angleStep: lockAngle && !free ? 45 : 0,
      excludeWallIds: exclude,
    };
  };
  const roomAt = (p: Point) => floor.rooms.find((r) => pointInPolygon(p, r.polygon));
  const areaAt = (p: Point) =>
    areas.filter((a) => pointInPolygon(p, a)).sort((a, b) => polygonArea(a) - polygonArea(b))[0] ??
    null;

  /** Góc thứ hai của tường chữ nhật (Shift = hình vuông). */
  const rectCorner = (p: Point): SnapResult => {
    const s = snapPoint(p, snapOptions());
    const a = chain[0];
    if (!a || !mods.current.shift) return s;
    const d = sub(s.point, a);
    const m = Math.max(Math.abs(d.x), Math.abs(d.y));
    return {
      point: { x: a.x + Math.sign(d.x || 1) * m, y: a.y + Math.sign(d.y || 1) * m },
      kind: 'free',
    };
  };

  /** Điểm của thước đo (chỉ khoá góc khi giữ Shift). */
  const measureSnap = (p: Point): SnapResult => {
    const from = measure.length === 1 ? measure[0] : undefined;
    return snapPoint(p, { ...snapOptions(from), angleStep: mods.current.shift ? 45 : 0 });
  };

  const reportMeasure = (a: Point, b: Point) =>
    useTransient.getState().patch({
      measure: { distance: length(sub(b, a)), dx: Math.abs(b.x - a.x), dy: Math.abs(b.y - a.y) },
    });

  const snapPreview = preview?.kind === 'snap' ? preview.snap : null;

  /** Điểm kế tiếp theo chiều dài đang gõ, hướng về phía con trỏ. */
  const typedPoint = (): Point | null => {
    const len = parseLength(lengthInput);
    const last = chain[chain.length - 1];
    if (len === null || !last) return null;
    const v = snapPreview ? sub(snapPreview.point, last) : { x: 1, y: 0 };
    const dir = length(v) > 1e-9 ? normalize(v) : { x: 1, y: 0 };
    return add(last, scale(dir, len));
  };

  /* ---------------- Di chuột ---------------- */

  const showSnap = (s: SnapResult) => {
    useTransient.getState().patch({ snapKind: s.kind });
    setPreview({ kind: 'snap', snap: s });
  };

  const handleMove = (p: Point | null, evt?: PointerEvent) => {
    useTransient.getState().patch({ cursor: p });
    lastCursor.current = p;
    if (evt) mods.current = { shift: evt.shiftKey, alt: evt.altKey };
    if (!p) {
      setPreview(null);
      setHoverItem(null);
      setPeerHover(null);
      return;
    }

    const g = gesture.current;
    if (g) {
      if (g.kind === 'endpoint') {
        const s = snapPoint(p, snapOptions(undefined, g.exclude));
        useTransient.getState().patch({ snapKind: s.kind });
        edit((_, f) => setEndpoints(f, g.refs, s.point));
      } else if (g.kind === 'roomDestination') {
        const s = snapPoint(p, { ...snapOptions(), snapObjects: false });
        // Điểm ra ngoài phòng thì giữ nguyên vị trí cũ.
        edit((_, f) => {
          setRoomDestination(f, g.roomId, s.point);
        });
      } else if (g.kind === 'roomVertex') {
        const s = snapPoint(p, snapOptions());
        useTransient.getState().patch({ snapKind: s.kind });
        edit((_, f) => setRoomVertex(f, g.roomId, g.index, s.point));
      } else if (g.kind === 'move') {
        const snapOn = settings.snapGrid && !mods.current.alt;
        const delta = snapDelta(sub(p, g.start), settings.gridSize, snapOn);
        const { frames, activeId } = useEditor.getState();
        editMany((d) => applyMultiDrag(d, g.plan, delta, frames, activeId));
      } else if (g.kind === 'marquee') {
        g.end = p;
        setMarquee({ a: g.start, b: p });
      } else {
        edit((_, f) => moveOpening(f, g.id, p, px2m(OPENING_REACH_PX)));
      }
      return;
    }

    if (tool === 'wall' || tool === 'room') {
      showSnap(snapPoint(p, snapOptions(chain[chain.length - 1])));
    } else if (tool === 'wallRect') {
      showSnap(chain.length ? rectCorner(p) : snapPoint(p, snapOptions()));
    } else if (tool === 'measure') {
      const s = measureSnap(p);
      showSnap(s);
      if (measure.length === 1) reportMeasure(measure[0]!, s.point);
    } else if (tool === 'navNode' || tool === 'navEdge') {
      const nodeId = hitNavNode(floor, p, px2m(PICK_PX));
      const node = nodeId ? floor.navGraph.nodes.find((n) => n.id === nodeId) : undefined;
      showSnap(
        node
          ? { point: node.position, kind: 'endpoint' }
          : snapPoint(p, { ...snapOptions(), snapObjects: false }),
      );
    } else if (tool === 'roomAuto') {
      setPreview({ kind: 'area', polygon: areaAt(p), existing: !!roomAt(p) });
    } else if (isOpeningTool(tool)) {
      const width = newOpeningWidth(OPENING_TOOLS[tool], doorStyle);
      setPreview({
        kind: 'opening',
        width,
        placement: findOpeningPlacement(floor, p, width, px2m(OPENING_REACH_PX)),
      });
    } else if (isConnectorTool(tool)) {
      const d = newConnectorSize(CONNECTOR_TOOLS[tool], elevatorKind);
      const s = snapPoint(p, { ...snapOptions(), snapObjects: false });
      setPreview({ kind: 'connector', snap: s, width: d.width, depth: d.depth });
    } else if (tool === 'calibrate') {
      setPreview({ kind: 'point', point: p });
    } else if (tool === 'landmark') {
      setPreview({
        kind: 'point',
        point: snapPoint(p, { ...snapOptions(), snapObjects: false }).point,
      });
    } else if (tool === 'select') {
      const hit = hitTest(floor, p, px2m(PICK_PX), { nav: navVisible });
      setHoverItem((prev) => ((prev && hit && sameRef(prev, hit)) || prev === hit ? prev : hit));
      const ph = hit ? null : hitPeer(toSite(placed, p));
      setPeerHover((prev) =>
        prev && ph && prev.buildingId === ph.peer.buildingId && sameRef(prev.ref, ph.ref)
          ? prev
          : ph && { buildingId: ph.peer.buildingId, ref: ph.ref },
      );
    }
  };

  /* ---------------- Các toà khác ---------------- */

  const peerPlaced = (peer: CanvasPeer) => ({ ...peer.placement, buildingId: peer.buildingId });

  /** Đối tượng của toà khác dưới điểm `ps` (toạ độ mặt bằng tổng thể), toà vẽ sau ưu tiên. */
  const hitPeer = (ps: Point): { peer: CanvasPeer; ref: ItemRef } | null => {
    for (let i = peers.length - 1; i >= 0; i--) {
      const peer = peers[i]!;
      const ref = hitTest(peer.floor, fromSite(peerPlaced(peer), ps), px2m(PICK_PX), {
        nav: navVisible,
      });
      if (ref) return { peer, ref };
    }
    return null;
  };

  /**
   * Toà khác nhận công cụ vẽ khi bắt đầu tại `ps`: điểm nằm trong đường bao toà đó (công cụ cửa:
   * gần tường của toà đó) mà không thuộc toà đang mở.
   */
  const peerForTool = (ps: Point): CanvasPeer | null => {
    const local = toLocal(ps);
    if (footprint.length >= 3 && pointInPolygon(local, footprint)) return null;
    const reversed = [...peers].reverse();
    if (isOpeningTool(tool)) {
      const width = newOpeningWidth(OPENING_TOOLS[tool], doorStyle);
      const reach = px2m(OPENING_REACH_PX);
      if (findOpeningPlacement(floor, local, width, reach)) return null;
      const near = reversed.find((peer) =>
        findOpeningPlacement(peer.floor, fromSite(peerPlaced(peer), ps), width, reach),
      );
      if (near) return near;
    }
    return (
      reversed.find((peer) => peer.outline.length >= 3 && pointInPolygon(ps, peer.outline)) ?? null
    );
  };

  /** Chuyển sang sửa toà `peer`, rồi xử lý lại lần nhấn chuột này trên toà đó. */
  const switchTo = (peer: CanvasPeer, keepSelection: boolean, ps: Point, evt: PointerEvent) => {
    if (!campus?.onActivate) return;
    pendingDown.current = { p: ps, evt };
    campus.onActivate(peer.buildingId, peer.floor.id, keepSelection);
  };

  /** Nhấn chuột (toạ độ mặt bằng tổng thể): chọn toà nhận thao tác rồi chuyển cho công cụ. */
  const handleWorldDown = (ps: Point, evt: PointerEvent) => {
    const drawTool =
      tool !== 'select' && tool !== 'pan' && tool !== 'measure' && tool !== 'calibrate';
    if (evt.button === 0 && !spaceDown && drawTool && !drawing && peers.length) {
      const peer = peerForTool(ps);
      if (peer) {
        switchTo(peer, false, ps, evt);
        return;
      }
    }
    handleDown(toLocal(ps), evt);
  };

  /* ---------------- Nhấn chuột ---------------- */

  const handleSelectDown = (p: Point, evt: PointerEvent) => {
    const tol = px2m(PICK_PX);
    const wallIds = new Set(selection.filter((r) => r.type === 'wall').map((r) => r.id));
    const handle = hitEndpointHandle(floor, wallIds, p, tol);
    if (handle) {
      const refs = endpointsAt(floor, handle.point);
      setHoverItem(null);
      beginGesture();
      gesture.current = { kind: 'endpoint', refs, exclude: new Set(refs.map((r) => r.wallId)) };
      return;
    }
    const only = selection.length === 1 ? selection[0] : undefined;
    if (only?.type === 'room' && hitRoomDestination(floor, only.id, p, tol)) {
      setHoverItem(null);
      beginGesture();
      gesture.current = { kind: 'roomDestination', roomId: only.id };
      return;
    }
    const roomIds = new Set(selection.filter((r) => r.type === 'room').map((r) => r.id));
    const vertex = selection.length === 1 ? hitRoomVertex(floor, roomIds, p, tol) : null;
    if (vertex) {
      setHoverItem(null);
      beginGesture();
      gesture.current = { kind: 'roomVertex', roomId: vertex.roomId, index: vertex.index };
      return;
    }
    const hit = hitTest(floor, p, tol, { nav: navVisible });
    const peerHit = hit ? null : hitPeer(toSite(placed, p));
    if (peerHit) {
      setHoverItem(null);
      setPeerHover(null);
      const { peer, ref } = peerHit;
      if (evt.shiftKey) {
        selectPeer(peer.buildingId, peer.floor.id, [ref], 'toggle');
        return;
      }
      // Bấm vào đối tượng đã nằm trong vùng chọn (nhiều toà) thì giữ vùng chọn để kéo cả nhóm.
      const sel = peerSelection[peer.buildingId];
      const keep = !!sel && sel.floorId === peer.floor.id && sel.refs.some((r) => sameRef(r, ref));
      switchTo(peer, keep, toSite(placed, p), evt);
      return;
    }
    if (!hit) {
      // Bấm vào chỗ trống: bắt đầu kéo khung chọn vùng.
      setHoverItem(null);
      gesture.current = { kind: 'marquee', start: p, end: p, additive: evt.shiftKey };
      setMarquee({ a: p, b: p });
      return;
    }
    if (evt.shiftKey) {
      select([hit], 'toggle');
      return;
    }
    setHoverItem(null);
    const alreadySelected = selection.some((r) => sameRef(r, hit));
    if (!alreadySelected) select([hit]);
    if (hit.type === 'navEdge') return; // cạnh đồ thị không kéo được
    // Kéo cả vùng chọn, kể cả phần nằm trên các toà khác.
    const st = useEditor.getState();
    const parts = selectionParts(st);
    beginGesture();
    gesture.current =
      hit.type === 'opening' && parts.length === 1 && st.selection.length === 1
        ? { kind: 'opening', id: hit.id }
        : { kind: 'move', start: p, plan: makeMultiDragPlan(st.drafts, parts) };
  };

  /** Kết thúc thao tác kéo (thả chuột trong hoặc ngoài canvas). */
  const finishGesture = () => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (g.kind !== 'marquee') {
      endGesture();
      return;
    }
    setMarquee(null);
    const r = rectFromPoints(g.start, g.end);
    const min = px2m(MARQUEE_MIN_PX);
    if (r.maxX - r.minX < min && r.maxY - r.minY < min) {
      if (!g.additive) clearSelection();
      return;
    }
    const mode = g.end.x >= g.start.x ? 'contain' : 'cross';
    const refs = itemsInRect(floor, r, mode, { nav: navVisible });
    if (!g.additive) select(refs);
    else
      select(
        refs.filter((ref) => !selection.some((x) => sameRef(x, ref))),
        'toggle',
      );
    // Khung chọn quét cả các toà khác (đổi khung sang hệ trục từng toà).
    const corners = [
      { x: r.minX, y: r.minY },
      { x: r.maxX, y: r.minY },
      { x: r.maxX, y: r.maxY },
      { x: r.minX, y: r.maxY },
    ].map((c) => toSite(placed, c));
    for (const peer of peers) {
      const box = boundsOf(corners.map((c) => fromSite(peerPlaced(peer), c)));
      if (!box) continue;
      const found = itemsInRect(peer.floor, box, mode, { nav: navVisible });
      if (!g.additive) {
        if (found.length) selectPeer(peer.buildingId, peer.floor.id, found, 'replace');
        continue;
      }
      const prev = peerSelection[peer.buildingId];
      const fresh = found.filter(
        (ref) => !(prev?.floorId === peer.floor.id && prev.refs.some((x) => sameRef(x, ref))),
      );
      if (fresh.length) selectPeer(peer.buildingId, peer.floor.id, fresh, 'toggle');
    }
  };

  /** Thêm một đỉnh vào chuỗi đang vẽ (tường: kèm tạo đoạn tường mới). */
  const pushChainPoint = (s: SnapResult) => {
    setLengthInput('');
    const last = chain[chain.length - 1];
    if (!last) {
      setChain([s.point]);
      return;
    }
    // Click lại đúng điểm cuối (vd. double-click) = kết thúc. Không dựa vào sự kiện dblclick
    // của Konva vì 2 click nhanh ở 2 chỗ khác nhau cũng bị tính là double-click.
    if (pointsEqual(s.point, last, px2m(2))) {
      finishDrawing(true);
      return;
    }
    const first = chain[0]!;
    const closes = chain.length >= 2 && pointsEqual(s.point, first, px2m(SNAP_PX));
    if (tool === 'wall') {
      const end = closes ? first : s.point;
      edit((_, f) => {
        addWall(f, last, end, { thickness: settings.wallThickness, kind: wallKind });
      });
    }
    if (closes) finishDrawing(true);
    else setChain([...chain, s.point]);
  };

  /**
   * Bỏ điểm cuối của chuỗi đang vẽ. Với tường, đoạn tường vừa tạo cũng bị gỡ — bằng Hoàn tác nếu
   * đó đúng là bước cuối trong lịch sử, nếu không thì xoá trực tiếp.
   */
  const popChainPoint = () => {
    const a = chain[chain.length - 2];
    const b = chain[chain.length - 1];
    if (tool === 'wall' && a && b) {
      const wall = [...floor.walls]
        .reverse()
        .find((w) => pointsEqual(w.start, a, 1e-6) && pointsEqual(w.end, b, 1e-6));
      if (wall) {
        const st = useEditor.getState();
        const lastStep = st.past[st.past.length - 1];
        const prevFloor = lastStep?.[building.id]?.floors.find((f) => f.id === floor.id);
        const lastStepAddedIt =
          Object.keys(lastStep ?? {}).length === 1 &&
          prevFloor &&
          prevFloor.walls.length === floor.walls.length - 1 &&
          !prevFloor.walls.some((w) => w.id === wall.id);
        if (lastStepAddedIt) st.undo();
        else edit((_, f) => deleteItems(f, [{ type: 'wall', id: wall.id }]));
      }
    }
    setChain(chain.slice(0, -1));
  };

  const handleDown = (p: Point, evt: PointerEvent) => {
    if (evt.button !== 0 || spaceDown || tool === 'pan') return;
    mods.current = { shift: evt.shiftKey, alt: evt.altKey };

    switch (tool) {
      case 'select':
        handleSelectDown(p, evt);
        return;

      case 'wall':
      case 'room': {
        // Đang gõ chiều dài thì click chỉ dùng để chọn hướng.
        const typed = typedPoint();
        pushChainPoint(
          typed
            ? { point: typed, kind: 'free' }
            : snapPoint(p, snapOptions(chain[chain.length - 1])),
        );
        return;
      }

      case 'wallRect': {
        const a = chain[0];
        if (!a) {
          setChain([snapPoint(p, snapOptions()).point]);
          return;
        }
        const b = rectCorner(p).point;
        const withRoom = settings.rectWithRoom;
        let created: ItemRef[] = [];
        edit((bd, f) => {
          const ws = addRectWalls(f, a, b, { thickness: settings.wallThickness, kind: wallKind });
          if (!ws.length) return;
          created = ws.map((w) => ({ type: 'wall' as const, id: w.id }));
          if (withRoom) {
            const room = addRoom(
              f,
              ws.map((w) => w.start),
              { name: nextRoomName(bd) },
            );
            created = [{ type: 'room', id: room.id }];
          }
        });
        if (!created.length) return; // hình quá dẹt — giữ góc đầu, chờ click lại
        select(created);
        setChain([]);
        return;
      }

      case 'measure': {
        const s = measureSnap(p);
        const pts = measure.length >= 2 ? [s.point] : [...measure, s.point];
        setMeasure(pts);
        if (pts.length === 2) reportMeasure(pts[0]!, pts[1]!);
        else useTransient.getState().patch({ measure: null });
        return;
      }

      case 'roomAuto': {
        const existing = roomAt(p);
        if (existing) {
          select([{ type: 'room', id: existing.id }]);
          return;
        }
        const area = areaAt(p);
        if (!area) return;
        let id = '';
        edit((b, f) => {
          id = addRoom(f, area, { name: nextRoomName(b) }).id;
        });
        select([{ type: 'room', id }]);
        return;
      }

      case 'navNode': {
        const hitId = hitNavNode(floor, p, px2m(PICK_PX));
        if (hitId) {
          select([{ type: 'navNode', id: hitId }]);
          return;
        }
        const s = snapPoint(p, { ...snapOptions(), snapObjects: false });
        let id = '';
        edit((_, f) => {
          id = addNavNode(f, s.point).id;
        });
        select([{ type: 'navNode', id }]);
        return;
      }

      case 'navEdge': {
        const hitId = hitNavNode(floor, p, px2m(PICK_PX));
        if (hitId && hitId === navFrom) {
          setNavFrom(null);
          return;
        }
        const s = snapPoint(p, { ...snapOptions(), snapObjects: false });
        let target = hitId ?? '';
        edit((_, f) => {
          if (!target) target = addNavNode(f, s.point).id;
          if (navFrom) addNavEdge(f, navFrom, target);
        });
        setNavFrom(target);
        return;
      }

      case 'landmark': {
        const s = snapPoint(p, { ...snapOptions(), snapObjects: false });
        let id = '';
        edit((b, f) => {
          id = addLandmark(f, s.point, {
            kind: landmarkKind,
            name: nextLandmarkName(b, landmarkKind, LANDMARK_KINDS[landmarkKind]),
          }).id;
        });
        select([{ type: 'landmark', id }]);
        return;
      }

      case 'calibrate': {
        const pts = useTransient.getState().calibration;
        useTransient.getState().patch({ calibration: pts.length >= 2 ? [p] : [...pts, p] });
        return;
      }
    }

    if (isOpeningTool(tool)) {
      const type = OPENING_TOOLS[tool];
      const width = newOpeningWidth(type, doorStyle);
      const placement = findOpeningPlacement(floor, p, width, px2m(OPENING_REACH_PX));
      if (!placement || placement.overlaps) return;
      let id = '';
      edit((_, f) => {
        id = addOpening(f, type, placement, width, type === 'door' ? doorStyle : undefined).id;
      });
      select([{ type: 'opening', id }]);
      return;
    }

    if (isConnectorTool(tool)) {
      const type = CONNECTOR_TOOLS[tool];
      const s = snapPoint(p, { ...snapOptions(), snapObjects: false });
      let id = '';
      edit((b, f) => {
        id = addConnector(f, type, s.point, {
          name: nextConnectorName(b, type, elevatorKind),
          elevatorKind,
        }).id;
      });
      select([{ type: 'connector', id }]);
    }
  };

  /* ---------------- Bàn phím ---------------- */

  const handleKey = (e: KeyboardEvent) => {
    const down = e.type === 'keydown';
    // Phím bổ trợ: cập nhật ngay bản xem trước mà không cần di chuột.
    if (e.key === 'Shift' || e.key === 'Alt') {
      const which = e.key === 'Shift' ? 'shift' : 'alt';
      // Không để Alt kích hoạt thanh menu của trình duyệt.
      if (e.key === 'Alt' && !isTyping(e)) e.preventDefault();
      if (mods.current[which] !== down) {
        mods.current = { ...mods.current, [which]: down };
        if (lastCursor.current && !gesture.current) handleMove(lastCursor.current);
      }
      return;
    }
    if (e.isComposing || inOverlay(e) || isTyping(e)) return;
    // Lớp Ngoài trời tự xử lý phím của nó.
    if (siteModeRef.current) return;

    if (e.code === 'Space') {
      // Chặn cả keyup để nút đang focus không bị "bấm" bởi phím Space.
      e.preventDefault();
      setSpaceDown(down);
      return;
    }
    if (!down) return;

    const consume = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const mod = e.ctrlKey || e.metaKey;
    const g = gesture.current;

    if (e.key === 'Escape') {
      if (g) {
        consume();
        gesture.current = null;
        if (g.kind === 'marquee') setMarquee(null);
        else cancelGesture();
      } else if (lengthInput) {
        consume();
        setLengthInput('');
      } else if (drawing) {
        consume();
        finishDrawing(false);
      } else if (measure.length) {
        consume();
        setMeasure([]);
      }
      return;
    }

    if (!drawing || g) return;
    const chainTool = tool === 'wall' || tool === 'room';

    // Gõ chiều dài đoạn kế tiếp (dấu phẩy được hiểu là dấu thập phân).
    if (chainTool && !mod && !e.altKey && /^[0-9.,]$/.test(e.key)) {
      consume();
      const ch = e.key === ',' ? '.' : e.key;
      setLengthInput((v) => (ch === '.' && v.includes('.') ? v : (v + ch).slice(0, 8)));
      return;
    }

    if (e.key === 'Enter') {
      consume();
      const typed = chainTool ? typedPoint() : null;
      if (typed) pushChainPoint({ point: typed, kind: 'free' });
      else finishDrawing(true);
      return;
    }

    const undoKey = mod && !e.shiftKey && letterOf(e) === 'z';
    if (tool === 'navEdge') {
      // Hoàn tác khi đang nối đồ thị: dừng nối rồi để phím tắt chung hoàn tác.
      if (undoKey) setNavFrom(null);
      return;
    }
    if (e.key === 'Backspace' || undoKey) {
      consume();
      if (e.key === 'Backspace' && lengthInput) setLengthInput((v) => v.slice(0, -1));
      else if (undoKey) popRef.current();
      else onBackspace(() => popRef.current());
    }
  };

  // Vừa chuyển sang toà khác vì một lần nhấn chuột: xử lý lần nhấn đó trên toà mới.
  useLayoutEffect(() => {
    const pending = pendingDown.current;
    if (!pending) return;
    pendingDown.current = null;
    handleDown(toLocal(pending.p), pending.evt);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ khi đổi toà / tầng
  }, [building.id, floor.id]);

  // Các hàm xử lý gọi từ listener toàn cục / hẹn giờ luôn dùng state mới nhất.
  const popRef = useRef(popChainPoint);
  const siteModeRef = useRef(!!siteMode);
  useEffect(() => {
    keyRef.current = handleKey;
    siteModeRef.current = !!siteMode;
    finishGestureRef.current = finishGesture;
    popRef.current = popChainPoint;
  });

  const panning = spaceDown || tool === 'pan';
  const cursorStyle = panning
    ? 'grab'
    : tool === 'select'
      ? hoverItem || peerHover
        ? 'move'
        : 'default'
      : tool === 'roomAuto'
        ? 'cell'
        : 'crosshair';

  const connectorSelected = selection.find((r) => r.type === 'connector')?.id;
  const navFromNode = navFrom ? floor.navGraph.nodes.find((n) => n.id === navFrom) : undefined;
  const drawCursor = typedPoint() ?? snapPreview?.point ?? null;

  return (
    <MapStage
      ref={innerRef}
      bounds={bounds}
      fitKey={campus?.fitKey ?? floor.id}
      background={theme.background}
      panButtons={siteMode ? siteMode.panButtons : panning ? [0, 1] : [1]}
      cursor={siteMode ? siteMode.cursor : cursorStyle}
      onWorldPointerDown={(p, evt) => (siteMode ? siteMode.down(p, evt) : handleWorldDown(p, evt))}
      onWorldPointerMove={(p, evt) =>
        siteMode ? siteMode.move(p, evt) : handleMove(p && toLocal(p), evt)
      }
      onWorldPointerUp={() => (siteMode ? siteMode.up() : finishGesture())}
      onWorldDblClick={campus?.onDblClick}
    >
      <Layer listening={false}>
        {campus?.underlay}
        <LocalFrame frame={pl}>
          {footprint.length >= 3 && (
            <Line points={flattenPoints(footprint)} closed fill={theme.floor} opacity={0.92} />
          )}
          {settings.showBackground && floor.background && (
            <BackgroundImage background={floor.background} />
          )}
          {!siteMode && (
            <Grid
              unit={settings.gridUnit}
              minor={settings.snapGrid ? settings.gridSize : 0}
              theme={theme}
            />
          )}
          <Rooms rooms={floor.rooms} departments={building.departments} theme={theme} />
          <Connectors connectors={floor.connectors} theme={theme} selectedId={connectorSelected} />
          <Walls floor={floor} theme={theme} />
          {navVisible && <NavGraph floor={floor} theme={theme} />}
          <Labels floor={floor} theme={theme} />
          {floor.landmarks && floor.landmarks.length > 0 && (
            <Landmarks landmarks={floor.landmarks} theme={theme} />
          )}
        </LocalFrame>
      </Layer>
      <Layer listening={false}>
        {!siteMode &&
          peers.map((peer) => {
            const sel = peerSelection[peer.buildingId];
            const refs = sel?.floorId === peer.floor.id ? sel.refs : [];
            const hover =
              tool === 'select' && peerHover?.buildingId === peer.buildingId ? peerHover.ref : null;
            return (
              <LocalFrame key={peer.buildingId} frame={peer.placement}>
                {navVisible && <NavGraph floor={peer.floor} theme={theme} />}
                {(refs.length > 0 || hover) && (
                  <SelectionOverlay floor={peer.floor} selection={refs} hover={hover} />
                )}
              </LocalFrame>
            );
          })}
        <LocalFrame frame={pl}>
          {routeSegments.length > 0 && (
            <RouteLayer
              segments={routeSegments}
              theme={theme}
              floorName={(id) => building.floors.find((x) => x.id === id)?.name ?? id}
            />
          )}
          <RoomDestinations
            floor={floor}
            selectedRoomId={
              selection.length === 1 && selection[0]!.type === 'room' ? selection[0]!.id : null
            }
          />
          {tool === 'landmark' && preview?.kind === 'point' && (
            <LandmarkGhost point={preview.point} kind={landmarkKind} />
          )}
          <SelectionOverlay
            floor={floor}
            selection={selection}
            hover={tool === 'select' ? hoverItem : null}
          />
          {tool === 'wall' && (
            <WallPreview
              chain={chain}
              cursor={drawCursor}
              thickness={settings.wallThickness}
              theme={theme}
              typed={lengthInput}
            />
          )}
          {tool === 'room' && (
            <RoomPreview chain={chain} cursor={drawCursor} theme={theme} typed={lengthInput} />
          )}
          {tool === 'wallRect' && chain[0] && snapPreview && (
            <RectWallPreview
              a={chain[0]}
              b={snapPreview.point}
              thickness={settings.wallThickness}
              theme={theme}
            />
          )}
          {tool === 'measure' && (
            <MeasureOverlay
              points={measure}
              cursor={measure.length === 1 ? (snapPreview?.point ?? null) : null}
              theme={theme}
            />
          )}
          {marquee && <MarqueeRect a={marquee.a} b={marquee.b} />}
          {tool === 'navEdge' && navFromNode && snapPreview && (
            <NavEdgePreview from={navFromNode.position} to={snapPreview.point} />
          )}
          {snapPreview && snapPreview.kind !== 'free' && (
            <SnapMarker point={snapPreview.point} kind={snapPreview.kind} />
          )}
          {preview?.kind === 'area' && preview.polygon && (
            <AreaGhost polygon={preview.polygon} existing={preview.existing} />
          )}
          {preview?.kind === 'opening' && preview.placement && (
            <OpeningGhost
              floor={floor}
              placement={preview.placement}
              width={preview.width}
              type={isOpeningTool(tool) ? OPENING_TOOLS[tool] : 'door'}
              doorStyle={doorStyle}
            />
          )}
          {preview?.kind === 'connector' && (
            <RectGhost center={preview.snap.point} width={preview.width} depth={preview.depth} />
          )}
          {tool === 'calibrate' && (
            <CalibrationOverlay
              points={calibration}
              cursor={preview?.kind === 'point' && calibration.length === 1 ? preview.point : null}
              theme={theme}
            />
          )}
        </LocalFrame>
        {campus?.overlay}
      </Layer>
    </MapStage>
  );
}
