/** Bảng thuộc tính của đối tượng ngoài trời / cầu nối trong editor mặt bằng tổng thể. */
import {
  DEFAULT_LINK_HEIGHT,
  DEFAULT_LINK_WIDTH,
  DEFAULT_RAMP_RISE,
  gateStyleOf,
  isGateOpen,
  isRoadPath,
  LOBBY_MIN_SIZE,
  LOBBY_SIDES,
  lobbyEdge,
  lobbyRise,
  parseClock,
  slopeRun,
  stepsFor,
  polylineLength,
  rampRise,
  rampWalkWidth,
  sidewalkWidth,
  type BuildingLink,
  type Campus,
  type SiteArea,
  type SiteGate,
  type SiteLobby,
  type SitePath,
  type SitePoi,
} from '@hwn/map-core';
import { CheckField, NumberField, Panel, SelectField, TextField } from '../editor/fields';
import {
  AREA_KINDS,
  GATE_KINDS,
  GATE_STYLES,
  LINK_KINDS,
  LOBBY_EDGE_KINDS,
  LOBBY_RAMP_AT,
  LOBBY_RAMP_SHAPES,
  LOBBY_SIDE_LABEL,
  PATH_KINDS,
  POI_KINDS,
  RAMP_FLOWS,
  RAMP_USES,
  RAMP_WALK_SIDES,
  VEHICLE_KINDS,
} from './kinds';
import { patchItem, type SiteItemType } from './siteOps';

type Change = (fn: (c: Campus) => Campus) => void;

const DeleteButton = ({ onDelete }: { onDelete: () => void }) => (
  <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>
    Xoá
  </button>
);

function usePatch<T extends SiteItemType>(type: T, id: string, change: Change) {
  return (p: Parameters<typeof patchItem<T>>[3]) => change((c) => patchItem(c, type, id, p));
}

/** Lựa chọn loại (giá trị + nhãn) cho ô chọn. */
type KindOptions<T> = readonly { value: T; label: string }[];

export function AreaPanel({
  area,
  change,
  onDelete,
  kinds = AREA_KINDS,
}: {
  area: SiteArea;
  change: Change;
  onDelete: () => void;
  /** Các loại được chọn (vd. chỉ loại dùng cho sảnh của toà). */
  kinds?: KindOptions<SiteArea['kind']>;
}) {
  const patch = usePatch('area', area.id, change);
  return (
    <Panel title="Khu vực" actions={<DeleteButton onDelete={onDelete} />}>
      <TextField
        label="Tên"
        value={area.name ?? ''}
        allowEmpty
        placeholder="vd. Bãi xe máy"
        onCommit={(name) => patch({ name: name || undefined })}
      />
      <SelectField
        label="Loại"
        value={area.kind}
        options={kinds.some((k) => k.value === area.kind) ? kinds : AREA_KINDS}
        onChange={(kind) => patch({ kind })}
      />
      <p className="muted small">
        {area.polygon.length} đỉnh · kéo ô vuông ở đỉnh để sửa · Alt+click vào đỉnh để xoá đỉnh.
      </p>
    </Panel>
  );
}

export function PathPanel({
  path,
  change,
  onDelete,
  kinds = PATH_KINDS,
}: {
  path: SitePath;
  change: Change;
  onDelete: () => void;
  /** Các loại được chọn (vd. chỉ loại dùng cho sảnh / dốc của toà). */
  kinds?: KindOptions<SitePath['kind']>;
}) {
  const patch = usePatch('path', path.id, change);
  const isRoad = isRoadPath(path);
  return (
    <Panel title="Đường / lối đi" actions={<DeleteButton onDelete={onDelete} />}>
      <TextField
        label="Tên"
        value={path.name ?? ''}
        allowEmpty
        placeholder="vd. Đường nội bộ"
        onCommit={(name) => patch({ name: name || undefined })}
      />
      <SelectField
        label="Loại"
        value={path.kind}
        options={kinds.some((k) => k.value === path.kind) ? kinds : PATH_KINDS}
        onChange={(kind) => patch({ kind })}
      />
      <NumberField
        label="Bề rộng"
        value={path.width}
        min={path.kind === 'fence' ? 0.1 : 0.5}
        max={40}
        step={path.kind === 'fence' ? 0.1 : 0.5}
        onCommit={(width) => patch({ width })}
      />
      {path.kind === 'shared' && (
        <NumberField
          label="Vỉa hè mỗi bên"
          value={sidewalkWidth(path)}
          min={0}
          max={6}
          step={0.5}
          onCommit={(sidewalk) => patch({ sidewalk })}
        />
      )}
      {isRoad && (
        <SelectField
          label="Dành cho xe"
          value={path.vehicles ?? 'all'}
          options={VEHICLE_KINDS}
          onChange={(v) => patch({ vehicles: v === 'all' ? undefined : v })}
        />
      )}
      {(path.kind === 'ramp' || path.kind === 'vehicle') && (
        <SelectField
          label="Phục vụ khu"
          value={path.use ?? 'none'}
          options={RAMP_USES}
          onChange={(v) => patch({ use: v === 'none' ? undefined : v })}
        />
      )}
      {path.kind === 'ramp' && (
        <>
          <NumberField
            label="Độ cao dốc (chân → đỉnh)"
            value={rampRise(path)}
            min={0}
            max={10}
            step={0.05}
            onCommit={(rise) =>
              patch({ rise: Math.abs(rise - DEFAULT_RAMP_RISE) < 1e-6 ? undefined : rise })
            }
          />
          <p className="muted small">
            Độ dốc ≈ {((rampRise(path) / (polylineLength(path.points) || 1)) * 100).toFixed(1)}%
            {rampRise(path) / (polylineLength(path.points) || 1) > 1 / 12
              ? ' — dốc hơn 8,3%: không phù hợp xe lăn.'
              : '.'}
          </p>
        </>
      )}
      {path.kind === 'ramp' && (
        <SelectField
          label="Chiều xe chạy"
          value={path.flow ?? 'up'}
          options={RAMP_FLOWS}
          onChange={(flow) => patch({ flow: flow === 'up' ? undefined : flow })}
        />
      )}
      {path.kind === 'ramp' && (
        <SelectField
          label="Lối đi bộ trên dốc"
          value={path.walkway ?? 'none'}
          options={RAMP_WALK_SIDES}
          onChange={(v) => patch({ walkway: v === 'none' ? undefined : v })}
        />
      )}
      {path.kind === 'ramp' && path.walkway && (
        <NumberField
          label="Rộng lối đi bộ"
          value={rampWalkWidth(path)}
          min={0.8}
          max={4}
          step={0.1}
          onCommit={(sidewalk) => patch({ sidewalk })}
        />
      )}
      {path.kind === 'ramp' && path.walkway && (
        <CheckField
          label="Xe lăn đi được (độ dốc ≤ 1:12, có tay vịn)"
          checked={path.accessible !== false}
          onChange={(v) => patch({ accessible: v ? undefined : false })}
        />
      )}
      {isRoad && path.kind !== 'ramp' && (
        <CheckField
          label="Một chiều (theo thứ tự vẽ)"
          checked={!!path.oneWay}
          onChange={(oneWay) => patch({ oneWay })}
        />
      )}
      {path.kind !== 'fence' && (!isRoad || path.kind === 'shared') ? (
        <CheckField
          label="Xe lăn đi được"
          checked={path.accessible !== false}
          onChange={(v) => patch({ accessible: v ? undefined : false })}
        />
      ) : null}
      <p className="muted small">
        {path.kind === 'fence'
          ? 'Hàng rào chỉ để hiển thị — đặt cổng lên hàng rào để tạo lối qua.'
          : path.kind === 'shared'
            ? 'Đường chung: lòng đường ở giữa cho xe, vỉa hè hai bên cho người đi bộ (dùng để chỉ đường).'
            : path.kind === 'ramp'
              ? 'Dốc lên sảnh — vẽ theo tim làn xe, từ chân dốc lên đỉnh dốc (mũi tên chỉ chiều đi lên), nối liền với làn đón trả khách. "Bề rộng" là lòng dốc cho xe; "Lối đi bộ trên dốc" thêm dải đi bộ có bó vỉa bên cạnh để người đi bộ / xe lăn lên sảnh cùng dốc — lối này được dùng khi chỉ đường. "Phục vụ khu" cho dốc màu + biểu tượng riêng (vd. dốc Cấp cứu màu đỏ).'
              : path.kind === 'vehicle'
                ? 'Đường xe chỉ để hiển thị — người đi bộ không được chỉ đi trên đường này.'
                : 'Lối đi bộ được dùng để chỉ đường giữa các toà.'}
      </p>
    </Panel>
  );
}

/** Sảnh: một đối tượng gồm bệ sảnh, bậc / dốc ở các cạnh và làn đón ô tô (tuỳ chọn). */
export function LobbyPanel({
  lobby,
  change,
  onDelete,
}: {
  lobby: SiteLobby;
  change: Change;
  onDelete: () => void;
}) {
  const patch = usePatch('lobby', lobby.id, change);
  const rise = lobbyRise(lobby);
  const steps = stepsFor(rise);
  const drop = lobby.dropoff;
  return (
    <Panel title="Sảnh" actions={<DeleteButton onDelete={onDelete} />}>
      <TextField
        label="Tên"
        value={lobby.name ?? ''}
        allowEmpty
        placeholder="vd. Sảnh Khoa Khám bệnh"
        onCommit={(name) => patch({ name: name || undefined })}
      />
      <SelectField
        label="Phục vụ khu"
        value={lobby.use ?? 'none'}
        options={RAMP_USES}
        onChange={(v) => patch({ use: v === 'none' ? undefined : v })}
      />
      <NumberField
        label="Bề ngang (dọc tường)"
        value={lobby.width}
        min={drop ? 6 : LOBBY_MIN_SIZE}
        max={80}
        step={0.5}
        onCommit={(width) => patch({ width })}
      />
      <NumberField
        label={drop ? 'Chiều sâu phần đi bộ (chưa kể chỗ xe dừng)' : 'Chiều sâu'}
        value={lobby.depth}
        min={LOBBY_MIN_SIZE}
        max={40}
        step={0.5}
        onCommit={(depth) => patch({ depth })}
      />
      <NumberField
        label="Cao bệ (so với mặt đường)"
        value={rise}
        min={0.05}
        max={3}
        step={0.05}
        onCommit={(v) => patch({ rise: Math.abs(v - DEFAULT_RAMP_RISE) < 1e-6 ? undefined : v })}
      />
      <p className="muted small">
        Bậc thang: {steps.count} bậc, sâu {steps.run.toFixed(2)} m · dốc xe lăn (1:12) dài{' '}
        {slopeRun(rise).toFixed(1)} m.
      </p>
      {LOBBY_SIDES.map((side) => {
        const edge = lobbyEdge(lobby, side);
        return (
          <div key={side}>
            <SelectField
              label={
                side === 'front' && drop
                  ? 'Cạnh trước (mép ngoài chỗ xe dừng, giữa 2 dốc)'
                  : LOBBY_SIDE_LABEL[side]
              }
              value={edge.kind}
              options={LOBBY_EDGE_KINDS}
              onChange={(kind) =>
                patch({
                  edges: {
                    ...lobby.edges,
                    [side]:
                      kind === 'steps_ramp' ? { kind, rampAt: edge.rampAt ?? 'right' } : { kind },
                  },
                })
              }
            />
            {edge.kind === 'steps_ramp' && (
              <SelectField
                label="Dốc xe lăn ở"
                value={edge.rampAt ?? 'right'}
                options={LOBBY_RAMP_AT}
                onChange={(rampAt) =>
                  patch({ edges: { ...lobby.edges, [side]: { kind: 'steps_ramp', rampAt } } })
                }
              />
            )}
          </div>
        );
      })}
      <CheckField
        label="Đón / trả khách bằng ô tô (xe chạy lên sảnh qua dốc lên / dốc xuống)"
        checked={!!drop}
        onChange={(on) => patch({ dropoff: on ? { walkway: true } : undefined })}
      />
      {drop && (
        <>
          <SelectField
            label="Hình dốc ô tô"
            value={drop.shape ?? 'curve'}
            options={LOBBY_RAMP_SHAPES}
            onChange={(shape) =>
              patch({ dropoff: { ...drop, shape: shape === 'curve' ? undefined : shape } })
            }
          />
          <CheckField
            label="Lối đi bộ kèm hai dốc ô tô"
            checked={drop.walkway !== false}
            onChange={(walkway) => patch({ dropoff: { ...drop, walkway } })}
          />
          {drop.shape !== 'inline' && (
            <NumberField
              label="Tường → chân dốc"
              value={drop.reach ?? lobby.depth + 3.5 + 3.25}
              min={lobby.depth + 3.75}
              max={60}
              step={0.25}
              onCommit={(reach) => patch({ dropoff: { ...drop, reach } })}
            />
          )}
          {drop.shape !== 'straight' && (
            <NumberField
              label="Tâm sảnh → mỗi chân dốc (dọc tường)"
              value={drop.spread ?? 12.5}
              min={6}
              max={60}
              step={0.25}
              onCommit={(spread) => patch({ dropoff: { ...drop, spread } })}
            />
          )}
        </>
      )}
      <p className="muted small">
        Sảnh là một đối tượng: kéo để dời, R / Shift+R để xoay, kéo ô vuông ở giữa cạnh trước / hai
        cạnh bên để đổi kích thước. Bậc thang, dốc xe lăn, làn đón và dốc ô tô đi theo sảnh. Chân
        bậc / dốc là đầu nối với lối đi bộ của khuôn viên.
      </p>
    </Panel>
  );
}

export function GatePanel({
  gate,
  change,
  onDelete,
}: {
  gate: SiteGate;
  change: Change;
  onDelete: () => void;
}) {
  const patch = usePatch('gate', gate.id, change);
  // Xoá cả hai giờ = mở cả ngày; điền một giờ thì giờ còn lại mặc định theo ca ngày.
  const patchSchedule = (open: string, close: string) =>
    patch({
      schedule: open || close ? { open: open || '06:00', close: close || '22:00' } : undefined,
    });
  return (
    <Panel title="Cổng" actions={<DeleteButton onDelete={onDelete} />}>
      <TextField label="Tên" value={gate.name} onCommit={(name) => patch({ name })} />
      <SelectField
        label="Dành cho"
        value={gate.kind}
        options={GATE_KINDS}
        onChange={(kind) => patch({ kind })}
      />
      <SelectField
        label="Kiểu cổng"
        value={gateStyleOf(gate)}
        options={GATE_STYLES}
        onChange={(style) => patch({ style })}
      />
      <TextField
        label="Giờ mở"
        value={gate.schedule?.open ?? ''}
        allowEmpty
        placeholder="vd. 05:30 (trống = mở cả ngày)"
        onCommit={(open) => patchSchedule(open, gate.schedule?.close ?? '')}
      />
      <TextField
        label="Giờ đóng"
        value={gate.schedule?.close ?? ''}
        allowEmpty
        placeholder="vd. 22:00"
        onCommit={(close) => patchSchedule(gate.schedule?.open ?? '', close)}
      />
      <p className="muted small">
        {!gate.schedule
          ? 'Cổng mở cả ngày.'
          : parseClock(gate.schedule.open) === null || parseClock(gate.schedule.close) === null
            ? 'Giờ phải có dạng HH:MM (vd. 06:00).'
            : `Mở ${gate.schedule.open}–${gate.schedule.close} · hiện ${
                isGateOpen(gate, new Date()) ? 'đang mở' : 'đang đóng'
              }.`}
      </p>
    </Panel>
  );
}

export function PoiPanel({
  poi,
  change,
  onDelete,
}: {
  poi: SitePoi;
  change: Change;
  onDelete: () => void;
}) {
  const patch = usePatch('poi', poi.id, change);
  return (
    <Panel title="Điểm ngoài trời" actions={<DeleteButton onDelete={onDelete} />}>
      <TextField label="Tên" value={poi.name} onCommit={(name) => patch({ name })} />
      <SelectField
        label="Loại"
        value={poi.kind}
        options={POI_KINDS}
        onChange={(kind) => patch({ kind })}
      />
      <TextField
        label="Từ khoá tìm kiếm"
        value={poi.tags.join(', ')}
        allowEmpty
        placeholder="vd. rút tiền, ngân hàng"
        onCommit={(v) =>
          patch({
            tags: v
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          })
        }
      />
      <TextField
        label="Mô tả"
        value={poi.description ?? ''}
        allowEmpty
        placeholder="vd. Mở cửa 6h–22h"
        onCommit={(description) => patch({ description: description || undefined })}
      />
    </Panel>
  );
}

export function LinkPanel({
  link,
  autoElevation,
  buildingName,
  change,
  onDelete,
}: {
  link: BuildingLink;
  /** Cao độ sàn cầu tự tính theo tầng có cửa đầu cầu (khi chưa nhập). */
  autoElevation: number;
  buildingName: (id: string) => string;
  change: Change;
  onDelete: () => void;
}) {
  const patch = usePatch('link', link.id, change);
  return (
    <Panel title="Cầu nối" actions={<DeleteButton onDelete={onDelete} />}>
      <TextField label="Tên" value={link.name} onCommit={(name) => patch({ name })} />
      <SelectField
        label="Loại"
        value={link.kind}
        options={LINK_KINDS}
        onChange={(kind) => patch({ kind })}
      />
      <CheckField
        label="Có mái che"
        checked={link.covered}
        onChange={(covered) => patch({ covered })}
      />
      <CheckField
        label="Xe lăn đi được"
        checked={link.accessible}
        onChange={(accessible) => patch({ accessible })}
      />
      <NumberField
        label="Cao độ sàn cầu"
        value={link.elevation ?? autoElevation}
        min={-30}
        max={300}
        onCommit={(elevation) => patch({ elevation })}
      />
      <div className="pf-grid">
        <NumberField
          label="Chiều cao"
          value={link.height ?? DEFAULT_LINK_HEIGHT}
          min={2}
          max={10}
          onCommit={(height) => patch({ height })}
        />
        <NumberField
          label="Bề rộng"
          value={link.width ?? DEFAULT_LINK_WIDTH}
          min={1}
          max={12}
          step={0.5}
          onCommit={(width) => patch({ width })}
        />
      </div>
      {link.elevation !== undefined && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => patch({ elevation: undefined })}
        >
          Cao độ theo tầng ({autoElevation.toFixed(2)} m)
        </button>
      )}
      <p className="muted small">
        Nối {buildingName(link.a.buildingId)} ↔ {buildingName(link.b.buildingId)}. Cao độ tính từ
        sàn tầng trệt; bỏ trống thì lấy theo cao độ sàn tầng có cửa đầu cầu. Xem cầu trong "Xem 3D".
      </p>
    </Panel>
  );
}
