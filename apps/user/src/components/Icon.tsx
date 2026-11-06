const PATHS = {
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 16l-5-5-9 9" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </>
  ),
  door: (
    <>
      <path d="M5 21V4a1 1 0 0 1 1-1h9v18" />
      <path d="M15 4l4 1.5V21M3 21h18M12 12h.01" />
    </>
  ),
  back: <path d="M15 18l-6-6 6-6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
  wheelchair: (
    <>
      <circle cx="10" cy="4" r="1.5" />
      <path d="M10 7v6h6l3 5M10 10h5" />
      <path d="M7 11.5a5 5 0 1 0 7.5 5.5" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  chevronLeft: <path d="M15 18l-6-6 6-6" />,
  chevronRight: <path d="M9 18l6-6-6-6" />,
  start: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </>
  ),
  straight: <path d="M12 20V4M6 10l6-6 6 6" />,
  left: <path d="M17 20v-7a4 4 0 0 0-4-4H5M9 5L5 9l4 4" />,
  right: <path d="M7 20v-7a4 4 0 0 1 4-4h8M15 5l4 4-4 4" />,
  elevator: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M9 10l3-3 3 3M9 14l3 3 3-3" />
    </>
  ),
  stairs: <path d="M3 20h5v-5h5v-5h5V5h3" />,
  escalator: <path d="M3 19h4l10-12h4" />,
  ramp: <path d="M3 19h18L21 9z" />,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" />,
  pause: <path d="M8 5v14M16 5v14" />,
  walk: (
    <>
      <circle cx="13" cy="4" r="1.6" />
      <path d="M9.5 21l2.5-6 3 2.5V21M12 15l1-5.5-3.5 1.5L8 14M13 9.5l2.5 2.5H19" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 22,
  label,
}: {
  name: IconName;
  size?: number;
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {PATHS[name]}
    </svg>
  );
}
