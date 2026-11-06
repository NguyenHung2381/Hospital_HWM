import { useState } from 'react';
import { Link } from 'react-router';
import type { Id, Route } from '@hwn/map-core';
import type { RouteStepGeometry } from '@hwn/map-render';
import type { PedometerStatus } from '../lib/pedometer';
import { Icon } from './Icon';
import { INSTRUCTION_ICON } from './instructionIcon';

/** Cách người dùng đi theo tuyến: tự bấm từng bước, xem mô phỏng, hoặc theo bước chân thật. */
export type NavMode = 'browse' | 'demo' | 'follow';

const formatMinutes = (seconds: number) => `${Math.max(1, Math.round(seconds / 60))} phút`;
const formatMeters = (m: number) => `${Math.max(0, Math.round(m))} m`;

const PEDOMETER_HINT: Record<PedometerStatus, string> = {
  off: '',
  waiting: 'Đang bật cảm biến chuyển động…',
  active: 'Cứ đi bình thường — hướng dẫn tự chuyển theo bước chân của bạn.',
  unavailable: 'Thiết bị không có cảm biến chuyển động. Hãy bấm "Bước tiếp theo" khi đi.',
};

/** Bảng hướng dẫn ở cuối màn hình: tiến độ, bước hiện tại, bước kế tiếp và danh sách tất cả bước. */
export function StepSheet({
  route,
  steps,
  step,
  walked,
  onStep,
  mode,
  onModeChange,
  pedometer,
  stepCount,
  floorName,
  accessibleOnly,
  onAccessibleChange,
  relocateHref,
}: {
  route: Route;
  steps: readonly RouteStepGeometry[];
  step: number;
  /** Quãng đường đã đi (m). */
  walked: number;
  onStep: (index: number) => void;
  mode: NavMode;
  onModeChange: (mode: NavMode) => void;
  pedometer: PedometerStatus;
  /** Số bước chân đếm được ở chế độ theo bước chân. */
  stepCount: number;
  floorName: (floorId: Id) => string;
  accessibleOnly: boolean;
  onAccessibleChange: (value: boolean) => void;
  relocateHref: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const instructions = route.instructions;
  const current = instructions[step]!;
  const geo = steps[step];
  const next = instructions[step + 1];
  const last = instructions.length - 1;

  const total = Math.max(route.distance, 0.01);
  const remaining = Math.max(0, total - walked);
  const remainingSeconds = (route.estimatedSeconds * remaining) / total;
  const legLeft =
    current.type === 'straight' && geo
      ? mode === 'browse'
        ? current.distance
        : geo.to - walked
      : null;

  const nextLabel =
    step === last
      ? 'Đã tới nơi'
      : current.type.startsWith('take-') && next
        ? `Đã tới ${floorName(next.floorId)}`
        : 'Bước tiếp theo';

  return (
    <footer className={`sheet${expanded ? ' sheet-expanded' : ''}`}>
      <div className="sheet-summary">
        <strong>
          {remaining < total - 0.5 ? 'Còn ' : ''}
          {formatMeters(remaining)} · {formatMinutes(remainingSeconds)}
        </strong>
        <div className="sheet-toggles">
          <button
            type="button"
            className={`chip${mode === 'follow' ? ' chip-active' : ''}`}
            aria-pressed={mode === 'follow'}
            onClick={() => onModeChange(mode === 'follow' ? 'browse' : 'follow')}
          >
            <Icon name="walk" size={18} /> Theo bước chân
          </button>
          <label className="chip" title="Chỉ đi lối phù hợp xe lăn">
            <input
              type="checkbox"
              checked={accessibleOnly}
              onChange={(e) => onAccessibleChange(e.target.checked)}
            />
            <Icon name="wheelchair" size={18} />
            <span className="sr-only">Xe lăn</span>
          </label>
        </div>
      </div>

      <div
        className="route-progress"
        role="progressbar"
        aria-label="Tiến độ đường đi"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(walked)}
      >
        <span style={{ width: `${Math.min(100, (walked / total) * 100)}%` }} />
      </div>

      <div className="step-current" aria-live="polite">
        <span key={step} className={`step-icon step-${current.type}`}>
          <Icon name={INSTRUCTION_ICON[current.type]} size={30} />
        </span>
        <div className="grow">
          <div className="step-meta">
            <span>
              Bước {step + 1}/{instructions.length}
            </span>
            <span className="floor-badge">{floorName(current.floorId)}</span>
          </div>
          <div className="step-text">{current.text}</div>
          {legLeft !== null && mode !== 'browse' && (
            <div className="step-distance">còn {formatMeters(legLeft)}</div>
          )}
        </div>
      </div>

      {next ? (
        <button type="button" className="step-next" onClick={() => onStep(step + 1)}>
          <span className="muted small">Tiếp theo</span>
          <Icon name={INSTRUCTION_ICON[next.type]} size={18} />
          <span className="ellipsis">{next.text}</span>
        </button>
      ) : (
        // Giữ chỗ ở bước cuối để thanh hướng dẫn không thấp đi — khung bản đồ phía trên không đổi
        // kích thước (đổi kích thước làm canvas cấp phát lại và bản đồ phải vẽ lại).
        <div className="step-next" aria-hidden style={{ visibility: 'hidden' }}>
          <span className="muted small">Tiếp theo</span>
          <Icon name="flag" size={18} />
        </div>
      )}

      <div className="step-nav">
        <button
          type="button"
          className="button"
          disabled={step === 0}
          onClick={() => onStep(step - 1)}
          aria-label="Bước trước"
        >
          <Icon name="chevronLeft" />
        </button>
        <button
          type="button"
          className="button button-primary grow"
          disabled={step === last}
          onClick={() => onStep(step + 1)}
        >
          {nextLabel} <Icon name="chevronRight" size={18} />
        </button>
        <button
          type="button"
          className={`button${mode === 'demo' ? ' button-active' : ''}`}
          aria-pressed={mode === 'demo'}
          aria-label={mode === 'demo' ? 'Dừng mô phỏng' : 'Mô phỏng đường đi'}
          title={mode === 'demo' ? 'Dừng mô phỏng' : 'Mô phỏng đường đi'}
          onClick={() => onModeChange(mode === 'demo' ? 'browse' : 'demo')}
        >
          <Icon name={mode === 'demo' ? 'pause' : 'play'} />
        </button>
        <button
          type="button"
          className="button"
          aria-expanded={expanded}
          aria-label="Tất cả các bước"
          onClick={() => setExpanded((v) => !v)}
        >
          <Icon name="list" />
        </button>
      </div>

      {mode === 'follow' && (
        <p className={`muted small follow-hint${pedometer === 'unavailable' ? ' warn' : ''}`}>
          {pedometer === 'active' && <strong>{stepCount} bước · </strong>}
          {PEDOMETER_HINT[pedometer]}
        </p>
      )}

      {expanded && (
        <>
          <ol className="step-list">
            {instructions.map((s, i) => (
              <li key={i}>
                <button
                  type="button"
                  className={`step-item${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}
                  onClick={() => onStep(i)}
                >
                  <Icon name={INSTRUCTION_ICON[s.type]} size={18} />
                  <span className="grow">{s.text}</span>
                  {i > 0 && steps[i - 1]?.floorId !== s.floorId && (
                    <span className="floor-badge">{floorName(s.floorId)}</span>
                  )}
                </button>
              </li>
            ))}
          </ol>
          <Link to={relocateHref} className="button button-block">
            <Icon name="camera" size={18} /> Chụp lại vị trí & tìm lại đường
          </Link>
        </>
      )}
    </footer>
  );
}
