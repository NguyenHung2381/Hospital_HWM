import { LEVEL_STYLE, type Level } from './levels';

const ICON: Record<Level, string> = {
  normal: 'M5 12l4 4 10-10',
  busy: 'M12 8v5M12 16.5v.5',
  overload: 'M12 7v6M12 16.5v.5',
};

/** Nhãn trạng thái: icon + chữ (màu không bao giờ đứng một mình). */
export function LevelBadge({ level }: { level: Level }) {
  const style = LEVEL_STYLE[level];
  return (
    <span className={`level-badge level-${level}`}>
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      >
        {level === 'overload' ? (
          <polygon points="12,2 22,20 2,20" fill={style.color} stroke="none" />
        ) : level === 'busy' ? (
          <circle cx="12" cy="12" r="10" fill={style.color} stroke="none" />
        ) : null}
        <path d={ICON[level]} stroke={level === 'normal' ? style.color : '#ffffff'} />
      </svg>
      {style.label}
    </span>
  );
}
