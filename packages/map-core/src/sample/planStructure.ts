/**
 * Tường, vách, cột, cửa, thang, dốc trích tự động từ nét vector của bộ bản vẽ LAN
 * (`scripts/plans/walls.py`, `features.py`).
 *
 * Mỗi tầng một file JSON gọn trong `./plans/` (toạ độ theo hệ trục của toà, m):
 * - `walls`: `[x0, y0, x1, y1, độ dày, loại?]` — tâm tường; loại 1 = vách nét đơn (vách ngăn nhẹ).
 * - `doors`: `[chỉ số tường, khoảng cách từ đầu tường tới tâm cửa, độ rộng, 1 = cửa 2 cánh]`.
 * - `windows`: `[chỉ số tường, khoảng cách từ đầu tường tới tâm, độ rộng]` — ô kính giữa hai đoạn
 *   tường (khung kính 2–4 nét song song trong bề dày tường).
 * - `columns`: `[tâm x, tâm y, rộng, sâu]` — dựng thành đoạn tường bê tông ngắn.
 * - `connectors`: `{ t: 'stairs' | 'escalator' | 'elevator' | 'ramp', p: [[x, y], …] }` — nối
 *   giữa các tầng bằng `linkPlanConnectors`.
 *
 * Kết quả nhận dạng tự động: có thể thiếu / thừa vài đoạn (bậc thang, nét hatch, ký hiệu…) — sửa
 * trong trang Vẽ toà nhà.
 */
import type { Connector, ConnectorType, Opening, Wall } from '../types';
import banAm from './plans/nha-chinh-ban-am.json';
import t1 from './plans/nha-chinh-t1.json';
import t2 from './plans/nha-chinh-t2.json';
import t3 from './plans/nha-chinh-t3.json';
import t4 from './plans/nha-chinh-t4.json';
import t5 from './plans/nha-chinh-t5.json';
import t6 from './plans/nha-chinh-t6.json';
import t7 from './plans/nha-chinh-t7.json';
import cnk from './plans/khoa-chong-nhiem-khuan.json';
import dd from './plans/khoa-dinh-duong.json';
import gpb from './plans/khoa-giai-phau-benh.json';
import lay1 from './plans/khoa-lay-t1.json';
import lay2 from './plans/khoa-lay-t2.json';

interface PlanStructure {
  walls: number[][];
  doors: number[][];
  windows?: number[][];
  columns: number[][];
  connectors?: { t: string; p: number[][] }[];
}

/** Theo tên file ảnh nền của tầng. */
const STRUCTURES: Record<string, PlanStructure> = {
  'nha-chinh-ban-am.png': banAm,
  'nha-chinh-t1.png': t1,
  'nha-chinh-t2.png': t2,
  'nha-chinh-t3.png': t3,
  'nha-chinh-t4.png': t4,
  'nha-chinh-t5.png': t5,
  'nha-chinh-t6.png': t6,
  'nha-chinh-t7.png': t7,
  'khoa-chong-nhiem-khuan.png': cnk,
  'khoa-dinh-duong.png': dd,
  'khoa-giai-phau-benh.png': gpb,
  'khoa-lay-t1.png': lay1,
  'khoa-lay-t2.png': lay2,
};

const DOOR_HEIGHT = 2.1;
const WINDOW_SILL = 0.9;
const WINDOW_HEIGHT = 1.5;

/** Tường (gồm cột) và cửa của tầng có ảnh nền `image`; ID có tiền tố `floorId`. */
export function planStructure(
  image: string,
  floorId: string,
  height: number,
): { walls: Wall[]; openings: Opening[]; connectors: Connector[] } {
  const data = STRUCTURES[image];
  if (!data) return { walls: [], openings: [], connectors: [] };
  const walls: Wall[] = data.walls.map(
    ([x0 = 0, y0 = 0, x1 = 0, y1 = 0, t = 0.2, kind = 0], i) => ({
      id: `${floorId}_w${i}`,
      start: { x: x0, y: y0 },
      end: { x: x1, y: y1 },
      thickness: t,
      height,
      ...(kind === 1 ? { kind: 'partition' as const } : {}),
    }),
  );
  const openings: Opening[] = data.doors.flatMap(
    ([wi = -1, offset = 0, width = 0, double = 0], i) => {
      const wall = walls[wi];
      if (!wall) return [];
      return [
        {
          id: `${floorId}_d${i}`,
          type: 'door' as const,
          wallId: wall.id,
          offset,
          width,
          height: Math.min(DOOR_HEIGHT, height),
          sillHeight: 0,
          style: double ? ('double' as const) : ('single' as const),
        },
      ];
    },
  );
  (data.windows ?? []).forEach(([wi = -1, offset = 0, width = 0], i) => {
    const wall = walls[wi];
    if (!wall) return;
    openings.push({
      id: `${floorId}_g${i}`,
      type: 'window',
      wallId: wall.id,
      offset,
      width,
      height: Math.max(0.3, Math.min(WINDOW_HEIGHT, height - WINDOW_SILL - 0.3)),
      sillHeight: WINDOW_SILL,
    });
  });
  // Cột: đoạn tường bê tông theo cạnh dài, dày bằng cạnh ngắn.
  data.columns.forEach(([cx = 0, cy = 0, w = 0.4, h = 0.4], i) => {
    const alongX = w >= h;
    const half = (alongX ? w : h) / 2;
    walls.push({
      id: `${floorId}_c${i}`,
      start: alongX ? { x: cx - half, y: cy } : { x: cx, y: cy - half },
      end: alongX ? { x: cx + half, y: cy } : { x: cx, y: cy + half },
      thickness: alongX ? h : w,
      height,
      kind: 'concrete',
    });
  });
  const connectors: Connector[] = (data.connectors ?? []).flatMap((c, i) => {
    const type = CONNECTOR_TYPES.find((t) => t === c.t);
    if (!type || c.p.length < 3) return [];
    return [
      {
        id: `${floorId}_k${i}`,
        type,
        name: '',
        polygon: c.p.map(([x = 0, y = 0]) => ({ x, y })),
        linkId: `${floorId}_k${i}`,
        direction: 'both' as const,
      },
    ];
  });
  return { walls, openings, connectors };
}

const CONNECTOR_TYPES: readonly ConnectorType[] = ['stairs', 'escalator', 'elevator', 'ramp'];

const CONNECTOR_NAME: Record<ConnectorType, string> = {
  stairs: 'Thang bộ',
  escalator: 'Thang cuốn',
  elevator: 'Thang máy',
  ramp: 'Dốc',
};

const bbox = (poly: readonly { x: number; y: number }[]) => ({
  minX: Math.min(...poly.map((p) => p.x)),
  minY: Math.min(...poly.map((p) => p.y)),
  maxX: Math.max(...poly.map((p) => p.x)),
  maxY: Math.max(...poly.map((p) => p.y)),
});

/** Tỉ lệ phần chồng lên nhau của hai khung (so với khung nhỏ hơn). */
function overlapRatio(a: Connector, b: Connector): number {
  const A = bbox(a.polygon);
  const B = bbox(b.polygon);
  const w = Math.min(A.maxX, B.maxX) - Math.max(A.minX, B.minX);
  const h = Math.min(A.maxY, B.maxY) - Math.max(A.minY, B.minY);
  if (w <= 0 || h <= 0) return 0;
  const area = (r: typeof A) => (r.maxX - r.minX) * (r.maxY - r.minY);
  return (w * h) / Math.min(area(A), area(B));
}

/**
 * Nối thang / dốc giữa hai tầng kề nhau (theo `level`) khi cùng loại và chồng lên nhau ≥ 50 % →
 * cùng `linkId`; rồi đặt tên "Thang bộ 1", "Thang máy 2"… theo từng nhóm. Sửa trực tiếp `floors`.
 */
export function linkPlanConnectors(
  floors: readonly { level: number; connectors: Connector[] }[],
): void {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const r = find(p);
    parent.set(id, r);
    return r;
  };
  const sorted = [...floors].sort((a, b) => a.level - b.level);
  for (let i = 1; i < sorted.length; i++) {
    const lower = sorted[i - 1]!;
    const upper = sorted[i]!;
    if (upper.level !== lower.level + 1) continue;
    for (const a of lower.connectors) {
      for (const b of upper.connectors) {
        // Thang cuốn vẽ nhiều vạch bậc nên ở tầng kề có khi nhận thành thang bộ — cùng chỗ thì
        // vẫn là một thang cuốn.
        const escalator =
          (a.type === 'escalator' && b.type === 'stairs') ||
          (a.type === 'stairs' && b.type === 'escalator');
        if ((a.type !== b.type && !escalator) || overlapRatio(a, b) < 0.5) continue;
        if (escalator) a.type = b.type = 'escalator';
        parent.set(find(b.id), find(a.id));
      }
    }
  }
  const numbers = new Map<string, number>();
  const count: Partial<Record<ConnectorType, number>> = {};
  for (const f of sorted) {
    for (const c of f.connectors) {
      const root = find(c.id);
      if (!numbers.has(root)) {
        count[c.type] = (count[c.type] ?? 0) + 1;
        numbers.set(root, count[c.type]!);
      }
      c.linkId = `${root}_link`;
      c.name = `${CONNECTOR_NAME[c.type]} ${numbers.get(root)}`;
    }
  }
}
