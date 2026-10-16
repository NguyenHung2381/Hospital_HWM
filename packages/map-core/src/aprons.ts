/**
 * Mặt lát nối quanh sân / sảnh: lấp các khoảng hở nhỏ bị kẹp giữa sảnh, lối đi bộ trên dốc, vỉa hè,
 * lối đi bộ… để phần dành cho người đi bộ liền thành một mặt. Vẽ 2D và chỉ đường dùng chung kết quả.
 *
 * Cách làm (giống `generateNavGraph`): rời rạc hoá vùng quanh mỗi sân thành lưới ô vuông.
 * - Ô "cấm": lòng đường, lòng dốc, hàng rào, toà nhà và các khu vực khác sân (bãi xe, cỏ, làn đón…).
 * - Ô "đi bộ": sân, vỉa hè, lối đi bộ, lối đi bộ trên dốc.
 * - Còn lại là ô trống. Các ô trống liền nhau là một khoảng hở; khoảng hở được lấp nếu nó bị bao kín
 *   (không chạm mép vùng xét), không quá lớn và nằm sát sân.
 * - Khoảng hở thông ra ngoài vẫn được bo góc: lấp khe hình nêm chỗ lối đi chạm sân (phép "đóng" —
 *   giãn rồi co mặt đi bộ theo bán kính `round`) để lối đi loe ra nhập vào sân, không lộ góc nhọn.
 * Mặt lát lấn thêm một ô sang các ô đi bộ bên cạnh để phủ kín mép lối đi (chỗ nối không lộ); đường
 * bao răng cưa của lưới được làm mượt.
 */
import { rampCenterline, rampWalkLines, rampWalkWidth, sidewalkWidth } from './campus';
import type { SiteArea, SitePlan } from './campus';
import {
  boundsOf,
  distance,
  pointInPolygon,
  polygonArea,
  projectPointOnSegment,
  simplifyPolygon,
  type BBox,
} from './geometry';
import type { Id, Point } from './types';

export interface SiteApron {
  /** Sinh từ ID của sân (ổn định giữa các lần tính). */
  id: Id;
  /** Sân / sảnh mà khoảng hở này nằm sát. */
  plazaId: Id;
  polygon: Point[];
  /** Diện tích khoảng hở được lấp (m², chưa tính phần lấn sang lối đi). */
  area: number;
}

export interface ApronOptions {
  /** Kích thước ô lưới (m). */
  cellSize?: number;
  /** Khoảng hở lớn hơn giá trị này (m²) không lấp — đó là khoảng sân / đất trống thật. */
  maxArea?: number;
  /** Vùng xét quanh mỗi sân (m): khoảng hở phải nằm gọn trong vùng này mới tính là bị bao kín. */
  reach?: number;
  /** Khoảng hở phải có ô cách sân không quá giá trị này (m). */
  near?: number;
  /** Bán kính bo góc (m) chỗ lối đi chạm sân / chạm nhau; 0 = không bo. */
  round?: number;
}

const DEFAULTS: Required<ApronOptions> = {
  cellSize: 0.2,
  maxArea: 200,
  reach: 15,
  near: 3,
  round: 3,
};

const BLOCK = 1;
const PLAZA = 2;
const WALK = 3;
/** Ô trống thuộc phần bo góc. */
const ROUND = 4;
const EMPTY = 0;

/** Một đoạn của đường / lối đi, nở rộng `half` m về hai bên. */
interface Strip {
  a: Point;
  b: Point;
  half: number;
  box: BBox;
}

/** Các đoạn của đường gấp khúc (mỗi đoạn một hộp bao riêng để chỉ duyệt các ô gần đoạn đó). */
const stripsOf = (line: readonly Point[], half: number): Strip[] =>
  half <= 0
    ? []
    : line.slice(1).map((b, i) => {
        const a = line[i]!;
        return {
          a,
          b,
          half,
          box: {
            minX: Math.min(a.x, b.x) - half,
            minY: Math.min(a.y, b.y) - half,
            maxX: Math.max(a.x, b.x) + half,
            maxY: Math.max(a.y, b.y) + half,
          },
        };
      });

const onStrip = (p: Point, s: Strip) => projectPointOnSegment(p, s.a, s.b).distance <= s.half;

/** Hình chữ nhật của một đoạn (đầu cắt vuông). */
function stripRect(s: Strip): Point[] {
  const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) || 1;
  const n = { x: (-(s.b.y - s.a.y) / len) * s.half, y: ((s.b.x - s.a.x) / len) * s.half };
  return [
    { x: s.a.x + n.x, y: s.a.y + n.y },
    { x: s.b.x + n.x, y: s.b.y + n.y },
    { x: s.b.x - n.x, y: s.b.y - n.y },
    { x: s.a.x - n.x, y: s.a.y - n.y },
  ];
}

interface Shape {
  polygon: readonly Point[];
  box: BBox;
}

const shapeOf = (polygon: readonly Point[]): Shape | null => {
  const box = boundsOf(polygon);
  return box && polygon.length >= 3 ? { polygon, box } : null;
};

/**
 * Các mặt lát nối quanh sân / sảnh.
 * @param obstacles đường bao các toà nhà (toạ độ mặt bằng tổng thể) — không lát đè lên toà.
 */
export function siteAprons(
  site: Pick<SitePlan, 'areas' | 'paths'>,
  obstacles: readonly (readonly Point[])[] = [],
  options: ApronOptions = {},
): SiteApron[] {
  const { cellSize: cell, maxArea, reach, near, round } = { ...DEFAULTS, ...options };
  const plazas = site.areas.filter((a) => a.kind === 'plaza' && a.polygon.length >= 3);
  if (!plazas.length) return [];

  const blockShapes = [
    ...obstacles,
    ...site.areas.filter((a) => a.kind !== 'plaza').map((a) => a.polygon),
  ].flatMap((p) => shapeOf(p) ?? []);
  const plazaShapes = plazas.flatMap((a) => shapeOf(a.polygon) ?? []);
  const blockStrips: Strip[] = [];
  const walkStrips: Strip[] = [];
  /** Bậc thang / mặt dốc đi bộ: hình chữ nhật đầu cắt vuông (rộng cả cạnh sảnh, không bo tròn). */
  const walkShapes: Shape[] = [];
  const push = (list: Strip[], line: readonly Point[], half: number) =>
    list.push(...stripsOf(line, half));
  for (const p of site.paths) {
    if (p.points.length < 2) continue;
    switch (p.kind) {
      case 'vehicle':
        push(blockStrips, p.points, p.width / 2);
        break;
      case 'shared':
        push(blockStrips, p.points, p.width / 2 - sidewalkWidth(p));
        push(walkStrips, p.points, p.width / 2);
        break;
      case 'ramp':
        push(blockStrips, rampCenterline(p, site.paths), p.width / 2);
        for (const line of rampWalkLines(p, site.paths)) {
          push(walkStrips, line, rampWalkWidth(p) / 2);
        }
        break;
      case 'fence':
        // Hàng rào mảnh hơn một ô vẫn phải chặn kín.
        push(blockStrips, p.points, Math.max(p.width / 2, cell * 0.75));
        break;
      case 'steps':
      case 'slope':
        for (const st of stripsOf(p.points, p.width / 2)) {
          const shape = shapeOf(stripRect(st));
          if (shape) walkShapes.push(shape);
        }
        break;
      default:
        push(walkStrips, p.points, p.width / 2);
    }
  }

  /** Ô đã thuộc một mặt lát (ô lưới đặt theo toạ độ tuyệt đối nên dùng chung giữa các sân). */
  const used = new Set<string>();
  const aprons: SiteApron[] = [];
  const maxCells = maxArea / (cell * cell);
  const nearCells = Math.ceil(near / cell);

  for (const plaza of plazas) {
    const b = boundsOf(plaza.polygon)!;
    const i0 = Math.floor((b.minX - reach) / cell);
    const j0 = Math.floor((b.minY - reach) / cell);
    const nx = Math.ceil((b.maxX + reach) / cell) - i0;
    const ny = Math.ceil((b.maxY + reach) / cell) - j0;
    const state = new Uint8Array(nx * ny);
    /** Tô `value` cho các ô (trong hộp bao `box`) có tâm thoả `inside`; không ghi đè ô cấm. */
    const paint = (box: BBox, value: number, inside: (p: Point) => boolean, over = true) => {
      const ia = Math.max(0, Math.floor(box.minX / cell) - i0);
      const ib = Math.min(nx - 1, Math.ceil(box.maxX / cell) - i0);
      const ja = Math.max(0, Math.floor(box.minY / cell) - j0);
      const jb = Math.min(ny - 1, Math.ceil(box.maxY / cell) - j0);
      const hits: number[] = [];
      for (let j = ja; j <= jb; j++) {
        for (let i = ia; i <= ib; i++) {
          const k = j * nx + i;
          if (state[k] === BLOCK || (!over && state[k] !== EMPTY)) continue;
          if (inside({ x: (i0 + i + 0.5) * cell, y: (j0 + j + 0.5) * cell })) {
            state[k] = value;
            hits.push(k);
          }
        }
      }
      return hits;
    };
    // Ưu tiên: cấm > sân > lối đi.
    for (const s of blockStrips) paint(s.box, BLOCK, (p) => onStrip(p, s));
    for (const s of blockShapes) paint(s.box, BLOCK, (p) => pointInPolygon(p, s.polygon));
    const own = shapeOf(plaza.polygon)!;
    let frontier: number[] = [];
    for (const s of plazaShapes) {
      const hits = paint(s.box, PLAZA, (p) => pointInPolygon(p, s.polygon));
      if (s.polygon === own.polygon) frontier = hits;
    }
    for (const s of walkStrips) paint(s.box, WALK, (p) => onStrip(p, s), false);
    for (const s of walkShapes) paint(s.box, WALK, (p) => pointInPolygon(p, s.polygon), false);

    // Khoảng cách (số ô) từ CHÍNH sân này, đi qua các ô không cấm — để xét "nằm sát sân" (khoảng
    // hở bên kia hàng rào / lòng đường không tính là sát sân).
    const dist = new Int32Array(nx * ny).fill(-1);
    for (const k of frontier) dist[k] = 0;
    for (let d = 1; d <= nearCells && frontier.length; d++) {
      const next: number[] = [];
      for (const k of frontier) {
        const i = k % nx;
        const j = Math.floor(k / nx);
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const a = i + di;
            const c = j + dj;
            if (a < 0 || c < 0 || a >= nx || c >= ny) continue;
            const q = c * nx + a;
            if (dist[q] === -1 && state[q] !== BLOCK) {
              dist[q] = d;
              next.push(q);
            }
          }
        }
      }
      frontier = next;
    }

    roundCorners(state, nx, ny, Math.round(round / cell));

    /** Thêm một mặt lát phủ các ô `cells` (bỏ qua nếu có ô đã thuộc mặt lát khác). */
    const emit = (cells: readonly number[]) => {
      const keys = cells.map((k) => `${i0 + (k % nx)}:${j0 + Math.floor(k / nx)}`);
      if (keys.some((key) => used.has(key))) return;
      for (const key of keys) used.add(key);

      // Lấn một ô sang lối đi / sân bên cạnh (không lấn sang ô cấm).
      const fill = new Set<number>(cells);
      for (const k of cells) {
        const i = k % nx;
        const j = Math.floor(k / nx);
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const a = i + di;
            const c = j + dj;
            if (a < 0 || c < 0 || a >= nx || c >= ny) continue;
            const q = c * nx + a;
            if (state[q] === WALK || state[q] === PLAZA) fill.add(q);
          }
        }
      }
      // Hai ô chỉ chạm nhau ở góc: thêm một ô bắc cầu (không phải ô cấm) để đường bao liền một vòng.
      for (const k of [...fill]) {
        const i = k % nx;
        const j = Math.floor(k / nx);
        for (const [di, dj] of [
          [1, 1],
          [-1, 1],
        ] as const) {
          const a = i + di;
          const c = j + dj;
          if (a < 0 || a >= nx || c >= ny || !fill.has(c * nx + a)) continue;
          const side = [j * nx + a, c * nx + i];
          if (side.some((q) => fill.has(q))) continue;
          const bridge = side.find((q) => state[q] !== BLOCK);
          if (bridge !== undefined) fill.add(bridge);
        }
      }
      const polygon = smoothOutline(outline(fill, nx, i0, j0, cell), cell);
      if (polygon.length < 3) return;
      aprons.push({
        id: `apron:${plaza.id}:${aprons.filter((a) => a.plazaId === plaza.id).length}`,
        plazaId: plaza.id,
        polygon,
        area: cells.length * cell * cell,
      });
    };

    const seen = new Uint8Array(nx * ny);
    /** Gom các ô liền nhau (4 hướng, hoặc cả 8 hướng nếu `diagonal`) thoả `ok`, từ ô `start`. */
    const flood = (start: number, ok: (k: number) => boolean, diagonal = false) => {
      const cells: number[] = [];
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const k = stack.pop()!;
        cells.push(k);
        const i = k % nx;
        const j = Math.floor(k / nx);
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if ((!di && !dj) || (!diagonal && di && dj)) continue;
            const a = i + di;
            const c = j + dj;
            if (a < 0 || c < 0 || a >= nx || c >= ny) continue;
            const q = c * nx + a;
            if (ok(q) && !seen[q]) {
              seen[q] = 1;
              stack.push(q);
            }
          }
        }
      }
      return cells;
    };
    const isGap = (k: number) => state[k] === EMPTY || state[k] === ROUND;
    const isRound = (k: number) => state[k] === ROUND;
    const close = (cells: readonly number[]) => cells.some((k) => dist[k] !== -1);

    for (let start = 0; start < nx * ny; start++) {
      if (!isGap(start) || seen[start]) continue;
      const cells = flood(start, isGap);
      const open = cells.some((k) => {
        const i = k % nx;
        const j = Math.floor(k / nx);
        return i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
      });
      if (!open && close(cells) && cells.length <= maxCells) {
        emit(cells);
        continue;
      }
      // Khoảng hở không lấp được (thông ra ngoài / quá lớn): chỉ lấp phần bo góc sát sân. Ô bo góc
      // dọc mép xiên của lối đi có thể chỉ chạm nhau ở góc ô → gom cả 8 hướng để thành một mặt.
      const rounded = cells.filter(isRound);
      for (const k of rounded) seen[k] = 0;
      for (const k of rounded) {
        if (seen[k]) continue;
        const part = flood(k, isRound, true);
        if (close(part)) emit(part);
      }
    }
  }
  return aprons;
}

/**
 * Đánh dấu `ROUND` cho các ô trống thuộc phép "đóng" của mặt đi bộ (sân + lối đi) với hình tròn bán
 * kính `r` ô: ô trống mà mọi ô trong vòng `r` quanh nó đều cách mặt đi bộ không quá `r` ô (ô cấm coi
 * như đạt). Đó là các khe hình nêm / khe hẹp chỗ lối đi chạm sân hay chạm nhau — lấp vào thành góc bo.
 */
function roundCorners(state: Uint8Array, nx: number, ny: number, r: number) {
  if (r <= 0) return;
  // Bình phương khoảng cách (số ô) tới mặt đi bộ gần nhất.
  const d = squaredDistances(nx, ny, (k) => state[k] === PLAZA || state[k] === WALK);
  const r2 = r * r;
  const disk: [number, number][] = [];
  for (let dj = -r; dj <= r; dj++) {
    for (let di = -r; di <= r; di++) if (di * di + dj * dj <= r * r) disk.push([di, dj]);
  }
  const hits: number[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (state[k] !== EMPTY || d[k]! > r2) continue;
      const inside = disk.every(([di, dj]) => {
        const a = i + di;
        const c = j + dj;
        if (a < 0 || c < 0 || a >= nx || c >= ny) return false;
        const q = c * nx + a;
        return state[q] === BLOCK || d[q]! <= r2;
      });
      if (inside) hits.push(k);
    }
  }
  for (const k of hits) state[k] = ROUND;
}

/**
 * Bình phương khoảng cách Euclid (số ô) từ mỗi ô tới ô nguồn gần nhất — biến đổi khoảng cách tách
 * theo hàng / cột (Felzenszwalb & Huttenlocher), chính xác chứ không xấp xỉ như chamfer.
 */
function squaredDistances(nx: number, ny: number, source: (k: number) => boolean) {
  const FAR = 1e12;
  const d = new Float64Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) d[k] = source(k) ? 0 : FAR;
  const n = Math.max(nx, ny);
  const f = new Float64Array(n);
  const out = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  /** Đường bao dưới của các parabol (q - p)² + f[p] trên một dãy `len` ô. */
  const pass = (len: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    const cross = (q: number, p: number) => (f[q]! + q * q - (f[p]! + p * p)) / (2 * (q - p));
    for (let q = 1; q < len; q++) {
      let s = cross(q, v[k]!);
      while (s <= z[k]!) s = cross(q, v[--k]!);
      v[++k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1]! < q) k++;
      out[q] = (q - v[k]!) ** 2 + f[v[k]!]!;
    }
  };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) f[j] = d[j * nx + i]!;
    pass(ny);
    for (let j = 0; j < ny; j++) d[j * nx + i] = out[j]!;
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) f[i] = d[j * nx + i]!;
    pass(nx);
    for (let i = 0; i < nx; i++) d[j * nx + i] = out[i]!;
  }
  return d;
}

/**
 * Làm mượt đường bao răng cưa của lưới ô `cell` m: chia đều đường bao (bước nửa ô) rồi lấy trung
 * bình trượt vài lượt (gần như lọc Gauss, bán kính ~1,5 ô) — bậc thang thành đường cong trơn, cạnh
 * thẳng giữ nguyên, góc chỉ bo nhẹ.
 */
function smoothOutline(polygon: readonly Point[], cell: number): Point[] {
  if (polygon.length < 3) return [...polygon];
  const step = cell / 2;
  let pts: Point[] = [];
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!;
    const n = Math.max(1, Math.round(distance(a, b) / step));
    for (let k = 0; k < n; k++) {
      pts.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
  });
  const half = 3;
  for (let pass = 0; pass < 3; pass++) {
    const n = pts.length;
    pts = pts.map((_, i) => {
      let x = 0;
      let y = 0;
      for (let d = -half; d <= half; d++) {
        const q = pts[(((i + d) % n) + n) % n]!;
        x += q.x;
        y += q.y;
      }
      return { x: x / (2 * half + 1), y: y / (2 * half + 1) };
    });
  }
  return simplifyPolygon(pts, cell * 0.02);
}

/**
 * Đường bao ngoài của một tập ô (chỉ số `j * nx + i` trong lưới bắt đầu từ ô `(i0, j0)`), bỏ các
 * đỉnh thẳng hàng. Tập ô có lỗ thủng thì chỉ lấy đường bao ngoài.
 */
function outline(cells: ReadonlySet<number>, nx: number, i0: number, j0: number, cell: number) {
  const has = (i: number, j: number) => i >= 0 && i < nx && cells.has(j * nx + i);
  // Cạnh có hướng (ô nằm bên phải theo chiều đi, trục y hướng xuống), theo toạ độ đỉnh lưới.
  const out = new Map<string, [number, number][]>();
  const add = (a: [number, number], b: [number, number]) => {
    const key = `${a[0]}:${a[1]}`;
    const list = out.get(key);
    if (list) list.push(b);
    else out.set(key, [b]);
  };
  for (const k of cells) {
    const i = k % nx;
    const j = Math.floor(k / nx);
    if (!has(i, j - 1)) add([i, j], [i + 1, j]);
    if (!has(i + 1, j)) add([i + 1, j], [i + 1, j + 1]);
    if (!has(i, j + 1)) add([i + 1, j + 1], [i, j + 1]);
    if (!has(i - 1, j)) add([i, j + 1], [i, j]);
  }
  const loops: [number, number][][] = [];
  for (const [startKey, list] of out) {
    while (list.length) {
      const [sx, sy] = startKey.split(':').map(Number) as [number, number];
      const loop: [number, number][] = [[sx, sy]];
      let prev: [number, number] = [sx, sy];
      let cur = list.pop()!;
      while (!(cur[0] === sx && cur[1] === sy)) {
        loop.push(cur);
        const next = out.get(`${cur[0]}:${cur[1]}`)!;
        // Chỗ hai ô chỉ chạm góc: rẽ phải trước để mỗi vòng bao không tự cắt.
        const dir = [cur[0] - prev[0], cur[1] - prev[1]];
        const right = [-dir[1]!, dir[0]!];
        let idx = next.findIndex((q) => q[0] - cur[0] === right[0] && q[1] - cur[1] === right[1]);
        if (idx < 0) idx = next.length - 1;
        prev = cur;
        cur = next.splice(idx, 1)[0]!;
      }
      loops.push(loop);
    }
  }
  const toPoints = (loop: [number, number][]) =>
    loop
      .filter((p, i) => {
        const a = loop[(i + loop.length - 1) % loop.length]!;
        const b = loop[(i + 1) % loop.length]!;
        return (b[0] - p[0]) * (p[1] - a[1]) !== (b[1] - p[1]) * (p[0] - a[0]);
      })
      .map(([i, j]) => ({ x: (i0 + i) * cell, y: (j0 + j) * cell }));
  let best: Point[] = [];
  let bestArea = 0;
  for (const loop of loops) {
    const pts = toPoints(loop);
    const area = pts.length >= 3 ? polygonArea(pts) : 0;
    if (area > bestArea) {
      best = pts;
      bestArea = area;
    }
  }
  return best;
}

/** Sân / sảnh kèm các mặt lát nối (dạng khu vực `plaza`) — để vẽ và chỉ đường như sân thường. */
export const apronAreas = (aprons: readonly SiteApron[]): SiteArea[] =>
  aprons.map((a) => ({ id: a.id, kind: 'plaza', polygon: a.polygon }));
