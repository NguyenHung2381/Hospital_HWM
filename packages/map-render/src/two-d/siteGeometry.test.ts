import { describe, expect, it } from 'vitest';
import type { SitePath } from '@hwn/map-core';
import {
  crosswalks,
  cutPolyline,
  entranceLinks,
  gateShape,
  offsetPolyline,
  parkingBays,
} from './siteGeometry';

const path = (kind: SitePath['kind'], points: SitePath['points'], width = 2): SitePath => ({
  id: kind,
  kind,
  points,
  width,
});

describe('cutPolyline (hàng rào chừa lối ở cổng)', () => {
  it('cắt một lỗ giữa đoạn thẳng', () => {
    const pieces = cutPolyline(
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
      [{ position: { x: 10, y: 0.5 }, half: 2 }],
    );
    expect(pieces).toEqual([
      [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
      ],
      [
        { x: 12, y: 0 },
        { x: 20, y: 0 },
      ],
    ]);
  });

  it('giữ nguyên góc gấp khi không có cổng, bỏ qua cổng ở xa', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(cutPolyline(pts, [{ position: { x: 5, y: 8 }, half: 2 }])).toEqual([pts]);
  });
});

describe('gateShape', () => {
  it('cổng xe xoay theo đường xe đi qua, bỏ qua hàng rào; hướng ra ngoài theo đầu đường', () => {
    const road = path(
      'vehicle',
      [
        { x: 0, y: 20 },
        { x: 0, y: 0 },
      ],
      6,
    );
    const fence = path(
      'fence',
      [
        { x: -20, y: 18 },
        { x: 20, y: 18 },
      ],
      0.3,
    );
    const s = gateShape({ id: 'g', name: 'Cổng', kind: 'vehicle', position: { x: 0, y: 18 } }, [
      fence,
      road,
    ]);
    expect(s.angle).toBeCloseTo(-90);
    expect(s.half).toBeCloseTo(3.6);
    expect(s.outward).toEqual({ x: 0, y: 1 });
  });
});

describe('crosswalks', () => {
  const main: SitePath = {
    id: 'main',
    kind: 'shared',
    width: 11,
    sidewalk: 2,
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 50 },
    ],
  };
  const branch: SitePath = {
    id: 'branch',
    kind: 'vehicle',
    width: 6,
    points: [
      { x: 0, y: 20 },
      { x: -20, y: 20 },
    ],
  };

  it('vỉa hè đường chung bị đường nhánh cắt ngang: kẻ vạch ở vỉa hè phía nhánh rẽ ra', () => {
    const zs = crosswalks([main, branch]);
    expect(zs).toHaveLength(1);
    // Tim vỉa hè phía tây cách tim đường 4.5 m; vạch dài bằng bề ngang lòng đường nhánh.
    expect(zs[0]!.p.x).toBeCloseTo(-4.5);
    expect(zs[0]!.p.y).toBeCloseTo(20);
    expect(zs[0]!.length).toBeCloseTo(6);
    expect(zs[0]!.span).toBeCloseTo(2.4);
  });

  it('không kẻ vạch giữa vỉa hè và lòng đường của chính nó', () => {
    expect(crosswalks([main])).toEqual([]);
  });
});

describe('offsetPolyline', () => {
  it('song song cách đều, góc vuông vát đúng', () => {
    const out = offsetPolyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      1,
    );
    expect(out[0]).toEqual({ x: 0, y: 1 });
    expect(out[1]!.x).toBeCloseTo(9);
    expect(out[1]!.y).toBeCloseTo(1);
    expect(out[2]).toEqual({ x: 9, y: 10 });
  });
});

describe('parkingBays', () => {
  it('bãi ô tô 22 x 38 m: một cụm hai dãy dọc cạnh dài', () => {
    const lines = parkingBays(
      [
        { x: 0, y: 0 },
        { x: 22, y: 0 },
        { x: 22, y: 38 },
        { x: 0, y: 38 },
      ],
      'car',
    );
    // Vạch ngăn ô vuông góc cạnh dài (song song trục x), sâu 5 m.
    const dividers = lines.filter((l) => l[1] === l[3]);
    expect(dividers.length).toBeGreaterThan(20);
    expect(dividers.every((l) => Math.abs(l[2]! - l[0]!) === 5)).toBe(true);
  });

  it('khu quá hẹp thì không kẻ ô', () => {
    const narrow = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(parkingBays(narrow, 'car')).toEqual([]);
  });
});

describe('entranceLinks', () => {
  it('nối cửa chính với mép lối đi gần nhất, bỏ cửa ở quá xa', () => {
    const walk = path(
      'covered',
      [
        { x: -4, y: 0 },
        { x: -4, y: 40 },
      ],
      3,
    );
    const links = entranceLinks(
      [
        { x: 0, y: 10 },
        { x: 50, y: 10 },
      ],
      [walk],
    );
    expect(links).toHaveLength(1);
    expect(links[0]!.from.x).toBeCloseTo(-2.6);
    expect(links[0]!.to).toEqual({ x: 0, y: 10 });
    expect(links[0]!.covered).toBe(true);
  });
});
