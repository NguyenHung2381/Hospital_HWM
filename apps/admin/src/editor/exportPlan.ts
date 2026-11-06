/**
 * Xuất mặt bằng một tầng ra SVG (vector, toạ độ mét), PNG (raster từ chính SVG đó) và PDF (in SVG qua
 * hộp thoại in của trình duyệt). Bản xuất dùng nền sáng như bản in, theo các lớp đang hiện.
 */
import {
  add,
  boundsOf,
  normalize,
  polygonCentroid,
  scale,
  sub,
  type Building,
  type Floor,
  type Point,
} from '@hwn/map-core';
import {
  connectorColor,
  doorSymbol,
  LANDMARK_STYLE,
  layoutWall,
  lightMapTheme as theme,
  segmentQuad,
  withAlpha,
  furnitureShapes,
} from '@hwn/map-render';
import {
  annotationPoints,
  dimensionLine,
  furnitureCorners,
  uprightAngle,
  withoutLayers,
} from './ops';
import type { LayerId } from './types';
import { palette } from '@hwn/theme';

/** Lề quanh bản vẽ và chiều cao dải tiêu đề phía dưới (m). */
const MARGIN = 2;
const TITLE_BAND = 2.5;
const FONT = 'Inter, Segoe UI, Arial, sans-serif';

/** Số gọn cho SVG (mm là đủ chính xác). */
const n = (v: number) => String(Math.round(v * 1000) / 1000);
const pts = (list: readonly Point[]) => list.map((p) => `${n(p.x)},${n(p.y)}`).join(' ');

const escapeXml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );

/** Chữ (nhiều dòng) căn giữa tại `p`. */
function text(
  p: Point,
  content: string,
  size: number,
  opts: { bold?: boolean; rotate?: number; fill?: string } = {},
) {
  const lines = content.split('\n');
  const lineHeight = size * 1.2;
  const top = p.y - ((lines.length - 1) * lineHeight) / 2;
  const tspans = lines
    .map((l, i) => `<tspan x="${n(p.x)}" y="${n(top + i * lineHeight)}">${escapeXml(l)}</tspan>`)
    .join('');
  const rotate = opts.rotate ? ` transform="rotate(${n(opts.rotate)} ${n(p.x)} ${n(p.y)})"` : '';
  return (
    `<text font-size="${n(size)}"${opts.bold ? ' font-weight="700"' : ''} fill="${opts.fill ?? theme.roomLabel}"` +
    ` text-anchor="middle" dominant-baseline="central"${rotate}>${tspans}</text>`
  );
}

const line = (a: Point, b: Point, stroke: string, width: number) =>
  `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" stroke="${stroke}" stroke-width="${n(width)}"/>`;

/** Hộp bao mọi thứ được vẽ trên tầng. */
function planBounds(floor: Floor) {
  return (
    boundsOf([
      ...floor.walls.flatMap((w) => [w.start, w.end]),
      ...floor.rooms.flatMap((r) => r.polygon),
      ...floor.connectors.flatMap((c) => c.polygon),
      ...(floor.landmarks ?? []).map((l) => l.position),
      ...(floor.annotations ?? []).flatMap(annotationPoints),
      ...(floor.furniture ?? []).flatMap(furnitureCorners),
    ]) ?? { minX: 0, minY: 0, maxX: 20, maxY: 15 }
  );
}

export interface PlanSvg {
  svg: string;
  /** Khổ bản vẽ (m), kể cả lề và dải tiêu đề. */
  width: number;
  height: number;
}

/**
 * SVG mặt bằng tầng `floor`. Hệ toạ độ SVG = mét (trục y hướng xuống như bản vẽ).
 * @param size đơn vị kích thước ngoài: `mm` = tỉ lệ 1:100 (1 m = 10 mm, mở đúng tỉ lệ trong
 *   Illustrator / Inkscape), `px` = `pxPerMeter` điểm ảnh mỗi mét (để raster thành PNG).
 */
export function floorToSvg(
  building: Building,
  source: Floor,
  opts: { hiddenLayers?: readonly LayerId[]; size?: 'mm' | 'px'; pxPerMeter?: number } = {},
): PlanSvg {
  const floor = withoutLayers(source, opts.hiddenLayers ?? []);
  const b = planBounds(floor);
  const x0 = b.minX - MARGIN;
  const y0 = b.minY - MARGIN;
  const width = b.maxX - b.minX + MARGIN * 2;
  const height = b.maxY - b.minY + MARGIN * 2 + TITLE_BAND;
  const k = opts.size === 'px' ? (opts.pxPerMeter ?? 50) : 10;
  const unit = opts.size === 'px' ? '' : 'mm';
  const out: string[] = [];

  out.push(
    `<rect x="${n(x0)}" y="${n(y0)}" width="${n(width)}" height="${n(height)}" fill="#ffffff"/>`,
  );

  // Phòng.
  const colors = new Map(building.departments.map((d) => [d.id, d.color]));
  for (const r of floor.rooms) {
    const c = r.departmentId ? colors.get(r.departmentId) : undefined;
    out.push(
      `<polygon points="${pts(r.polygon)}" fill="${c ? withAlpha(c, 0.18) : theme.roomFill}"` +
        ` stroke="${c ? withAlpha(c, 0.55) : theme.roomStroke}" stroke-width="0.03"/>`,
    );
  }

  // Thang.
  for (const c of floor.connectors) {
    out.push(
      `<polygon points="${pts(c.polygon)}" fill="${theme.connectorFill}"` +
        ` stroke="${connectorColor(c, theme.connectorStroke)}" stroke-width="0.05"/>`,
    );
  }

  // Nội thất & thiết bị (dưới tường, trên phòng).
  for (const f of floor.furniture ?? []) {
    const ink = theme.roomLabel;
    const fill = (k: string | undefined) =>
      k === 'base'
        ? '#ffffff'
        : k === 'solid'
          ? withAlpha(ink, 0.75)
          : k === 'soft'
            ? withAlpha(ink, 0.18)
            : 'none';
    const shapes = furnitureShapes(f.kind, f.width, f.depth).map((s) =>
      s.kind === 'rect'
        ? `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" rx="${n(s.radius)}" fill="${fill(s.fill)}"/>`
        : s.kind === 'ellipse'
          ? `<ellipse cx="${n(s.cx)}" cy="${n(s.cy)}" rx="${n(s.rx)}" ry="${n(s.ry)}" fill="${fill(s.fill)}"/>`
          : `<polyline points="${s.points.map(n).join(' ')}" fill="none"/>`,
    );
    out.push(
      `<g transform="translate(${n(f.position.x)} ${n(f.position.y)}) rotate(${n(f.rotation ?? 0)})"` +
        ` stroke="${ink}" stroke-width="0.02" stroke-linejoin="round">${shapes.join('')}</g>`,
    );
  }

  // Tường: đoạn đặc tô kín; cửa sổ vẽ khung mảnh; cửa đi vẽ cánh + cung quét.
  for (const w of floor.walls) {
    for (const seg of layoutWall(w, floor.openings)) {
      const quad = segmentQuad(w, seg);
      if (seg.kind === 'solid') {
        out.push(`<polygon points="${pts(quad)}" fill="${theme.wall}"/>`);
      } else if (seg.kind === 'window') {
        out.push(
          `<polygon points="${pts(quad)}" fill="#ffffff" stroke="${theme.wall}" stroke-width="0.02"/>`,
          line(seg.start, seg.end, theme.window, 0.04),
        );
      } else {
        const o = floor.openings.find((x) => x.id === seg.openingId);
        if (!o) continue;
        const sym = doorSymbol(o, seg.start, seg.end, w.thickness);
        const color = seg.kind === 'entrance' ? theme.entrance : theme.wall;
        for (const leaf of sym.leaves) {
          out.push(
            line(leaf.hinge, leaf.tip, color, 0.04),
            `<polyline points="${pts(leaf.arc)}" fill="none" stroke="${color}" stroke-width="0.02" stroke-dasharray="0.08 0.06"/>`,
          );
        }
        for (const p of sym.panels) out.push(line(p.a, p.b, color, 0.05));
      }
    }
  }

  // Nhãn phòng, thang.
  for (const r of floor.rooms) {
    const label = r.code ? `${r.name}\n${r.code}` : r.name;
    out.push(text(polygonCentroid(r.polygon), label, 0.4, { bold: true }));
  }
  for (const c of floor.connectors) out.push(text(polygonCentroid(c.polygon), c.name, 0.35));

  // Mốc: chấm màu kèm biểu tượng và tên.
  for (const l of floor.landmarks ?? []) {
    const style = LANDMARK_STYLE[l.kind];
    const s = 0.5 / 24;
    out.push(
      `<circle cx="${n(l.position.x)}" cy="${n(l.position.y)}" r="0.4" fill="${style.color}"/>`,
      `<path d="${style.icon}" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"` +
        ` stroke-linejoin="round" transform="translate(${n(l.position.x - 0.25)} ${n(l.position.y - 0.25)}) scale(${n(s)})"/>`,
      text({ x: l.position.x, y: l.position.y + 0.75 }, l.name, 0.3),
    );
  }

  // Ghi chú.
  for (const a of floor.annotations ?? []) {
    if (a.kind === 'text') {
      out.push(text(a.position, a.text, a.size, { rotate: a.rotation }));
      continue;
    }
    const { a: p, b: q, normal, length } = dimensionLine(a);
    if (length < 1e-6) continue;
    const out1 = scale(normal, Math.sign(a.offset) || 1);
    const gap = scale(out1, Math.min(0.1, Math.abs(a.offset)));
    const over = scale(out1, 0.2);
    const dir = normalize(sub(q, p));
    const slash = scale(normalize(add(dir, normal)), 0.15);
    const ink = theme.roomLabel;
    out.push(
      line(add(a.start, gap), add(p, over), ink, 0.02),
      line(add(a.end, gap), add(q, over), ink, 0.02),
      line(p, q, ink, 0.02),
      line(sub(p, slash), add(p, slash), ink, 0.04),
      line(sub(q, slash), add(q, slash), ink, 0.04),
      text(add(scale(add(p, q), 0.5), scale(out1, 0.3)), `${length.toFixed(2)} m`, 0.3, {
        rotate: uprightAngle((Math.atan2(dir.y, dir.x) * 180) / Math.PI),
      }),
    );
  }

  // Dải tiêu đề: tên toà / tầng, thước tỉ lệ 5 m, mũi tên chỉ Bắc.
  const ty = b.maxY + MARGIN + TITLE_BAND / 2;
  out.push(
    `<text x="${n(x0 + MARGIN)}" y="${n(ty)}" font-size="0.6" font-weight="700" fill="${theme.roomLabel}"` +
      ` dominant-baseline="central">${escapeXml(`${building.name} — ${source.name}`)}</text>`,
  );
  const sx = x0 + width - MARGIN - 5;
  for (let i = 0; i < 5; i++) {
    out.push(
      `<rect x="${n(sx + i)}" y="${n(ty - 0.12)}" width="1" height="0.24" fill="${i % 2 ? '#ffffff' : theme.roomLabel}" stroke="${theme.roomLabel}" stroke-width="0.02"/>`,
    );
  }
  out.push(
    text({ x: sx, y: ty + 0.5 }, '0', 0.3),
    text({ x: sx + 5, y: ty + 0.5 }, '5 m', 0.3),
    `<g transform="translate(${n(sx - 1.5)} ${n(ty)}) rotate(${n(building.northAngle ?? 0)})">` +
      `<polygon points="0,-0.7 0.3,0.3 0,0.1 -0.3,0.3" fill="${palette.error}"/>` +
      `</g>`,
    text({ x: sx - 1.5, y: ty - 1 }, 'B', 0.35, { bold: true, fill: palette.error }),
  );

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width * k)}${unit}" height="${n(height * k)}${unit}"` +
    ` viewBox="${n(x0)} ${n(y0)} ${n(width)} ${n(height)}" font-family="${FONT}">` +
    `<title>${escapeXml(`${building.name} — ${source.name}`)}</title>${out.join('')}</svg>`;
  return { svg, width, height };
}

/* ------------------------------------------------------------------ */
/* Tải file                                                            */
/* ------------------------------------------------------------------ */

/** Tên file an toàn từ tên toà + tầng. */
export const exportFileName = (building: Building, floor: Floor, ext: string) =>
  `${building.name} - ${floor.name}`.replace(/[\\/:*?"<>|]+/g, '_').trim() + `.${ext}`;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadSvg(building: Building, floor: Floor, hiddenLayers: readonly LayerId[]) {
  const { svg } = floorToSvg(building, floor, { hiddenLayers, size: 'mm' });
  download(new Blob([svg], { type: 'image/svg+xml' }), exportFileName(building, floor, 'svg'));
}

/** Cạnh dài nhất của ảnh PNG (px) — giới hạn canvas an toàn trên mọi trình duyệt. */
const MAX_PNG_SIDE = 8000;

/** Raster SVG thành PNG, `pxPerMeter` điểm ảnh mỗi mét (tự giảm nếu ảnh quá lớn). */
export async function downloadPng(
  building: Building,
  floor: Floor,
  hiddenLayers: readonly LayerId[],
  pxPerMeter = 50,
) {
  const probe = floorToSvg(building, floor, { hiddenLayers });
  const k = Math.min(pxPerMeter, MAX_PNG_SIDE / Math.max(probe.width, probe.height));
  const { svg, width, height } = floorToSvg(building, floor, {
    hiddenLayers,
    size: 'px',
    pxPerMeter: k,
  });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * k);
    canvas.height = Math.round(height * k);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (blob) download(blob, exportFileName(building, floor, 'png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * In bản vẽ (chọn "Lưu dưới dạng PDF" trong hộp thoại in): khổ A3, tự chọn ngang / dọc, vừa trang.
 * ponytail: dùng hộp thoại in của trình duyệt thay cho thư viện PDF — muốn xuất PDF thẳng (không qua
 * hộp thoại) thì thêm jsPDF + svg2pdf.
 */
export function printPdf(building: Building, floor: Floor, hiddenLayers: readonly LayerId[]) {
  const { svg, width, height } = floorToSvg(building, floor, { hiddenLayers, size: 'mm' });
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
  document.body.append(iframe);
  const doc = iframe.contentDocument!;
  const orientation = width >= height ? 'landscape' : 'portrait';
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(exportFileName(building, floor, 'pdf'))}</title>` +
      `<style>@page{size:A3 ${orientation};margin:10mm}html,body{margin:0;height:100%}` +
      `svg{display:block;width:100%;height:100%}</style></head><body>${svg}</body></html>`,
  );
  doc.close();
  const win = iframe.contentWindow!;
  win.addEventListener('afterprint', () => iframe.remove());
  // Đợi font / bố cục xong rồi mới in.
  setTimeout(() => {
    win.focus();
    win.print();
  }, 100);
}
