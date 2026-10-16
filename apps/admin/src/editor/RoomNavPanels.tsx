import { useState } from 'react';
import {
  distance,
  generateNavGraph,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  type Floor,
  type NavEdge,
  type NavGenWarning,
  type NavNode,
  type NavNodeKind,
  type Point,
  type Room,
} from '@hwn/map-core';
import { CheckField, NumberField, Panel, SelectField, TextField } from './fields';
import { setRoomDestination } from './ops';
import { useEditor } from './store';
import { editorCommands } from './useShortcuts';

const DeleteButton = () => (
  <button type="button" className="btn btn-danger btn-sm" onClick={editorCommands.delete}>
    Xoá
  </button>
);

const NO_DEPARTMENT = '__none__';

/* ------------------------------------------------------------------ */

/** Điểm đích mặc định: tâm phòng nếu nằm trong phòng, ngược lại đỉnh đầu tiên lùi vào trong. */
function defaultDestination(room: Room): Point {
  const c = polygonCentroid(room.polygon);
  if (pointInPolygon(c, room.polygon)) return c;
  const v = room.polygon[0]!;
  return { x: v.x + (c.x - v.x) * 0.1, y: v.y + (c.y - v.y) * 0.1 };
}

export function RoomPanel({ room, floor }: { room: Room; floor: Floor }) {
  const building = useEditor((s) => s.building)!;
  const edit = useEditor((s) => s.edit);
  const patch = (p: Partial<Room>) =>
    edit((_, f) => {
      const r = f.rooms.find((x) => x.id === room.id);
      if (r) Object.assign(r, p);
    });

  const roomNode = floor.navGraph.nodes.find((n) => n.kind === 'room' && n.refId === room.id);
  const doorCount = roomNode
    ? floor.navGraph.edges.filter((e) => e.from === roomNode.id || e.to === roomNode.id).length
    : 0;
  const department = building.departments.find((d) => d.id === room.departmentId);

  return (
    <Panel title="Phòng" actions={<DeleteButton />}>
      <TextField label="Tên phòng" value={room.name} onCommit={(name) => patch({ name })} />
      <TextField
        label="Mã phòng"
        value={room.code}
        allowEmpty
        placeholder="vd. P.101"
        onCommit={(code) => patch({ code })}
      />
      <label className="pf">
        <span className="pf-label">Khoa</span>
        <span className="pf-input">
          {department && <span className="dot" style={{ background: department.color }} />}
          <select
            value={room.departmentId ?? NO_DEPARTMENT}
            onChange={(e) =>
              patch({ departmentId: e.target.value === NO_DEPARTMENT ? null : e.target.value })
            }
          >
            <option value={NO_DEPARTMENT}>— Khu vực chung —</option>
            {building.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </span>
      </label>
      <TextField
        label="Từ khoá tìm kiếm (cách nhau bởi dấu phẩy)"
        value={room.tags.join(', ')}
        allowEmpty
        placeholder="vd. siêu âm, chụp phim"
        onCommit={(v) =>
          patch({
            tags: v
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          })
        }
      />
      <div className="pf">
        <span className="pf-label">Điểm đích đến</span>
        {room.destination ? (
          <>
            <p className="muted small">
              Tuyến chỉ đường kết thúc tại chấm đỏ — kéo chấm để đặt đúng chỗ (vd. quầy tiếp đón).
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => edit((_, f) => setRoomDestination(f, room.id, undefined))}
              >
                Bỏ điểm đích
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted small">
              Chưa đặt — tuyến kết thúc ở giữa phòng. Đặt điểm đích nếu người bệnh cần tới một chỗ
              cụ thể trong phòng.
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  edit((_, f) => setRoomDestination(f, room.id, defaultDestination(room)))
                }
              >
                Đặt điểm đích
              </button>
            </div>
          </>
        )}
      </div>
      <p className="muted small">
        Diện tích {polygonArea(room.polygon).toFixed(1)} m² · {room.polygon.length} đỉnh · kéo ô
        vuông ở góc để sửa hình
      </p>
      {roomNode ? (
        <p className="muted small">
          Đồ thị đi lại: nối với {doorCount} cửa{doorCount === 0 ? ' — chưa đi tới được!' : ''}
        </p>
      ) : (
        <p className="warn small">
          Phòng chưa có trong đồ thị đi lại. Vẽ cửa cho phòng rồi bấm “Tự sinh đồ thị” (bỏ chọn để
          thấy bảng Tầng).
        </p>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

const NODE_KINDS: { value: NavNodeKind; label: string }[] = [
  { value: 'corridor', label: 'Hành lang' },
  { value: 'door', label: 'Cửa' },
  { value: 'room', label: 'Phòng (điểm đến)' },
  { value: 'connector', label: 'Thang' },
  { value: 'entrance', label: 'Cửa ra vào chính' },
];

export function NavNodePanel({ node, floor }: { node: NavNode; floor: Floor }) {
  const edit = useEditor((s) => s.edit);
  const patch = (recipe: (n: NavNode) => void) =>
    edit((_, f) => {
      const n = f.navGraph.nodes.find((x) => x.id === node.id);
      if (n) recipe(n);
    });

  // Đối tượng mà nút đại diện, tuỳ theo loại nút.
  const refOptions: { value: string; label: string }[] =
    node.kind === 'room'
      ? floor.rooms.map((r) => ({ value: r.id, label: `${r.code || '—'} ${r.name}` }))
      : node.kind === 'connector'
        ? floor.connectors.map((c) => ({ value: c.id, label: c.name }))
        : node.kind === 'door' || node.kind === 'entrance'
          ? floor.openings
              .filter((o) => o.type !== 'window')
              .map((o) => ({
                value: o.id,
                label: `${o.type === 'entrance' ? 'Cửa chính' : 'Cửa'} ${o.id.slice(-4)}`,
              }))
          : [];
  const degree = floor.navGraph.edges.filter((e) => e.from === node.id || e.to === node.id).length;

  return (
    <Panel title="Điểm đồ thị" actions={<DeleteButton />}>
      <SelectField
        label="Loại"
        value={node.kind}
        options={NODE_KINDS}
        onChange={(kind) =>
          patch((n) => {
            n.kind = kind;
            if (kind === 'corridor') delete n.refId;
          })
        }
      />
      {refOptions.length > 0 && (
        <SelectField
          label="Đại diện cho"
          value={node.refId ?? ''}
          options={[{ value: '', label: '— Chưa gán —' }, ...refOptions]}
          onChange={(refId) =>
            patch((n) => {
              if (refId) n.refId = refId;
              else delete n.refId;
            })
          }
        />
      )}
      <div className="pf-grid">
        <NumberField
          label="X"
          value={node.position.x}
          onCommit={(x) => patch((n) => void (n.position = { ...n.position, x }))}
        />
        <NumberField
          label="Y"
          value={node.position.y}
          onCommit={(y) => patch((n) => void (n.position = { ...n.position, y }))}
        />
      </div>
      <p className="muted small">
        Nối với {degree} điểm khác. Dùng công cụ “Nối đồ thị” (J) để thêm cạnh.
      </p>
    </Panel>
  );
}

export function NavEdgePanel({ edge, floor }: { edge: NavEdge; floor: Floor }) {
  const edit = useEditor((s) => s.edit);
  const a = floor.navGraph.nodes.find((n) => n.id === edge.from);
  const b = floor.navGraph.nodes.find((n) => n.id === edge.to);
  const length = a && b ? distance(a.position, b.position) : 0;
  const patch = (recipe: (e: NavEdge) => void) =>
    edit((_, f) => {
      const e = f.navGraph.edges.find((x) => x.id === edge.id);
      if (e) recipe(e);
    });

  return (
    <Panel title="Cạnh đồ thị" actions={<DeleteButton />}>
      <p className="muted small">Dài {length.toFixed(2)} m</p>
      <CheckField
        label="Chi phí tuỳ chỉnh (thay cho độ dài)"
        checked={edge.weight !== undefined}
        onChange={(on) =>
          patch((e) => {
            if (on) e.weight = Math.round(length * 100) / 100;
            else delete e.weight;
          })
        }
      />
      {edge.weight !== undefined && (
        <NumberField
          label="Chi phí"
          value={edge.weight}
          min={0}
          unit=""
          onCommit={(w) => patch((e) => void (e.weight = w))}
        />
      )}
      <CheckField
        label="Xe lăn / cáng đi được"
        checked={edge.accessible !== false}
        onChange={(ok) =>
          patch((e) => {
            if (ok) delete e.accessible;
            else e.accessible = false;
          })
        }
      />
      <p className="muted small">
        Tăng chi phí để chỉ đường tránh đoạn này (vd. lối đi hẹp, khu vực hạn chế).
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

/** Thống kê & tự sinh đồ thị đi lại — hiện trong bảng Tầng. */
export function NavGraphPanel({ floor }: { floor: Floor }) {
  const building = useEditor((s) => s.building)!;
  const edit = useEditor((s) => s.edit);
  const settings = useEditor((s) => s.settings);
  const setSettings = useEditor((s) => s.setSettings);
  const [warnings, setWarnings] = useState<(NavGenWarning & { floorName: string })[] | null>(null);

  const run = (floors: readonly Floor[]) => {
    const existing = floors.reduce((n, f) => n + f.navGraph.nodes.length, 0);
    if (
      existing > 0 &&
      !window.confirm(
        `Thay thế đồ thị hiện có (${existing} điểm) bằng đồ thị tự sinh? Có thể Hoàn tác (Ctrl+Z).`,
      )
    ) {
      return;
    }
    // Sinh trên dữ liệu hiện tại (chỉ đọc), rồi ghi kết quả vào bản nháp trong một bước undo.
    const results = floors.map((f) => ({ floor: f, result: generateNavGraph(f) }));
    edit((b) => {
      for (const { floor: f, result } of results) {
        const target = b.floors.find((x) => x.id === f.id);
        if (target) target.navGraph = result.graph;
      }
    });
    setWarnings(
      results.flatMap(({ floor: f, result }) =>
        result.warnings.map((w) => ({ ...w, floorName: f.name })),
      ),
    );
    setSettings({ showNavGraph: true });
  };

  return (
    <Panel title="Đồ thị đi lại">
      <p className="muted small">
        {floor.navGraph.nodes.length} điểm · {floor.navGraph.edges.length} cạnh. Đồ thị dùng để tìm
        đường; tự sinh từ tường, cửa, phòng và thang rồi chỉnh tay nếu cần.
      </p>
      <div className="btn-row">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => run([floor])}>
          Tự sinh cho tầng này
        </button>
        {building.floors.length > 1 && (
          <button type="button" className="btn btn-sm" onClick={() => run(building.floors)}>
            Cho tất cả tầng
          </button>
        )}
      </div>
      <CheckField
        label="Hiện đồ thị trên bản đồ"
        checked={settings.showNavGraph}
        onChange={(showNavGraph) => setSettings({ showNavGraph })}
      />
      {warnings && (
        <div className="pf-block">
          {warnings.length === 0 ? (
            <p className="ok small">✓ Đã tạo đồ thị, không có cảnh báo.</p>
          ) : (
            <ul className="small warn-list">
              {warnings.map((w, i) => (
                <li key={i}>
                  {w.floorName}: {w.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}
