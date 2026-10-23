/**
 * Đọc bản vẽ DXF (dạng chữ, AutoCAD R12 trở lên) thành nét vẽ + chữ theo mét, rồi dựng thành ảnh SVG
 * làm nền cho tầng. Hỗ trợ LINE, LWPOLYLINE / POLYLINE (kể cả cung bulge), CIRCLE, ARC, TEXT, MTEXT,
 * INSERT (block lồng nhau) và DIMENSION (vẽ theo block của nó). Bỏ qua SPLINE, ELLIPSE, HATCH.
 */
import { boundsOf, type FloorBackground, type Point } from '@hwn/map-core';

interface Pair {
  code: number;
  value: string;
}

/** Nét vẽ (toạ độ DXF, trục y hướng lên). */
interface Stroke {
  points: Point[];
  closed: boolean;
}

interface Label {
  position: Point;
  text: string;
  height: number;
  /** Độ, ngược chiều kim đồng hồ (như DXF). */
  rotation: number;
}

export interface DxfDrawing {
  strokes: Stroke[];
  labels: Label[];
  /** Số mét mỗi đơn vị bản vẽ. */
  metersPerUnit: number;
  /** Đơn vị đọc được, vd. "mm"; `guessed` = file không ghi đơn vị, đoán theo kích thước. */
  units: string;
  guessed: boolean;
}

/** Đơn vị theo biến $INSUNITS. */
const INSUNITS: Record<number, [string, number]> = {
  1: ['inch', 0.0254],
  2: ['feet', 0.3048],
  4: ['mm', 0.001],
  5: ['cm', 0.01],
  6: ['m', 1],
};

function pairsOf(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i]!.trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: lines[i + 1]!.trim() });
  }
  return pairs;
}

/** Một thực thể: tên (nhóm 0) và các cặp mã / giá trị theo sau. */
interface Entity {
  type: string;
  pairs: Pair[];
}

const num = (e: Entity, code: number, fallback = 0) => {
  const v = e.pairs.find((p) => p.code === code)?.value;
  const x = v === undefined ? Number.NaN : Number.parseFloat(v);
  return Number.isFinite(x) ? x : fallback;
};
const str = (e: Entity, code: number) => e.pairs.find((p) => p.code === code)?.value ?? '';

/** Chia danh sách cặp thành các thực thể (mỗi thực thể bắt đầu bằng mã 0). */
function entitiesOf(pairs: readonly Pair[]): Entity[] {
  const out: Entity[] = [];
  for (const p of pairs) {
    if (p.code === 0) out.push({ type: p.value, pairs: [] });
    else out.at(-1)?.pairs.push(p);
  }
  return out;
}

/** Các điểm trên cung tròn tâm `c`, bán kính `r`, từ góc `a0` tới `a1` (radian, ngược chiều kim đồng hồ). */
function arcPoints(c: Point, r: number, a0: number, a1: number): Point[] {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += Math.PI * 2;
  const steps = Math.max(4, Math.ceil(sweep / (Math.PI / 16)));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = a0 + (sweep * i) / steps;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}

/** Đoạn p→q có độ cong `bulge` (tan(1/4 góc ở tâm)): các điểm từ p tới q, không gồm p. */
function bulgePoints(p: Point, q: Point, bulge: number): Point[] {
  if (Math.abs(bulge) < 1e-9) return [q];
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(q.x - p.x, q.y - p.y);
  if (chord < 1e-12) return [q];
  const r = Math.abs(chord / 2 / Math.sin(theta / 2));
  // Tâm nằm trên trung trực của dây cung, cách trung điểm (có dấu) d theo pháp tuyến trái của p→q:
  // bulge > 0 là cung ngược chiều kim đồng hồ, |bulge| > 1 là cung lớn (tâm sang phía bên kia).
  const d = chord / 2 / Math.tan(theta / 2);
  const ux = (q.x - p.x) / chord;
  const uy = (q.y - p.y) / chord;
  const c = { x: (p.x + q.x) / 2 - uy * d, y: (p.y + q.y) / 2 + ux * d };
  const a0 = Math.atan2(p.y - c.y, p.x - c.x);
  const a1 = Math.atan2(q.y - c.y, q.x - c.x);
  const pts = bulge > 0 ? arcPoints(c, r, a0, a1) : arcPoints(c, r, a1, a0).reverse();
  pts[pts.length - 1] = q;
  return pts.slice(1);
}

/** Đỉnh (kèm bulge) → nét vẽ. */
function polyStroke(vertices: { p: Point; bulge: number }[], closed: boolean): Stroke | null {
  if (vertices.length < 2) return null;
  const points = [vertices[0]!.p];
  const n = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < n; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    points.push(...bulgePoints(a.p, b.p, a.bulge));
  }
  return { points, closed };
}

/** Bỏ mã định dạng của MTEXT (\P = xuống dòng, {\f...;}, \U+XXXX…). */
export function mtextPlain(raw: string): string {
  return raw
    .replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h: string) =>
      String.fromCharCode(Number.parseInt(h, 16)),
    )
    .replace(/\\P/g, '\n')
    .replace(/\\[ACFHQTWfhpqtw][^;\\}]*;/g, '')
    .replace(/\\[LlOoKkNn]/g, '')
    .replace(/\\S([^;]*);/g, (_, s: string) => s.replace(/[#^]/, '/'))
    .replace(/[{}]/g, '')
    .replace(/\\\\/g, '\\')
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±');
}

/** Biến đổi từ hệ trục của block sang hệ trục cha. */
interface Xform {
  apply(p: Point): Point;
  /** Hệ số phóng trung bình (cho chiều cao chữ, bán kính). */
  scale: number;
  rotation: number;
}

const IDENTITY: Xform = { apply: (p) => p, scale: 1, rotation: 0 };

const MAX_DEPTH = 8;

export function parseDxf(text: string): DxfDrawing {
  const pairs = pairsOf(text);
  let insunits = 0;
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i]!.code === 9 && pairs[i]!.value === '$INSUNITS') {
      insunits = Number.parseInt(pairs[i + 1]!.value, 10) || 0;
      break;
    }
  }

  // Tách các section: BLOCKS (định nghĩa block) và ENTITIES (bản vẽ chính).
  const sections = new Map<string, Entity[]>();
  const all = entitiesOf(pairs);
  for (let i = 0; i < all.length; i++) {
    if (all[i]!.type !== 'SECTION') continue;
    const name = str(all[i]!, 2);
    const body: Entity[] = [];
    for (i++; i < all.length && all[i]!.type !== 'ENDSEC'; i++) body.push(all[i]!);
    sections.set(name, body);
  }

  const blocks = new Map<string, { base: Point; entities: Entity[] }>();
  const blockList = sections.get('BLOCKS') ?? [];
  for (let i = 0; i < blockList.length; i++) {
    if (blockList[i]!.type !== 'BLOCK') continue;
    const head = blockList[i]!;
    const entities: Entity[] = [];
    for (i++; i < blockList.length && blockList[i]!.type !== 'ENDBLK'; i++) {
      entities.push(blockList[i]!);
    }
    blocks.set(str(head, 2), { base: { x: num(head, 10), y: num(head, 20) }, entities });
  }

  const strokes: Stroke[] = [];
  const labels: Label[] = [];

  const emit = (s: Stroke | null, t: Xform) => {
    if (s) strokes.push({ points: s.points.map(t.apply), closed: s.closed });
  };

  const walk = (entities: readonly Entity[], t: Xform, depth: number) => {
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i]!;
      const p10 = { x: num(e, 10), y: num(e, 20) };
      switch (e.type) {
        case 'LINE':
          emit({ points: [p10, { x: num(e, 11), y: num(e, 21) }], closed: false }, t);
          break;
        case 'LWPOLYLINE': {
          const vertices: { p: Point; bulge: number }[] = [];
          for (const p of e.pairs) {
            if (p.code === 10) vertices.push({ p: { x: Number(p.value), y: 0 }, bulge: 0 });
            else if (p.code === 20 && vertices.length) vertices.at(-1)!.p.y = Number(p.value);
            else if (p.code === 42 && vertices.length) vertices.at(-1)!.bulge = Number(p.value);
          }
          emit(polyStroke(vertices, (num(e, 70) & 1) === 1), t);
          break;
        }
        case 'POLYLINE': {
          // Các VERTEX theo sau tới SEQEND.
          const vertices: { p: Point; bulge: number }[] = [];
          const closed = (num(e, 70) & 1) === 1;
          for (i++; i < entities.length && entities[i]!.type !== 'SEQEND'; i++) {
            const v = entities[i]!;
            if (v.type === 'VERTEX' && !(num(v, 70) & 16)) {
              vertices.push({ p: { x: num(v, 10), y: num(v, 20) }, bulge: num(v, 42) });
            }
          }
          emit(polyStroke(vertices, closed), t);
          break;
        }
        case 'CIRCLE':
          emit({ points: arcPoints(p10, num(e, 40), 0, Math.PI * 2), closed: true }, t);
          break;
        case 'ARC': {
          const rad = Math.PI / 180;
          emit(
            {
              points: arcPoints(p10, num(e, 40), num(e, 50) * rad, num(e, 51) * rad),
              closed: false,
            },
            t,
          );
          break;
        }
        case 'TEXT':
        case 'MTEXT': {
          const raw =
            e.type === 'MTEXT'
              ? e.pairs
                  .filter((p) => p.code === 3 || p.code === 1)
                  .map((p) => p.value)
                  .join('')
              : str(e, 1);
          const content = mtextPlain(raw).trim();
          if (!content) break;
          // TEXT căn lề khác trái thì vị trí thật ở điểm 11/21.
          const aligned = e.type === 'TEXT' && (num(e, 72) || num(e, 73));
          const pos = aligned ? { x: num(e, 11), y: num(e, 21) } : p10;
          const dirX = num(e, 11);
          const dirY = num(e, 21);
          const rotation =
            e.type === 'MTEXT' && (dirX || dirY)
              ? (Math.atan2(dirY, dirX) * 180) / Math.PI
              : num(e, 50);
          labels.push({
            position: t.apply(pos),
            text: content,
            height: num(e, 40, 2.5) * t.scale,
            rotation: rotation + t.rotation,
          });
          break;
        }
        case 'INSERT':
        case 'DIMENSION': {
          if (depth >= MAX_DEPTH) break;
          const block = blocks.get(str(e, 2));
          if (!block) break;
          // DIMENSION: block đã ở đúng toạ độ bản vẽ.
          const dim = e.type === 'DIMENSION';
          const sx = dim ? 1 : num(e, 41, 1);
          const sy = dim ? 1 : num(e, 42, 1);
          const rot = dim ? 0 : num(e, 50);
          const at = dim ? { x: 0, y: 0 } : p10;
          const base = dim ? { x: 0, y: 0 } : block.base;
          const cos = Math.cos((rot * Math.PI) / 180);
          const sin = Math.sin((rot * Math.PI) / 180);
          const local = (p: Point): Point => {
            const x = (p.x - base.x) * sx;
            const y = (p.y - base.y) * sy;
            return { x: at.x + x * cos - y * sin, y: at.y + x * sin + y * cos };
          };
          walk(
            block.entities,
            {
              apply: (p) => t.apply(local(p)),
              scale: t.scale * Math.sqrt(Math.abs(sx * sy)),
              rotation: t.rotation + rot,
            },
            depth + 1,
          );
          break;
        }
      }
    }
  };
  walk(sections.get('ENTITIES') ?? [], IDENTITY, 0);

  const known = INSUNITS[insunits];
  if (known) return { strokes, labels, units: known[0], metersPerUnit: known[1], guessed: false };
  // Không ghi đơn vị: đoán theo kích thước (một toà nhà thường dài 10–300 m).
  const b = boundsOf(strokes.flatMap((s) => s.points));
  const extent = b ? Math.max(b.maxX - b.minX, b.maxY - b.minY) : 0;
  const [units, metersPerUnit] =
    extent > 1500 ? INSUNITS[4]! : extent > 300 ? INSUNITS[5]! : INSUNITS[6]!;
  return { strokes, labels, units, metersPerUnit, guessed: true };
}

/* ------------------------------------------------------------------ */

/** Cạnh dài nhất của ảnh nền (px ở kích thước gốc). */
const BACKGROUND_SIDE_PX = 4000;

const r2 = (v: number) => String(Math.round(v * 100) / 100);

/**
 * Dựng bản vẽ thành ảnh nền SVG theo mét: lật trục y (DXF hướng lên, mặt bằng hướng xuống), đưa góc
 * trên trái của bản vẽ về gốc toạ độ tầng.
 */
export function dxfToBackground(drawing: DxfDrawing): {
  background: FloorBackground;
  width: number;
  height: number;
} | null {
  const k = drawing.metersPerUnit;
  const toM = (p: Point) => ({ x: p.x * k, y: -p.y * k });
  const strokes = drawing.strokes.map((s) => ({ ...s, points: s.points.map(toM) }));
  const labels = drawing.labels.map((l) => ({
    ...l,
    position: toM(l.position),
    height: l.height * k,
  }));
  const b = boundsOf([...strokes.flatMap((s) => s.points), ...labels.map((l) => l.position)]);
  if (!b) return null;
  const width = Math.max(b.maxX - b.minX, 0.01);
  const height = Math.max(b.maxY - b.minY, 0.01);
  const pxPerMeter = BACKGROUND_SIDE_PX / Math.max(width, height);
  const at = (p: Point) => `${r2(p.x - b.minX)} ${r2(p.y - b.minY)}`;
  const d = strokes.map((s) => `M${s.points.map(at).join('L')}${s.closed ? 'Z' : ''}`).join('');
  const texts = labels
    .map((l) => {
      const p = at(l.position).split(' ');
      // DXF xoay ngược chiều kim đồng hồ; trục y đã lật nên đổi dấu.
      return (
        `<text x="${p[0]}" y="${p[1]}" font-size="${r2(l.height)}"` +
        `${l.rotation ? ` transform="rotate(${r2(-l.rotation)} ${p[0]} ${p[1]})"` : ''}>` +
        l.text
          .split('\n')
          .map((line, i) => {
            const safe = line.replace(
              /[&<>]/g,
              (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!,
            );
            return i ? `<tspan x="${p[0]}" dy="1.2em">${safe}</tspan>` : safe;
          })
          .join('') +
        '</text>'
      );
    })
    .join('');
  // Nét dày 1/800 khổ bản vẽ (≈ 5 cm với toà dài 40 m) để vẫn thấy rõ khi xem cả toà.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width * pxPerMeter)}"` +
    ` height="${Math.round(height * pxPerMeter)}" viewBox="0 0 ${r2(width)} ${r2(height)}">` +
    `<rect width="100%" height="100%" fill="#ffffff"/>` +
    `<path d="${d}" fill="none" stroke="#1e293b" stroke-width="${(Math.max(width, height) / 800).toFixed(3)}"` +
    ` stroke-linejoin="round" stroke-linecap="round"/>` +
    `<g fill="#1e293b" font-family="Arial, sans-serif">${texts}</g></svg>`;
  return {
    background: {
      url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      metersPerPixel: 1 / pxPerMeter,
      offset: { x: 0, y: 0 },
      rotation: 0,
      opacity: 0.6,
    },
    width,
    height,
  };
}
