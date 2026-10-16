import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  add,
  createId,
  distance,
  LANDMARK_KINDS,
  normalize,
  scale,
  sub,
  wallLength,
  type Connector,
  type ConnectorDirection,
  type ConnectorType,
  type Floor,
  type Landmark,
  type LandmarkKind,
  type Opening,
  type OpeningType,
  type Wall,
  type WallKind,
} from '@hwn/map-core';
import {
  DOOR_STYLES,
  doorStyleOf,
  ELEVATOR_KINDS,
  elevatorKindOf,
  nextDoorOrientation,
  WALL_KINDS,
  wallKindOf,
} from '@hwn/map-render';
import { errorMessage } from '../lib/api';
import { removeBuilding } from '../lib/buildingActions';
import { useBuildings } from '../lib/queries';
import { BuildingHeightFields } from './BuildingHeightFields';
import { CheckField, NumberField, Panel, SelectField, TextField } from './fields';
import { readImageAsDataUrl } from './image';
import { GRID_UNITS } from './types';
import { NavEdgePanel, NavGraphPanel, NavNodePanel, RoomPanel } from './RoomNavPanels';
import {
  calibrateBackground,
  clampOpenings,
  cloneConnectorToFloors,
  connectorRect,
  endpointsAt,
  OPENING_DEFAULTS,
  removeFloor,
  setConnectorSize,
  setEndpoints,
  WALL_KIND_DEFAULTS,
} from './ops';
import { useCurrentFloor, useEditor } from './store';
import { useTransient } from './transient';
import { editorCommands } from './useShortcuts';

const OPENING_TYPES: { value: OpeningType; label: string }[] = [
  { value: 'door', label: 'Cửa đi' },
  { value: 'window', label: 'Cửa sổ' },
  { value: 'entrance', label: 'Cửa ra vào chính' },
];

const CONNECTOR_TYPES: { value: ConnectorType; label: string }[] = [
  { value: 'elevator', label: 'Thang máy' },
  { value: 'stairs', label: 'Thang bộ' },
  { value: 'escalator', label: 'Thang cuốn' },
];

const DIRECTIONS: { value: ConnectorDirection; label: string }[] = [
  { value: 'both', label: 'Hai chiều' },
  { value: 'up', label: 'Chỉ đi lên' },
  { value: 'down', label: 'Chỉ đi xuống' },
];

/** Xoay / lật vùng chọn quanh tâm của nó. */
export const TransformButtons = () => (
  <div className="btn-row">
    <button
      type="button"
      className="btn btn-sm"
      title="Xoay 90° (Shift+R)"
      onClick={() => editorCommands.transform('rotate')}
    >
      ↻ Xoay 90°
    </button>
    <button
      type="button"
      className="btn btn-sm"
      title="Lật ngang (Shift+H)"
      onClick={() => editorCommands.transform('flipX')}
    >
      ⇋ Lật ngang
    </button>
    <button
      type="button"
      className="btn btn-sm"
      title="Lật dọc (Shift+V)"
      onClick={() => editorCommands.transform('flipY')}
    >
      ⇵ Lật dọc
    </button>
  </div>
);

const DeleteButton = ({ label = 'Xoá' }: { label?: string }) => (
  <button type="button" className="btn btn-danger btn-sm" onClick={editorCommands.delete}>
    {label}
  </button>
);

/* ------------------------------------------------------------------ */

function WallPanel({ wall }: { wall: Wall }) {
  const edit = useEditor((s) => s.edit);
  const len = wallLength(wall);
  const currentFloor = useCurrentFloor();
  const openingCount = currentFloor?.openings.filter((o) => o.wallId === wall.id).length ?? 0;
  const floorHeight = currentFloor?.height;

  /** Dời một đầu tường, kéo theo các tường nối chung điểm đó. */
  const moveEnd = (which: 'start' | 'end', to: { x: number; y: number }) =>
    edit((_, f) => {
      const w = f.walls.find((x) => x.id === wall.id);
      if (w) setEndpoints(f, endpointsAt(f, w[which]), to);
    });

  const setLength = (newLen: number) => {
    const dir = normalize(sub(wall.end, wall.start));
    moveEnd('end', add(wall.start, scale(dir, newLen)));
  };

  const patch = (p: Partial<Wall>) =>
    edit((_, f) => {
      const w = f.walls.find((x) => x.id === wall.id);
      if (w) Object.assign(w, p);
    });

  /** Đổi loại tường: độ dày theo loại; chiều cao theo loại (lan can) hoặc trả về cao bằng tầng. */
  const changeKind = (kind: WallKind) => {
    const d = WALL_KIND_DEFAULTS[kind];
    const wasLow = WALL_KIND_DEFAULTS[wallKindOf(wall)].height !== undefined;
    patch({
      kind,
      thickness: d.thickness,
      ...(d.height ? { height: d.height } : wasLow && floorHeight ? { height: floorHeight } : {}),
    });
  };

  return (
    <Panel title="Tường" actions={<DeleteButton />}>
      <SelectField
        label="Loại tường"
        value={wallKindOf(wall)}
        options={WALL_KINDS}
        onChange={changeKind}
      />
      <NumberField label="Chiều dài" value={len} min={0.1} onCommit={setLength} />
      <NumberField
        label="Độ dày"
        value={wall.thickness}
        min={0.05}
        max={2}
        step={0.05}
        onCommit={(v) => patch({ thickness: v })}
      />
      <NumberField
        label="Chiều cao"
        value={wall.height}
        min={0.5}
        max={20}
        onCommit={(v) => patch({ height: v })}
      />
      <div className="pf-grid">
        <NumberField
          label="Đầu X"
          value={wall.start.x}
          onCommit={(x) => moveEnd('start', { ...wall.start, x })}
        />
        <NumberField
          label="Đầu Y"
          value={wall.start.y}
          onCommit={(y) => moveEnd('start', { ...wall.start, y })}
        />
        <NumberField
          label="Cuối X"
          value={wall.end.x}
          onCommit={(x) => moveEnd('end', { ...wall.end, x })}
        />
        <NumberField
          label="Cuối Y"
          value={wall.end.y}
          onCommit={(y) => moveEnd('end', { ...wall.end, y })}
        />
      </div>
      <p className="muted small">{openingCount} ô cửa trên tường này</p>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

function OpeningPanel({ opening, floor }: { opening: Opening; floor: Floor }) {
  const edit = useEditor((s) => s.edit);
  const wall = floor.walls.find((w) => w.id === opening.wallId);
  const wallLen = wall ? wallLength(wall) : opening.width;

  const patch = (p: Partial<Opening>) =>
    edit((_, f) => {
      const o = f.openings.find((x) => x.id === opening.id);
      if (!o) return;
      Object.assign(o, p);
      clampOpenings(f, o.wallId);
    });

  const changeType = (type: OpeningType) => {
    const d = OPENING_DEFAULTS[type];
    patch({ type, height: d.height, sillHeight: d.sillHeight });
  };

  return (
    <Panel title="Ô cửa" actions={<DeleteButton />}>
      <SelectField
        label="Loại"
        value={opening.type}
        options={OPENING_TYPES}
        onChange={changeType}
      />
      {opening.type === 'door' && (
        <>
          <SelectField
            label="Kiểu cánh"
            value={doorStyleOf(opening)}
            options={DOOR_STYLES}
            onChange={(style) => patch({ style })}
          />
          {doorStyleOf(opening) !== 'opening' && (
            <div className="pf">
              <span className="pf-label">Hướng mở</span>
              <span className="pf-input">
                <button
                  type="button"
                  className="btn btn-sm"
                  title="Đổi bên bản lề / phía mở cánh"
                  onClick={() => patch(nextDoorOrientation(opening))}
                >
                  Xoay cửa
                </button>
              </span>
            </div>
          )}
        </>
      )}
      <NumberField
        label="Độ rộng"
        value={opening.width}
        min={0.3}
        max={wallLen}
        onCommit={(v) => patch({ width: v })}
      />
      <NumberField
        label="Chiều cao"
        value={opening.height}
        min={0.3}
        max={10}
        onCommit={(v) => patch({ height: v })}
      />
      {opening.type === 'window' && (
        <NumberField
          label="Bậu cửa cao"
          value={opening.sillHeight}
          min={0}
          max={5}
          onCommit={(v) => patch({ sillHeight: v })}
        />
      )}
      <NumberField
        label="Vị trí trên tường"
        value={opening.offset}
        min={opening.width / 2}
        max={wallLen - opening.width / 2}
        onCommit={(v) => patch({ offset: v })}
      />
      <p className="muted small">
        Tính từ đầu tường tới tâm cửa · tường dài {wallLen.toFixed(2)} m
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

function ConnectorPanel({ connector, floor }: { connector: Connector; floor: Floor }) {
  const building = useEditor((s) => s.building)!;
  const edit = useEditor((s) => s.edit);
  const rect = connectorRect(connector);

  const patch = (recipe: (c: Connector) => void) =>
    edit((_, f) => {
      const c = f.connectors.find((x) => x.id === connector.id);
      if (c) recipe(c);
    });

  const floorsSorted = [...building.floors].sort((a, b) => b.level - a.level);
  const linkedFloors = floorsSorted.filter((f) =>
    f.connectors.some((c) => c.linkId === connector.linkId),
  );
  const missingFloors = floorsSorted.filter((f) => !linkedFloors.includes(f));

  // Các nhóm thang (giếng thang) khác cùng loại trong toà nhà để nối vào.
  const groups = new Map<string, string>();
  for (const f of floorsSorted) {
    for (const c of f.connectors) {
      if (c.type !== connector.type || groups.has(c.linkId)) continue;
      const floors = floorsSorted
        .filter((x) => x.connectors.some((y) => y.linkId === c.linkId))
        .map((x) => x.name);
      groups.set(c.linkId, `${c.name} (${floors.join(', ')})`);
    }
  }
  const NEW_GROUP = '__new__';

  const cloneTo = (floorIds: string[]) =>
    edit((b) => {
      cloneConnectorToFloors(b, floor.id, connector.id, floorIds);
    });

  return (
    <Panel title="Thang" actions={<DeleteButton />}>
      <TextField
        label="Tên"
        value={connector.name}
        onCommit={(v) => patch((c) => void (c.name = v))}
      />
      <SelectField
        label="Loại"
        value={connector.type}
        options={CONNECTOR_TYPES}
        onChange={(type) => patch((c) => void (c.type = type))}
      />
      {connector.type === 'elevator' && (
        <SelectField
          label="Loại thang máy"
          value={elevatorKindOf(connector)}
          options={ELEVATOR_KINDS}
          onChange={(kind) =>
            // Loại thang là của cả giếng thang: đổi luôn ở mọi tầng được nối.
            edit((b) => {
              for (const f of b.floors) {
                for (const c of f.connectors) {
                  if (c.linkId === connector.linkId) c.elevatorKind = kind;
                }
              }
            })
          }
        />
      )}
      {connector.type === 'escalator' && (
        <SelectField
          label="Chiều đi từ tầng này"
          value={connector.direction}
          options={DIRECTIONS}
          onChange={(d) => patch((c) => void (c.direction = d))}
        />
      )}
      <div className="pf-grid">
        <NumberField
          label="Rộng (X)"
          value={rect.width}
          min={0.3}
          onCommit={(v) => patch((c) => setConnectorSize(c, v, rect.depth))}
        />
        <NumberField
          label="Sâu (Y)"
          value={rect.depth}
          min={0.3}
          onCommit={(v) => patch((c) => setConnectorSize(c, rect.width, v))}
        />
      </div>

      <div className="pf-block">
        <span className="pf-label">Nối các tầng</span>
        <div className="chips">
          {linkedFloors.map((f) => (
            <span key={f.id} className={`chip${f.id === floor.id ? ' chip-active' : ''}`}>
              {f.name}
            </span>
          ))}
        </div>
        {linkedFloors.length < 2 && (
          <p className="warn small">
            Thang chưa nối với tầng nào khác — chưa dùng được để chỉ đường.
          </p>
        )}
      </div>

      {missingFloors.length > 0 && (
        <div className="pf-block">
          <span className="pf-label">Đặt cùng thang này ở tầng khác</span>
          <div className="chips">
            {missingFloors.map((f) => (
              <button
                key={f.id}
                type="button"
                className="chip chip-btn"
                onClick={() => cloneTo([f.id])}
              >
                + {f.name}
              </button>
            ))}
            {missingFloors.length > 1 && (
              <button
                type="button"
                className="chip chip-btn"
                onClick={() => cloneTo(missingFloors.map((f) => f.id))}
              >
                + Tất cả
              </button>
            )}
          </div>
        </div>
      )}

      <SelectField
        label="Thuộc nhóm thang"
        value={connector.linkId}
        options={[
          ...[...groups].map(([value, label]) => ({ value, label })),
          { value: NEW_GROUP, label: 'Tách thành nhóm riêng' },
        ]}
        onChange={(v) => patch((c) => void (c.linkId = v === NEW_GROUP ? createId('link') : v))}
      />
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

const LANDMARK_KIND_OPTIONS = (Object.keys(LANDMARK_KINDS) as LandmarkKind[]).map((value) => ({
  value,
  label: LANDMARK_KINDS[value],
}));

const splitTags = (v: string) =>
  v
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

function LandmarkPanel({ landmark }: { landmark: Landmark }) {
  const edit = useEditor((s) => s.edit);
  const patch = (p: Partial<Landmark>) =>
    edit((_, f) => {
      const l = f.landmarks?.find((x) => x.id === landmark.id);
      if (l) Object.assign(l, p);
    });
  const changeKind = (kind: LandmarkKind) =>
    patch({
      kind,
      // Tên vẫn là tên mặc định của loại cũ thì đổi theo loại mới.
      ...(landmark.name.startsWith(LANDMARK_KINDS[landmark.kind])
        ? { name: LANDMARK_KINDS[kind] }
        : {}),
    });

  return (
    <Panel title="Mốc" actions={<DeleteButton />}>
      <SelectField
        label="Loại"
        value={landmark.kind}
        options={LANDMARK_KIND_OPTIONS}
        onChange={changeKind}
      />
      <TextField label="Tên hiển thị" value={landmark.name} onCommit={(name) => patch({ name })} />
      <TextField
        label="Từ khoá tìm kiếm (cách nhau bởi dấu phẩy)"
        value={landmark.tags.join(', ')}
        allowEmpty
        placeholder="vd. rút tiền, thẻ"
        onCommit={(v) => patch({ tags: splitTags(v) })}
      />
      <TextField
        label="Mô tả"
        value={landmark.description ?? ''}
        allowEmpty
        placeholder="vd. Mở cửa 7:00 – 17:00"
        onCommit={(v) => patch({ description: v.trim() || undefined })}
      />
      <div className="pf-grid">
        <NumberField
          label="X"
          value={landmark.position.x}
          onCommit={(x) => patch({ position: { ...landmark.position, x } })}
        />
        <NumberField
          label="Y"
          value={landmark.position.y}
          onCommit={(y) => patch({ position: { ...landmark.position, y } })}
        />
      </div>
      <p className="muted small">
        Kéo biểu tượng để di chuyển. Người dùng tìm được mốc theo tên, loại hoặc từ khoá và được chỉ
        đường tới đây.
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

const NORTH_PRESETS = [
  { angle: 0, label: '↑', title: 'Bắc hướng lên trên' },
  { angle: 90, label: '→', title: 'Bắc hướng sang phải' },
  { angle: 180, label: '↓', title: 'Bắc hướng xuống dưới' },
  { angle: 270, label: '←', title: 'Bắc hướng sang trái' },
];

/**
 * Thiết lập chung của toà nhà: tên, hướng Bắc (để app người dùng xoay bản đồ theo la bàn), độ cao;
 * xoá toà.
 */
function BuildingPanel() {
  const queryClient = useQueryClient();
  const buildings = useBuildings();
  const building = useEditor((s) => s.building)!;
  const edit = useEditor((s) => s.edit);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const list = buildings.data ?? [];
  const remove = async () => {
    // Mở tiếp một toà cùng cơ sở nếu có.
    const campusId = list.find((b) => b.id === building.id)?.campusId;
    const others = list.filter((b) => b.id !== building.id);
    const next = (others.find((b) => b.campusId === campusId) ?? others[0])?.id ?? null;
    setRemoveError(null);
    try {
      await removeBuilding(queryClient, building, next);
    } catch (err) {
      setRemoveError(errorMessage(err));
    }
  };
  const north = building.northAngle ?? 0;
  const setNorth = (v: number) =>
    edit((b) => {
      b.northAngle = ((Math.round(v) % 360) + 360) % 360;
    });

  return (
    <Panel title="Toà nhà">
      <TextField
        label="Tên toà"
        value={building.name}
        onCommit={(name) =>
          edit((b) => {
            b.name = name;
          })
        }
      />
      <div className="north-field">
        <svg viewBox="-20 -20 40 40" width="56" height="56" aria-hidden className="north-dial">
          <circle r="18" fill="none" stroke="currentColor" strokeOpacity="0.25" />
          <g transform={`rotate(${north})`}>
            <path d="M0 -15 L5 0 L-5 0 Z" fill="#dc2626" />
            <path d="M0 15 L5 0 L-5 0 Z" fill="currentColor" opacity="0.4" />
            <text y="-16.5" textAnchor="middle" fontSize="7" fontWeight="800" fill="#dc2626">
              B
            </text>
          </g>
        </svg>
        <div className="grow">
          <NumberField
            label="Hướng Bắc (so với phía trên bản vẽ)"
            value={north}
            step={5}
            min={0}
            max={359}
            precision={0}
            unit="°"
            onCommit={setNorth}
          />
          <div className="btn-row">
            {NORTH_PRESETS.map((p) => (
              <button
                key={p.angle}
                type="button"
                className={`btn btn-sm${north === p.angle ? ' btn-active' : ''}`}
                title={p.title}
                aria-pressed={north === p.angle}
                onClick={() => setNorth(p.angle)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="muted small">
        Tính theo chiều kim đồng hồ: 0° = Bắc hướng lên trên, 90° = sang phải. App người dùng dùng
        góc này để xoay bản đồ theo la bàn của điện thoại — đặt sai thì bản đồ sẽ quay lệch.
      </p>
      <BuildingHeightFields />
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={list.length <= 1}
          title={list.length <= 1 ? 'Không thể xoá toà nhà cuối cùng' : undefined}
          onClick={() => void remove()}
        >
          Xoá toà này
        </button>
      </div>
      {removeError && <p className="error small">{removeError}</p>}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

function FloorPanel({ floor }: { floor: Floor }) {
  const building = useEditor((s) => s.building)!;
  const edit = useEditor((s) => s.edit);
  const setFloor = useEditor((s) => s.setFloor);
  const levelTaken = (level: number) =>
    building.floors.some((f) => f.id !== floor.id && f.level === level);
  const [levelError, setLevelError] = useState<string | null>(null);

  const patch = (p: Partial<Floor>) =>
    edit((_, f) => {
      Object.assign(f, p);
    });

  const remove = () => {
    if (building.floors.length <= 1) return;
    if (!window.confirm(`Xoá ${floor.name} cùng toàn bộ tường, cửa, phòng trên tầng này?`)) return;
    const next = [...building.floors]
      .sort((a, b) => a.level - b.level)
      .find((f) => f.id !== floor.id);
    edit((b) => removeFloor(b, floor.id));
    if (next) setFloor(next.id);
  };

  return (
    <Panel
      title="Tầng"
      actions={
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={building.floors.length <= 1}
          onClick={remove}
        >
          Xoá tầng
        </button>
      }
    >
      <TextField label="Tên tầng" value={floor.name} onCommit={(name) => patch({ name })} />
      <NumberField
        label="Số thứ tự"
        value={floor.level}
        step={1}
        precision={0}
        unit=""
        onCommit={(v) => {
          const level = Math.round(v);
          if (levelTaken(level)) {
            setLevelError(`Đã có tầng số ${level}`);
            return;
          }
          setLevelError(null);
          patch({ level });
        }}
      />
      {levelError && <p className="error small">{levelError}</p>}
      <div className="pf-grid">
        <NumberField
          label="Cao độ sàn"
          value={floor.elevation}
          onCommit={(elevation) => patch({ elevation })}
        />
        <NumberField
          label="Chiều cao tầng"
          value={floor.height}
          min={2}
          max={20}
          onCommit={(height) => patch({ height })}
        />
      </div>
      <p className="muted small">
        {floor.walls.length} tường · {floor.openings.length} cửa · {floor.connectors.length} thang ·{' '}
        {floor.rooms.length} phòng
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

function BackgroundPanel({ floor }: { floor: Floor }) {
  const edit = useEditor((s) => s.edit);
  const setTool = useEditor((s) => s.setTool);
  const settings = useEditor((s) => s.settings);
  const setSettings = useEditor((s) => s.setSettings);
  const [error, setError] = useState<string | null>(null);
  const [opacity, setOpacity] = useState<number | null>(null);
  const bg = floor.background;

  const upload = async (file: File) => {
    try {
      setError(null);
      const img = await readImageAsDataUrl(file);
      // Ước lượng ban đầu: ảnh rộng bằng 40 m — sau đó dùng công cụ hiệu chỉnh tỉ lệ cho chính xác.
      edit((_, f) => {
        f.background = {
          url: img.url,
          metersPerPixel: 40 / img.width,
          offset: { x: 0, y: 0 },
          rotation: 0,
          opacity: 0.5,
        };
      });
      setSettings({ showBackground: true });
    } catch {
      setError('Không đọc được ảnh. Hãy dùng file PNG hoặc JPEG.');
    }
  };

  const patch = (p: Partial<NonNullable<Floor['background']>>) =>
    edit((_, f) => {
      if (f.background) Object.assign(f.background, p);
    });

  return (
    <Panel title="Ảnh mặt bằng (nền)">
      {!bg ? (
        <>
          <p className="muted small">
            Tải ảnh bản vẽ/ảnh chụp mặt bằng để vẽ đè lên cho nhanh và chính xác.
          </p>
          <label className="btn btn-sm">
            Tải ảnh lên…
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = '';
              }}
            />
          </label>
        </>
      ) : (
        <>
          <CheckField
            label="Hiện ảnh nền"
            checked={settings.showBackground}
            onChange={(v) => setSettings({ showBackground: v })}
          />
          <label className="pf">
            <span className="pf-label">Độ mờ</span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={opacity ?? bg.opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              onPointerUp={() => {
                if (opacity !== null) patch({ opacity });
                setOpacity(null);
              }}
              onKeyUp={() => {
                if (opacity !== null) patch({ opacity });
                setOpacity(null);
              }}
            />
          </label>
          <NumberField
            label="Mét / pixel"
            value={bg.metersPerPixel}
            precision={5}
            step={0.001}
            min={0.00001}
            unit=""
            onCommit={(metersPerPixel) => patch({ metersPerPixel })}
          />
          <div className="pf-grid">
            <NumberField
              label="Lệch X"
              value={bg.offset.x}
              onCommit={(x) => patch({ offset: { ...bg.offset, x } })}
            />
            <NumberField
              label="Lệch Y"
              value={bg.offset.y}
              onCommit={(y) => patch({ offset: { ...bg.offset, y } })}
            />
          </div>
          <NumberField
            label="Xoay"
            value={bg.rotation}
            step={1}
            unit="°"
            onCommit={(rotation) => patch({ rotation })}
          />
          <div className="btn-row">
            <button type="button" className="btn btn-sm" onClick={() => setTool('calibrate')}>
              Hiệu chỉnh tỉ lệ…
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() =>
                edit((_, f) => {
                  delete f.background;
                })
              }
            >
              Xoá ảnh
            </button>
          </div>
        </>
      )}
      {error && <p className="error small">{error}</p>}
    </Panel>
  );
}

function CalibrationPanel({ floor }: { floor: Floor }) {
  const edit = useEditor((s) => s.edit);
  const setTool = useEditor((s) => s.setTool);
  const points = useTransient((s) => s.calibration);
  const [real, setReal] = useState('');
  const [p1, p2] = points;
  const measured = p1 && p2 ? distance(p1, p2) : null;

  const apply = () => {
    const realDistance = Number.parseFloat(real.replace(',', '.'));
    if (!p1 || !p2 || !(realDistance > 0)) return;
    edit((_, f) => {
      if (f.background) f.background = calibrateBackground(f.background, p1, p2, realDistance);
    });
    useTransient.getState().patch({ calibration: [] });
    setReal('');
    setTool('select');
  };

  return (
    <Panel title="Hiệu chỉnh tỉ lệ ảnh nền">
      {!floor.background ? (
        <p className="muted small">Tầng này chưa có ảnh nền.</p>
      ) : (
        <>
          <ol className="small steps">
            <li>Click 2 điểm trên ảnh có khoảng cách đã biết (vd. hai đầu một bức tường).</li>
            <li>Nhập khoảng cách thực tế rồi bấm Áp dụng.</li>
          </ol>
          <p className="muted small">
            {measured === null
              ? `Đã chọn ${points.length}/2 điểm`
              : `Đo trên bản đồ: ${measured.toFixed(2)} m`}
          </p>
          <label className="pf">
            <span className="pf-label">Khoảng cách thực</span>
            <span className="pf-input">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.1}
                value={real}
                disabled={measured === null}
                onChange={(e) => setReal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && apply()}
              />
              <span className="pf-unit">m</span>
            </span>
          </label>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={measured === null || !real}
              onClick={apply}
            >
              Áp dụng
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                useTransient.getState().patch({ calibration: [] });
                setTool('select');
              }}
            >
              Huỷ
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

const GRID_SIZES = [
  { value: '0', label: 'Tắt' },
  { value: '0.1', label: '0.1 m' },
  { value: '0.25', label: '0.25 m' },
  { value: '0.5', label: '0.5 m' },
  { value: '1', label: '1 m' },
];

const GRID_UNIT_OPTIONS = [
  { value: '0', label: 'Ẩn lưới' },
  ...GRID_UNITS.map((u) => ({ value: String(u), label: `${u} m` })),
];

function SettingsPanel() {
  const settings = useEditor((s) => s.settings);
  const setSettings = useEditor((s) => s.setSettings);
  return (
    <Panel title="Cài đặt vẽ">
      <div className="pf-grid">
        <SelectField
          label="Ô lưới lớn"
          value={String(settings.gridUnit)}
          options={GRID_UNIT_OPTIONS}
          onChange={(v) => setSettings({ gridUnit: Number(v) })}
        />
        <SelectField
          label="Bước bắt dính lưới"
          value={String(settings.gridSize)}
          options={GRID_SIZES}
          onChange={(v) => setSettings({ gridSize: Number(v) })}
        />
        <NumberField
          label="Tường mới dày"
          value={settings.wallThickness}
          min={0.05}
          max={2}
          step={0.05}
          onCommit={(wallThickness) => setSettings({ wallThickness })}
        />
      </div>
      <CheckField
        label="Bắt dính theo lưới (G)"
        checked={settings.snapGrid}
        onChange={(snapGrid) => setSettings({ snapGrid })}
      />
      <CheckField
        label="Khoá góc 45° khi vẽ tường (giữ Shift để đảo)"
        checked={settings.snapAngle}
        onChange={(snapAngle) => setSettings({ snapAngle })}
      />
      <CheckField
        label="Bắt dính đầu mút / thân tường"
        checked={settings.snapObjects}
        onChange={(snapObjects) => setSettings({ snapObjects })}
      />
      <CheckField
        label="Tường chữ nhật (B) tạo kèm phòng"
        checked={settings.rectWithRoom}
        onChange={(rectWithRoom) => setSettings({ rectWithRoom })}
      />
      <CheckField
        label="Hiện đồ thị đi lại"
        checked={settings.showNavGraph}
        onChange={(showNavGraph) => setSettings({ showNavGraph })}
      />
      <p className="muted small">Giữ Alt khi vẽ / kéo để tạm tắt mọi bắt dính.</p>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

export function PropertiesPanel() {
  const floor = useCurrentFloor();
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  if (!floor) return null;

  if (tool === 'calibrate') return <CalibrationPanel floor={floor} />;

  if (selection.length > 1) {
    return (
      <Panel title={`Đã chọn ${selection.length} đối tượng`}>
        <div className="btn-row">
          <button type="button" className="btn btn-sm" onClick={editorCommands.duplicate}>
            Nhân bản (Ctrl+D)
          </button>
          <DeleteButton label="Xoá tất cả" />
        </div>
        <TransformButtons />
        <p className="muted small">
          Kéo để di chuyển cùng lúc · phím mũi tên để dịch từng ô lưới · Shift+2 để phóng tới vùng
          chọn.
        </p>
      </Panel>
    );
  }

  const ref = selection[0];
  if (ref?.type === 'wall') {
    const wall = floor.walls.find((w) => w.id === ref.id);
    if (wall) return <WallPanel key={wall.id} wall={wall} />;
  }
  if (ref?.type === 'opening') {
    const opening = floor.openings.find((o) => o.id === ref.id);
    if (opening) return <OpeningPanel key={opening.id} opening={opening} floor={floor} />;
  }
  if (ref?.type === 'connector') {
    const connector = floor.connectors.find((c) => c.id === ref.id);
    if (connector) return <ConnectorPanel key={connector.id} connector={connector} floor={floor} />;
  }
  if (ref?.type === 'room') {
    const room = floor.rooms.find((r) => r.id === ref.id);
    if (room) return <RoomPanel key={room.id} room={room} floor={floor} />;
  }
  if (ref?.type === 'landmark') {
    const landmark = floor.landmarks?.find((l) => l.id === ref.id);
    if (landmark) return <LandmarkPanel key={landmark.id} landmark={landmark} />;
  }
  if (ref?.type === 'navNode') {
    const node = floor.navGraph.nodes.find((n) => n.id === ref.id);
    if (node) return <NavNodePanel key={node.id} node={node} floor={floor} />;
  }
  if (ref?.type === 'navEdge') {
    const edge = floor.navGraph.edges.find((e) => e.id === ref.id);
    if (edge) return <NavEdgePanel key={edge.id} edge={edge} floor={floor} />;
  }

  return (
    <>
      <FloorPanel key={floor.id} floor={floor} />
      <BuildingPanel />
      <NavGraphPanel key={`nav:${floor.id}`} floor={floor} />
      <BackgroundPanel key={`bg:${floor.id}`} floor={floor} />
      <SettingsPanel />
    </>
  );
}
