import { describe, expect, it } from 'vitest';
import { boundsOf } from '@hwn/map-core';
import { createSampleBuilding } from '@hwn/map-core/sample';
import { dxfToBackground, mtextPlain, parseDxf } from './dxf';
import { floorToSvg } from './exportPlan';

/** Ghép các cặp (mã, giá trị) thành nội dung file DXF. */
const dxf = (...pairs: (string | number)[]) => pairs.join('\r\n') + '\r\n';

const header = (units: number) => [
  0,
  'SECTION',
  2,
  'HEADER',
  9,
  '$INSUNITS',
  70,
  units,
  0,
  'ENDSEC',
];

describe('đọc DXF', () => {
  it('LINE, LWPOLYLINE đóng, đơn vị mm từ $INSUNITS', () => {
    // prettier-ignore
    const d = parseDxf(
      dxf(
        ...header(4),
        0, 'SECTION', 2, 'ENTITIES',
        0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 10000, 21, 0,
        0, 'LWPOLYLINE', 8, '0', 90, 3, 70, 1, 10, 0, 20, 0, 10, 1000, 20, 0, 10, 1000, 20, 1000,
        0, 'ENDSEC', 0, 'EOF',
      ),
    );
    expect(d.units).toBe('mm');
    expect(d.guessed).toBe(false);
    expect(d.metersPerUnit).toBe(0.001);
    expect(d.strokes).toHaveLength(2);
    expect(d.strokes[0]!.points).toEqual([
      { x: 0, y: 0 },
      { x: 10000, y: 0 },
    ]);
    expect(d.strokes[1]!.closed).toBe(true);
    expect(d.strokes[1]!.points).toHaveLength(4);
  });

  it('bulge = 1 là nửa đường tròn ngược chiều kim đồng hồ', () => {
    // prettier-ignore
    const d = parseDxf(
      dxf(
        0, 'SECTION', 2, 'ENTITIES',
        0, 'LWPOLYLINE', 90, 2, 70, 0, 10, 0, 20, 0, 42, 1, 10, 2, 20, 0,
        0, 'ENDSEC', 0, 'EOF',
      ),
    );
    const pts = d.strokes[0]!.points;
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts.at(-1)).toEqual({ x: 2, y: 0 });
    // Đi từ (0,0) tới (2,0) ngược chiều kim đồng hồ quanh tâm (1,0) → qua điểm thấp nhất (1,-1).
    const b = boundsOf(pts)!;
    expect(b.minY).toBeCloseTo(-1);
    expect(b.maxY).toBeCloseTo(0);
  });

  it('INSERT dời, xoay, phóng block; block lồng nhau', () => {
    // prettier-ignore
    const d = parseDxf(
      dxf(
        ...header(6),
        0, 'SECTION', 2, 'BLOCKS',
        0, 'BLOCK', 2, 'SEG', 10, 0, 20, 0,
        0, 'LINE', 10, 0, 20, 0, 11, 1, 21, 0,
        0, 'ENDBLK',
        0, 'BLOCK', 2, 'OUTER', 10, 0, 20, 0,
        0, 'INSERT', 2, 'SEG', 10, 0, 20, 0, 41, 2, 42, 2,
        0, 'ENDBLK',
        0, 'ENDSEC',
        0, 'SECTION', 2, 'ENTITIES',
        0, 'INSERT', 2, 'OUTER', 10, 5, 20, 5, 50, 90,
        0, 'ENDSEC', 0, 'EOF',
      ),
    );
    const [a, b] = d.strokes[0]!.points;
    expect(a!.x).toBeCloseTo(5);
    expect(a!.y).toBeCloseTo(5);
    // Dài 1 × 2 = 2, xoay 90° ngược chiều kim đồng hồ → hướng +y.
    expect(b!.x).toBeCloseTo(5);
    expect(b!.y).toBeCloseTo(7);
  });

  it('không ghi đơn vị: đoán mm khi bản vẽ dài hàng chục nghìn đơn vị', () => {
    // prettier-ignore
    const d = parseDxf(
      dxf(0, 'SECTION', 2, 'ENTITIES', 0, 'LINE', 10, 0, 20, 0, 11, 42000, 21, 0, 0, 'ENDSEC'),
    );
    expect(d.guessed).toBe(true);
    expect(d.units).toBe('mm');
  });

  it('bỏ mã định dạng MTEXT', () => {
    expect(mtextPlain('{\\fArial|b1;Phòng}\\PP.101')).toBe('Phòng\nP.101');
    expect(mtextPlain('\\U+00D8 50 %%c')).toBe('Ø 50 Ø');
  });

  it('ảnh nền: lật trục y, đặt góc trên trái về gốc, đúng kích thước thật', () => {
    // prettier-ignore
    const d = parseDxf(
      dxf(
        ...header(4),
        0, 'SECTION', 2, 'ENTITIES',
        0, 'LWPOLYLINE', 90, 4, 70, 1,
        10, 10000, 20, 10000, 10, 30000, 20, 10000, 10, 30000, 20, 20000, 10, 10000, 20, 20000,
        0, 'TEXT', 10, 12000, 20, 15000, 40, 500, 1, 'Kho & <A>',
        0, 'ENDSEC', 0, 'EOF',
      ),
    );
    const r = dxfToBackground(d)!;
    expect(r.width).toBeCloseTo(20);
    expect(r.height).toBeCloseTo(10);
    expect(r.background.offset).toEqual({ x: 0, y: 0 });
    const svg = decodeURIComponent(r.background.url.split(',')[1]!);
    // Ảnh rộng 4000 px ↔ 20 m.
    expect(svg).toContain('width="4000"');
    expect(r.background.metersPerPixel * 4000).toBeCloseTo(20);
    // Chữ ở (2 m, 5 m) tính từ góc trên trái; ký tự đặc biệt được thoát.
    expect(svg).toContain('<text x="2" y="5" font-size="0.5">Kho &amp; &lt;A&gt;</text>');
  });
});

describe('xuất SVG', () => {
  it('có đủ tường, phòng, nhãn, tiêu đề; bỏ lớp đang ẩn; tỉ lệ 1:100', () => {
    const building = createSampleBuilding();
    const floor = building.floors[0]!;
    const full = floorToSvg(building, floor, { size: 'mm' });
    expect(full.svg).toContain(`width="${Math.round(full.width * 10 * 1000) / 1000}mm"`);
    expect(full.svg).toContain(floor.rooms[0]!.name);
    expect(full.svg).toContain(`${building.name} — ${floor.name}`);
    const roomCount = (s: string) => (s.match(/<polygon/g) ?? []).length;
    const hidden = floorToSvg(building, floor, { hiddenLayers: ['rooms'] });
    expect(hidden.svg).not.toContain(floor.rooms[0]!.name);
    expect(roomCount(hidden.svg)).toBe(roomCount(full.svg) - floor.rooms.length);
  });
});
