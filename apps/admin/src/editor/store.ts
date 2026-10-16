import { produce } from 'immer';
import { create } from 'zustand';
import type {
  Building,
  BuildingPlacement,
  Department,
  DoorStyle,
  ElevatorKind,
  Floor,
  Id,
  LandmarkKind,
  WallKind,
} from '@hwn/map-core';
import {
  DEFAULT_SETTINGS,
  sameRef,
  type Clipboard,
  type EditorSettings,
  type ItemRef,
  type Tool,
} from './types';
import { WALL_KIND_DEFAULTS } from './ops';

const HISTORY_LIMIT = 100;

/** Vùng chọn trên một toà khác toà đang mở (cùng tầng chung). */
export interface PeerSelection {
  floorId: Id;
  refs: ItemRef[];
}

/** Một bước lịch sử: bản TRƯỚC của các toà bị thay đổi trong bước đó. */
type HistoryStep = Record<Id, Building>;

export interface EditOptions {
  /**
   * Gộp vào bước lịch sử trước (vd. các lần dời liên tiếp khi đang kéo đỉnh sảnh / dốc): không tạo
   * bước mới, Hoàn tác đưa về trạng thái trước lần sửa đầu tiên.
   */
  merge?: boolean;
}

/** Vị trí đặt toà trên mặt bằng tổng thể — để đổi hướng vector khi thao tác trên nhiều toà. */
export type Frame = Pick<BuildingPlacement, 'position' | 'rotation'>;

export interface EditorState {
  /**
   * Bản nháp của mọi toà đang mở trong editor (thường là mọi toà của cơ sở). Sửa toà nào cũng được;
   * nút Lưu lưu tất cả các toà có thay đổi.
   */
  drafts: Record<Id, Building>;
  /** Snapshot lúc tải/lưu gần nhất của từng toà — toà "chưa lưu" = bản nháp khác snapshot này. */
  savedById: Record<Id, Building>;
  /**
   * Version mới nhất trên server của từng toà. Tách khỏi `building.version` vì undo có thể đưa bản
   * nháp về một snapshot cũ — khi lưu luôn gửi giá trị này.
   */
  versions: Record<Id, number>;
  /** Toà đang mở: bảng thuộc tính, thanh tầng, công cụ vẽ làm việc trên toà này. */
  activeId: Id | null;
  /** Bản nháp toà đang mở (= `drafts[activeId]`). */
  building: Building | null;
  /** Snapshot đã lưu của toà đang mở. */
  saved: Building | null;
  /** Version server của toà đang mở. */
  serverVersion: number;
  /** Có toà nào thay đổi chưa lưu. */
  dirty: boolean;
  floorId: Id | null;
  tool: Tool;
  /** Kiểu cánh dùng khi đặt cửa đi mới (chọn ở thanh công cụ). */
  doorStyle: DoorStyle;
  /** Loại tường dùng khi vẽ tường mới (chọn ở thanh công cụ). */
  wallKind: WallKind;
  /** Loại thang máy dùng khi đặt thang máy mới (chọn ở thanh công cụ). */
  elevatorKind: ElevatorKind;
  /** Loại mốc dùng khi đặt mốc mới (chọn ở thanh công cụ). */
  landmarkKind: LandmarkKind;
  /** Vùng chọn trên toà đang mở. */
  selection: ItemRef[];
  /** Vùng chọn thêm trên các toà khác (chọn nhiều toà cùng lúc). */
  peerSelection: Record<Id, PeerSelection>;
  past: HistoryStep[];
  future: HistoryStep[];
  /** Đang trong một thao tác kéo (bản nháp lúc bắt đầu kéo). */
  gestureActive: boolean;
  gestureBase: Record<Id, Building> | null;
  clipboard: Clipboard | null;
  settings: EditorSettings;
  /** Vị trí đặt các toà trên mặt bằng tổng thể (theo bản nháp cơ sở). */
  frames: Record<Id, Frame>;

  /** Nạp lại từ đầu với đúng một toà (bỏ mọi bản nháp và lịch sử). */
  load(building: Building, opts?: { keepFloor?: boolean }): void;
  /**
   * Thêm một toà tải từ server vào editor (không đụng tới lịch sử). Toà đã có thì chỉ thay khi
   * bản nháp chưa sửa gì và server có bản mới hơn.
   */
  adopt(building: Building): void;
  /** Bỏ hẳn một toà khỏi editor (vd. toà vừa bị xoá). */
  forget(id: Id): void;
  /**
   * Chuyển sang sửa toà `id` (giữ nguyên bản nháp + lịch sử của mọi toà).
   * @param floorId tầng cần mở (bỏ trống = giữ tầng nếu cùng toà, nếu không thì tầng thấp nhất).
   * @param keepSelection giữ vùng chọn trên các toà (toà cũ thành "toà khác").
   */
  activate(id: Id, opts?: { floorId?: Id; keepSelection?: boolean }): void;
  setFloor(floorId: Id): void;
  setTool(tool: Tool): void;
  /** Chọn kiểu cánh cho cửa đi mới (đồng thời bật công cụ cửa đi). */
  setDoorStyle(style: DoorStyle): void;
  /**
   * Chọn loại tường cho tường mới: đặt luôn độ dày tường mới theo loại, bật công cụ vẽ tường
   * (giữ nguyên nếu đang ở công cụ tường chữ nhật).
   */
  setWallKind(kind: WallKind): void;
  /** Chọn loại thang máy mới (đồng thời bật công cụ thang máy). */
  setElevatorKind(kind: ElevatorKind): void;
  /** Chọn loại mốc mới (đồng thời bật công cụ mốc). */
  setLandmarkKind(kind: LandmarkKind): void;
  /** Chọn trên toà đang mở. `replace` bỏ luôn vùng chọn ở các toà khác. */
  select(refs: ItemRef[], mode?: 'replace' | 'toggle'): void;
  /** Đặt / bật tắt vùng chọn trên một toà khác. */
  selectPeer(buildingId: Id, floorId: Id, refs: ItemRef[], mode?: 'replace' | 'toggle'): void;
  clearSelection(): void;
  /**
   * Sửa bản nháp toà đang mở. `recipe` nhận draft của cả toà nhà và của tầng hiện tại.
   * Mặc định ghi một bước vào lịch sử; trong lúc kéo (gesture) thì không.
   */
  edit(recipe: (building: Building, floor: Floor) => void, opts?: EditOptions): void;
  /** Sửa nhiều toà trong một bước (nhận draft immer của tất cả bản nháp, theo ID toà). */
  editMany(recipe: (drafts: Record<Id, Building>) => void, opts?: EditOptions): void;
  /** Bắt đầu thao tác kéo: các lần sửa sau gộp thành một bước lịch sử. */
  beginGesture(): void;
  endGesture(): void;
  /** Huỷ thao tác kéo đang dở (Esc): trả bản nháp về trạng thái lúc bắt đầu kéo. */
  cancelGesture(): void;
  undo(): void;
  redo(): void;
  setClipboard(clip: Clipboard | null): void;
  setSettings(patch: Partial<EditorSettings>): void;
  setFrames(frames: Record<Id, Frame>): void;
  /**
   * Gọi sau khi lưu thành công. `snapshot` là bản đã gửi lên server — nếu người dùng sửa tiếp
   * trong lúc chờ, bản nháp hiện tại vẫn giữ trạng thái "chưa lưu".
   */
  markSaved(snapshot: Building, version: number, updatedAt: string): void;
  /** Bỏ thay đổi chưa lưu của mọi toà (về bản đã tải / lưu gần nhất), xoá lịch sử. */
  discardAll(): void;
  /**
   * Thay danh mục khoa (dùng chung toàn viện, sửa trực tiếp trên server) trong bản nháp, bản đã lưu
   * và lịch sử — không tính là thay đổi chưa lưu, không tạo bước undo.
   */
  syncDepartments(departments: Department[]): void;
}

const currentFloor = (b: Building, floorId: Id | null) =>
  b.floors.find((f) => f.id === floorId) ?? b.floors[0];

/** Loại khỏi vùng chọn các đối tượng không còn tồn tại (sau undo, xoá…). */
function pruneSelection(building: Building, floorId: Id | null, selection: ItemRef[]): ItemRef[] {
  if (!selection.length) return selection;
  const floor = currentFloor(building, floorId);
  if (!floor) return [];
  const lists: Record<ItemRef['type'], readonly { id: Id }[]> = {
    wall: floor.walls,
    opening: floor.openings,
    connector: floor.connectors,
    room: floor.rooms,
    landmark: floor.landmarks ?? [],
    navNode: floor.navGraph.nodes,
    navEdge: floor.navGraph.edges,
  };
  const exists = (r: ItemRef) => lists[r.type].some((x) => x.id === r.id);
  const kept = selection.filter(exists);
  return kept.length === selection.length ? selection : kept;
}

function prunePeers(
  drafts: Record<Id, Building>,
  peers: Record<Id, PeerSelection>,
): Record<Id, PeerSelection> {
  let changed = false;
  const next: Record<Id, PeerSelection> = {};
  for (const [id, sel] of Object.entries(peers)) {
    const b = drafts[id];
    const refs =
      b && b.floors.some((f) => f.id === sel.floorId)
        ? pruneSelection(b, sel.floorId, sel.refs)
        : [];
    if (refs !== sel.refs) changed = true;
    if (refs.length) next[id] = refs === sel.refs ? sel : { ...sel, refs };
  }
  return changed ? next : peers;
}

const sortedFirstFloorId = (b: Building) =>
  [...b.floors].sort((a, c) => a.level - c.level)[0]?.id ?? null;

/** Các toà có bản nháp khác bản đã lưu. */
export const dirtyIds = (s: Pick<EditorState, 'drafts' | 'savedById'>): Id[] =>
  Object.keys(s.drafts).filter((id) => s.drafts[id] !== s.savedById[id]);

/** Các trường suy ra từ bản nháp + toà đang mở. */
function derive(
  drafts: Record<Id, Building>,
  savedById: Record<Id, Building>,
  versions: Record<Id, number>,
  activeId: Id | null,
) {
  return {
    building: (activeId && drafts[activeId]) || null,
    saved: (activeId && savedById[activeId]) || null,
    serverVersion: (activeId && versions[activeId]) || 0,
    dirty: Object.keys(drafts).some((id) => drafts[id] !== savedById[id]),
  };
}

/** Áp `step` (bản cũ của vài toà) lên `drafts`; trả về bản mới + bước ngược lại. */
function applyStep(drafts: Record<Id, Building>, step: HistoryStep) {
  const inverse: HistoryStep = {};
  const next = { ...drafts };
  for (const [id, b] of Object.entries(step)) {
    const cur = drafts[id];
    if (!cur) continue; // toà đã bị bỏ khỏi editor
    inverse[id] = cur;
    next[id] = b;
  }
  return { next, inverse };
}

/** Bản cũ (trong `base`) của các toà khác nhau giữa `base` và `next`. */
function diffStep(base: Record<Id, Building>, next: Record<Id, Building>): HistoryStep {
  const step: HistoryStep = {};
  for (const id of Object.keys(next)) {
    if (base[id] && base[id] !== next[id]) step[id] = base[id];
  }
  return step;
}

const isEmpty = (o: object) => Object.keys(o).length === 0;

/** Bản sao của `r` không có khoá `id`. */
function omit<T>(r: Record<Id, T>, id: Id): Record<Id, T> {
  if (!(id in r)) return r;
  const next = { ...r };
  delete next[id];
  return next;
}

/** Bỏ toà `id` khỏi các bước lịch sử (bước rỗng thì bỏ luôn). */
const stripHistory = (steps: HistoryStep[], id: Id) =>
  steps.map((st) => omit(st, id)).filter((st) => !isEmpty(st));

export const useEditor = create<EditorState>((set, get) => {
  /** Ghi bản nháp mới (sau sửa / undo / redo) và cập nhật các trường suy ra + vùng chọn. */
  const commit = (drafts: Record<Id, Building>, extra: Partial<EditorState> = {}) => {
    const s = get();
    const activeId = s.activeId;
    const active = activeId ? drafts[activeId] : undefined;
    const floorId =
      active && !active.floors.some((f) => f.id === s.floorId)
        ? sortedFirstFloorId(active)
        : s.floorId;
    set({
      drafts,
      ...derive(drafts, s.savedById, s.versions, activeId),
      floorId,
      selection: active ? pruneSelection(active, floorId, s.selection) : [],
      peerSelection: prunePeers(drafts, s.peerSelection),
      ...extra,
    });
  };

  return {
    drafts: {},
    savedById: {},
    versions: {},
    activeId: null,
    building: null,
    saved: null,
    serverVersion: 0,
    dirty: false,
    floorId: null,
    tool: 'select',
    doorStyle: 'single',
    wallKind: 'brick',
    elevatorKind: 'passenger',
    landmarkKind: 'info',
    selection: [],
    peerSelection: {},
    past: [],
    future: [],
    gestureActive: false,
    gestureBase: null,
    clipboard: null,
    settings: DEFAULT_SETTINGS,
    frames: {},

    load(building, opts) {
      const { floorId } = get();
      const keep = opts?.keepFloor && building.floors.some((f) => f.id === floorId);
      const drafts = { [building.id]: building };
      const savedById = { [building.id]: building };
      const versions = { [building.id]: building.version };
      set({
        drafts,
        savedById,
        versions,
        activeId: building.id,
        ...derive(drafts, savedById, versions, building.id),
        floorId: keep ? floorId : sortedFirstFloorId(building),
        selection: [],
        peerSelection: {},
        past: [],
        future: [],
        gestureActive: false,
        gestureBase: null,
      });
    },

    adopt(building) {
      const s = get();
      const id = building.id;
      const cur = s.drafts[id];
      if (cur) {
        const clean = cur === s.savedById[id];
        if (!clean || building.version <= (s.versions[id] ?? 0)) return;
      }
      const drafts = { ...s.drafts, [id]: building };
      const savedById = { ...s.savedById, [id]: building };
      const versions = { ...s.versions, [id]: building.version };
      // Toà được thay bằng bản mới từ server: các bước lịch sử cũ của toà đó không còn dùng được.
      set({
        drafts,
        savedById,
        versions,
        ...derive(drafts, savedById, versions, s.activeId),
        ...(cur ? { past: stripHistory(s.past, id), future: stripHistory(s.future, id) } : {}),
      });
    },

    forget(id) {
      const s = get();
      if (!s.drafts[id]) return;
      const drafts = omit(s.drafts, id);
      const savedById = omit(s.savedById, id);
      const versions = omit(s.versions, id);
      const activeId = s.activeId === id ? (Object.keys(drafts)[0] ?? null) : s.activeId;
      const active = activeId ? drafts[activeId] : undefined;
      set({
        drafts,
        savedById,
        versions,
        activeId,
        ...derive(drafts, savedById, versions, activeId),
        floorId: s.activeId === id ? (active ? sortedFirstFloorId(active) : null) : s.floorId,
        selection: s.activeId === id ? [] : s.selection,
        peerSelection: omit(s.peerSelection, id),
        past: stripHistory(s.past, id),
        future: stripHistory(s.future, id),
      });
    },

    activate(id, opts) {
      const s = get();
      const b = s.drafts[id];
      if (!b) return;
      const want = opts?.floorId;
      const floorId =
        want && b.floors.some((f) => f.id === want)
          ? want
          : id === s.activeId && b.floors.some((f) => f.id === s.floorId)
            ? s.floorId
            : sortedFirstFloorId(b);
      if (id === s.activeId) {
        if (floorId !== s.floorId) set({ floorId, selection: [], peerSelection: {} });
        return;
      }
      let peerSelection: Record<Id, PeerSelection> = {};
      let selection: ItemRef[] = [];
      if (opts?.keepSelection) {
        peerSelection = { ...s.peerSelection };
        if (s.activeId && s.floorId && s.selection.length) {
          peerSelection[s.activeId] = { floorId: s.floorId, refs: s.selection };
        }
        const mine = peerSelection[id];
        if (mine && mine.floorId === floorId) selection = mine.refs;
        delete peerSelection[id];
      }
      set({
        activeId: id,
        ...derive(s.drafts, s.savedById, s.versions, id),
        floorId,
        selection,
        peerSelection,
      });
    },

    setFloor(floorId) {
      set({ floorId, selection: [], peerSelection: {} });
    },

    setTool(tool) {
      set({ tool });
    },

    setDoorStyle(doorStyle) {
      set({ doorStyle, tool: 'door' });
    },

    setWallKind(wallKind) {
      const { tool, settings } = get();
      set({
        wallKind,
        tool: tool === 'wallRect' ? tool : 'wall',
        settings: { ...settings, wallThickness: WALL_KIND_DEFAULTS[wallKind].thickness },
      });
    },

    setElevatorKind(elevatorKind) {
      set({ elevatorKind, tool: 'elevator' });
    },

    setLandmarkKind(landmarkKind) {
      set({ landmarkKind, tool: 'landmark' });
    },

    select(refs, mode = 'replace') {
      if (mode === 'replace') return set({ selection: refs, peerSelection: {} });
      const selection = [...get().selection];
      for (const ref of refs) {
        const i = selection.findIndex((r) => sameRef(r, ref));
        if (i >= 0) selection.splice(i, 1);
        else selection.push(ref);
      }
      set({ selection });
    },

    selectPeer(buildingId, floorId, refs, mode = 'replace') {
      const s = get();
      if (buildingId === s.activeId) return s.select(refs, mode);
      const prev = s.peerSelection[buildingId];
      let next = refs;
      if (mode === 'toggle') {
        next = prev?.floorId === floorId ? [...prev.refs] : [];
        for (const ref of refs) {
          const i = next.findIndex((r) => sameRef(r, ref));
          if (i >= 0) next.splice(i, 1);
          else next.push(ref);
        }
      }
      const rest = omit(s.peerSelection, buildingId);
      set({
        peerSelection: next.length ? { ...rest, [buildingId]: { floorId, refs: next } } : rest,
      });
    },

    clearSelection() {
      const s = get();
      if (s.selection.length || !isEmpty(s.peerSelection))
        set({ selection: [], peerSelection: {} });
    },

    edit(recipe, opts) {
      const { activeId, floorId } = get();
      if (!activeId) return;
      get().editMany((d) => {
        const b = d[activeId];
        const floor = b && currentFloor(b, floorId);
        if (b && floor) recipe(b, floor);
      }, opts);
    },

    editMany(recipe, opts) {
      const { drafts, gestureActive, past } = get();
      const next = produce(drafts, recipe);
      if (next === drafts) return;
      const step = diffStep(drafts, next);
      const last = past[past.length - 1];
      // Gộp: bước trước đã giữ bản cũ của các toà đó thì không cần ghi thêm.
      const merged =
        opts?.merge && last && Object.keys(step).every((id) => id in last) ? { future: [] } : null;
      commit(
        next,
        gestureActive || isEmpty(step)
          ? {}
          : (merged ?? { past: [...past, step].slice(-HISTORY_LIMIT), future: [] }),
      );
    },

    beginGesture() {
      const { drafts } = get();
      set({ gestureActive: true, gestureBase: drafts });
    },

    endGesture() {
      const { gestureActive, gestureBase, drafts, past } = get();
      if (!gestureActive) return;
      // Kéo mà không thay đổi gì thì không tạo bước lịch sử.
      const step = gestureBase ? diffStep(gestureBase, drafts) : {};
      set({
        gestureActive: false,
        gestureBase: null,
        ...(isEmpty(step) ? {} : { past: [...past, step].slice(-HISTORY_LIMIT), future: [] }),
      });
    },

    cancelGesture() {
      const { gestureActive, gestureBase, drafts } = get();
      if (!gestureActive || !gestureBase) return;
      const { next } = applyStep(drafts, diffStep(gestureBase, drafts));
      commit(next, { gestureActive: false, gestureBase: null });
    },

    undo() {
      const { past, future, drafts } = get();
      const step = past[past.length - 1];
      if (!step) return;
      const { next, inverse } = applyStep(drafts, step);
      commit(next, { past: past.slice(0, -1), future: [inverse, ...future] });
    },

    redo() {
      const { past, future, drafts } = get();
      const step = future[0];
      if (!step) return;
      const { next, inverse } = applyStep(drafts, step);
      commit(next, { past: [...past, inverse], future: future.slice(1) });
    },

    setClipboard(clipboard) {
      set({ clipboard });
    },

    setSettings(patch) {
      set({ settings: { ...get().settings, ...patch } });
    },

    setFrames(frames) {
      set({ frames });
    },

    markSaved(snapshot, version, updatedAt) {
      const s = get();
      const id = snapshot.id;
      const cur = s.drafts[id];
      if (!cur) return;
      // Không đưa vào lịch sử: version là siêu dữ liệu của server.
      const saved = { ...snapshot, version, updatedAt };
      const savedById = { ...s.savedById, [id]: saved };
      const versions = { ...s.versions, [id]: version };
      const drafts = cur === snapshot ? { ...s.drafts, [id]: saved } : s.drafts;
      set({ drafts, savedById, versions, ...derive(drafts, savedById, versions, s.activeId) });
    },

    discardAll() {
      const s = get();
      const drafts = { ...s.savedById };
      commit(drafts, { past: [], future: [], gestureActive: false, gestureBase: null });
    },

    syncDepartments(departments) {
      const s = get();
      // Giữ nguyên quan hệ "cùng một object" giữa các bản (dirty = bản nháp !== bản đã lưu).
      const cache = new Map<Building, Building>();
      const swap = (b: Building) => {
        let next = cache.get(b);
        if (!next) cache.set(b, (next = { ...b, departments }));
        return next;
      };
      const swapAll = (r: Record<Id, Building>) =>
        Object.fromEntries(Object.entries(r).map(([id, b]) => [id, swap(b)]));
      const drafts = swapAll(s.drafts);
      const savedById = swapAll(s.savedById);
      set({
        drafts,
        savedById,
        ...derive(drafts, savedById, s.versions, s.activeId),
        past: s.past.map(swapAll),
        future: s.future.map(swapAll),
        gestureBase: s.gestureBase && swapAll(s.gestureBase),
      });
    },
  };
});

/** Tầng đang chỉnh sửa. */
export const useCurrentFloor = () =>
  useEditor((s) => (s.building ? currentFloor(s.building, s.floorId) : undefined));

// Chỉ để debug khi phát triển: `__hwnEditor.getState()` trong console trình duyệt.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __hwnEditor: typeof useEditor }).__hwnEditor = useEditor;
}
