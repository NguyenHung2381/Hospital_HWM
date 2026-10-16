import type { SnapKind } from './snap';
import { useEditor } from './store';
import { toolDef } from './tools';
import { useTransient } from './transient';
import { GRID_UNITS, type EditorSettings } from './types';
import { selectionCount } from './workspace';

const SNAP_LABEL: Record<SnapKind, string> = {
  endpoint: 'đầu mút',
  wall: 'thân tường',
  angle: 'khoá góc',
  grid: 'lưới',
  free: 'tự do',
};

const SNAP_TOGGLES: { key: keyof EditorSettings; label: string; title: string }[] = [
  { key: 'snapGrid', label: 'Lưới', title: 'Bắt dính theo lưới (G)' },
  { key: 'snapAngle', label: 'Góc 45°', title: 'Khoá góc 45° khi vẽ (giữ Shift để đảo)' },
  { key: 'snapObjects', label: 'Đầu mút', title: 'Bắt dính đầu mút / thân tường' },
];

const DRAW_TOOLS = new Set(['wall', 'wallRect', 'room', 'measure']);

export function StatusBar() {
  const tool = useEditor((s) => s.tool);
  const selected = useEditor(selectionCount);
  const buildingCount = useEditor(
    (s) => Object.keys(s.peerSelection).length + (s.selection.length ? 1 : 0),
  );
  const settings = useEditor((s) => s.settings);
  const setSettings = useEditor((s) => s.setSettings);
  const cursor = useTransient((s) => s.cursor);
  const snapKind = useTransient((s) => s.snapKind);
  const chainLength = useTransient((s) => s.chainLength);
  const lengthInput = useTransient((s) => s.lengthInput);
  const measure = useTransient((s) => s.measure);
  const def = toolDef(tool);

  const progress =
    (tool === 'wall' || tool === 'room') && chainLength > 0
      ? `Đang vẽ (${chainLength} điểm)${lengthInput ? ` · chiều dài: ${lengthInput} m ↵` : ''} · `
      : '';

  return (
    <div className="editor-status">
      <span className="editor-status-tool">{def.label}</span>
      <span className="editor-status-hint" title={def.hint}>
        {progress}
        {def.hint}
      </span>
      {tool === 'select' && selected > 0 && (
        <span className="editor-status-item">
          Đã chọn {selected}
          {buildingCount > 1 ? ` (trên ${buildingCount} toà)` : ''}
        </span>
      )}
      {tool === 'measure' && measure && (
        <span className="editor-status-item mono editor-status-measure">
          {measure.distance.toFixed(2)} m (Δx {measure.dx.toFixed(2)} · Δy {measure.dy.toFixed(2)})
        </span>
      )}
      <label className="editor-status-grid" title="Cạnh mỗi ô lưới lớn trên khung vẽ">
        Ô lưới
        <select
          value={settings.gridUnit}
          onChange={(e) => setSettings({ gridUnit: Number(e.target.value) })}
        >
          {GRID_UNITS.map((u) => (
            <option key={u} value={u}>
              {u} m
            </option>
          ))}
          <option value={0}>Ẩn</option>
        </select>
      </label>
      <span className="editor-status-snaps" role="group" aria-label="Bắt dính">
        {SNAP_TOGGLES.map((t) => (
          <button
            key={t.key}
            type="button"
            className={settings[t.key] ? 'on' : ''}
            aria-pressed={!!settings[t.key]}
            title={t.title}
            onClick={() => setSettings({ [t.key]: !settings[t.key] })}
          >
            {t.label}
          </button>
        ))}
      </span>
      <span className="editor-status-right mono">
        {DRAW_TOOLS.has(tool) && snapKind && `bắt dính: ${SNAP_LABEL[snapKind]} · `}
        {cursor ? `x ${cursor.x.toFixed(2)}  y ${cursor.y.toFixed(2)}` : '—'}
      </span>
    </div>
  );
}
