import { useState, type ReactNode } from 'react';

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

  const commit = () => {
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
              setText(null);
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
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  allowEmpty?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const v = text.trim();
    setText(null);
    if ((v || allowEmpty) && v !== value) onCommit(v);
  };
  return (
    <label className="pf">
      <span className="pf-label">{label}</span>
      <span className="pf-input">
        <input
          value={text ?? value}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') {
              setText(null);
              e.currentTarget.blur();
            }
          }}
        />
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
