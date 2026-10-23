import {
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

const round = (v: number, precision: number) =>
  String(Math.round(v * 10 ** precision) / 10 ** precision);

/**
 * Ô nhập số chỉ ghi giá trị khi rời ô hoặc bấm Enter — mỗi lần sửa là một bước undo,
 * không phải mỗi lần gõ phím.
 */
export function NumberField({
  label,
  value,
  onCommit,
  step = 0.1,
  min,
  max,
  unit = 'm',
  precision = 2,
  disabled,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  precision?: number;
  disabled?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  // Esc gọi blur() ngay trong handler, lúc đó onBlur vẫn thấy giá trị đang gõ — cờ này để bỏ qua.
  const cancelled = useRef(false);

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setText(null);
      return;
    }
    if (text === null) return;
    const parsed = Number.parseFloat(text.replace(',', '.'));
    setText(null);
    if (!Number.isFinite(parsed)) return;
    let v = parsed;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (Math.abs(v - value) > 1e-9) onCommit(v);
  };

  return (
    <label className="pf">
      <span className="pf-label">{label}</span>
      <span className="pf-input">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          value={text ?? round(value, precision)}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
        />
        {unit && <span className="pf-unit">{unit}</span>}
      </span>
    </label>
  );
}

export function TextField({
  label,
  value,
  onCommit,
  allowEmpty = false,
  placeholder,
  multiline = false,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  allowEmpty?: boolean;
  placeholder?: string;
  /** Ô nhiều dòng: Shift+Enter xuống dòng, Enter để ghi. */
  multiline?: boolean;
  /** Focus và bôi đen sẵn nội dung khi hiện ra. */
  autoFocus?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const cancelled = useRef(false);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setText(null);
      return;
    }
    if (text === null) return;
    const v = text.trim();
    setText(null);
    if ((v || allowEmpty) && v !== value) onCommit(v);
  };
  const props = {
    value: text ?? value,
    placeholder,
    autoFocus,
    onFocus: autoFocus
      ? (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => e.currentTarget.select()
      : undefined,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
    onBlur: commit,
    onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
        e.preventDefault();
        e.currentTarget.blur();
      } else if (e.key === 'Escape') {
        cancelled.current = true;
        e.currentTarget.blur();
      }
    },
  };
  return (
    <label className="pf">
      <span className="pf-label">{label}</span>
      <span className="pf-input">
        {multiline ? <textarea rows={3} {...props} /> : <input {...props} />}
      </span>
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="pf">
      <span className="pf-label">{label}</span>
      <span className="pf-input">
        <select value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Panel({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel-header">
        <h3>{title}</h3>
        {actions}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
