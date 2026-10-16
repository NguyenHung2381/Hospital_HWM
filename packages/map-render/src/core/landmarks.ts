import type { LandmarkKind } from '@hwn/map-core';

/**
 * Màu và biểu tượng của từng loại mốc. `icon` là dữ liệu path SVG (khung 24×24, vẽ bằng nét) —
 * dùng được cả trong Konva (`<Path data>`) lẫn SVG thường của các app.
 */
export const LANDMARK_STYLE: Record<LandmarkKind, { color: string; icon: string }> = {
  info: { color: '#2563eb', icon: 'M12 11v6M12 7.5v.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' },
  kiosk: { color: '#0891b2', icon: 'M6 3h12v18H6zM9 7h6M9 11h6M9 15h3' },
  cashier: {
    color: '#ca8a04',
    icon: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 10v4M18 10v4',
  },
  pharmacy: { color: '#16a34a', icon: 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z' },
  restroom: {
    color: '#64748b',
    icon: 'M7 4v.01M17 4v.01M5 8h4v6H8v6H6v-6H5zM12 3v18M15 8h4l1.5 7H18v5h-2v-5h-2.5z',
  },
  atm: { color: '#9333ea', icon: 'M3 6h18v12H3zM3 10h18M7 14h4' },
  water: { color: '#0284c7', icon: 'M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z' },
  waiting: { color: '#78716c', icon: 'M7 4v9h10M7 13v7M17 13v7M7 9h10' },
  canteen: { color: '#ea580c', icon: 'M6 3v7a2 2 0 0 0 4 0V3M8 12v9M17 3c-2 0-3 2-3 5s1 4 3 4v9' },
  other: { color: '#475569', icon: 'M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11zM12 10v.01' },
};
