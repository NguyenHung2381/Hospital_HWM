"""Trích tường, cột, cửa từ nét vector của bản vẽ PDF (xuất từ CAD qua matplotlib — không có layer).

usage: python walls.py <result.json> <params.json> <out_dir> [page ...]

Nhận dạng:
- Tường: cặp nét thẳng song song, cách nhau 8–45 cm, giữa hai nét không có nét nào khác (ghép
  "gần nhất"). Chuỗi ≥ 3 nét cách đều (bậc thang, nét gạch hatch, khung cửa sổ) bị loại.
- Cột: khối tô đặc (hoặc ô vuông viền có hình tròn bên trong) cỡ 20–120 cm.
- Cửa: khe giữa hai đoạn tường thẳng hàng cùng độ dày, rộng 0,6–2,6 m, có cung cánh cửa ở gần.
Toạ độ ra theo hệ trục của toà (m), đã cộng `offset` của tầng (xem export.py).
"""
import json
import math
import os
import sys
from bisect import bisect_left, bisect_right
from collections import defaultdict

import cv2
import numpy as np
import pymupdf as fitz

import features as F

# Bộ bản vẽ: biến môi trường HWN_PLANS_PDF, mặc định trong thư mục Downloads.
PDF = os.environ.get('HWN_PLANS_PDF') or os.path.expanduser(
    os.path.join('~', 'Downloads', 'HE THONG LAN - MAT BANG KHONG DAY.pdf'))

T_MIN, T_MAX = 0.045, 0.45  # độ dày tường, vách (m)
MIN_SEG = 0.12  # bỏ nét ngắn hơn (nét đứt, ký hiệu nhỏ)
ANG_BIN = 0.5  # độ
DOOR_MIN, DOOR_MAX = 0.6, 2.6


def page_segments(page, scale, title):
    """Mọi đoạn thẳng (m), đường cong (điểm mẫu), khối tô đặc của trang."""
    segs, curves, fills, circles = [], [], [], []
    dots, quads = [], []
    for dr in page.get_drawings():
        r = dr['rect']
        if r.width > 0.9 * page.rect.width or r.height > 0.9 * page.rect.height:
            continue
        if r.intersects(title):
            continue
        typ = dr['type']
        kinds_ = {it[0] for it in dr['items']}
        if 'f' in typ and dr.get('fill') and sum(dr['fill']) < 0.3 and kinds_ == {'c'} \
                and r.width * scale <= 0.25 and r.height * scale <= 0.25:
            dots.append(((r.x0 + r.x1) / 2 * scale, (r.y0 + r.y1) / 2 * scale))
            continue
        if 'f' in typ and dr.get('fill') and sum(dr['fill']) < 0.3 and 'c' not in ''.join(it[0] for it in dr['items']):
            pts = []
            for it in dr['items']:
                if it[0] == 'l':
                    pts += [it[1], it[2]]
                elif it[0] in ('re', 'qu'):
                    pts = None
                    break
            area = r.width * r.height
            if pts and area > 0:
                poly = sum(pts[i].x * pts[(i + 1) % len(pts)].y - pts[(i + 1) % len(pts)].x * pts[i].y
                           for i in range(len(pts))) / 2
                # lặp điểm (mỗi cạnh 2 điểm) làm diện tích không đổi; hình thoi / tam giác ≈ ½ khung
                if abs(poly) < 0.75 * area:
                    continue
            fills.append(fitz.Rect(r.x0 * scale, r.y0 * scale, r.x1 * scale, r.y1 * scale))
            continue
        if 's' not in typ:
            continue
        for it in dr['items']:
            k = it[0]
            if k == 'l':
                a, b = it[1], it[2]
                segs.append((a.x * scale, a.y * scale, b.x * scale, b.y * scale))
                if abs(a - b) * scale < MIN_SEG:  # nét đứt của cung cánh cửa
                    curves.append(((a.x + b.x) / 2 * scale, (a.y + b.y) / 2 * scale))
            elif k == 're':
                q = it[1]
                quads.append((q.x0 * scale, q.y0 * scale, q.x1 * scale, q.y1 * scale))
                pts = [(q.x0, q.y0), (q.x1, q.y0), (q.x1, q.y1), (q.x0, q.y1)]
                for i in range(4):
                    (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % 4]
                    segs.append((x0 * scale, y0 * scale, x1 * scale, y1 * scale))
            elif k == 'qu':
                q = it[1]
                qr = q.rect
                quads.append((qr.x0 * scale, qr.y0 * scale, qr.x1 * scale, qr.y1 * scale))
                pts = [q.ul, q.ur, q.lr, q.ll]
                for i in range(4):
                    a, b = pts[i], pts[(i + 1) % 4]
                    segs.append((a.x * scale, a.y * scale, b.x * scale, b.y * scale))
            elif k == 'c':
                p0, p1, p2, p3 = it[1:5]
                for t in (0, 0.2, 0.4, 0.6, 0.8, 1):
                    m = 1 - t
                    x = m**3 * p0.x + 3 * m * m * t * p1.x + 3 * m * t * t * p2.x + t**3 * p3.x
                    y = m**3 * p0.y + 3 * m * m * t * p1.y + 3 * m * t * t * p2.y + t**3 * p3.y
                    curves.append((x * scale, y * scale))
        kinds = {it[0] for it in dr['items']}
        if kinds == {'c'} and len(dr['items']) >= 4 and 's' in typ:
            w, h = r.width * scale, r.height * scale
            if 0.25 <= w <= 0.9 and abs(w - h) < 0.08 * w:
                circles.append(fitz.Rect(r.x0 * scale, r.y0 * scale, r.x1 * scale, r.y1 * scale))
    return segs, curves, fills, circles, dots, quads


def circles_centres(curves):
    """Tâm gần đúng của các hình tròn nhỏ (dùng nhận cột ô vuông có vòng tròn)."""
    return curves


class Line:
    __slots__ = ('ang', 'v', 'u0', 'u1', 'id')

    def __init__(self, ang, v, u0, u1):
        self.ang, self.v, self.u0, self.u1 = ang, v, u0, u1


def to_lines(segs):
    """Gom theo hướng; mỗi nét = (v: khoảng cách tới gốc theo pháp tuyến, [u0,u1] dọc hướng)."""
    by = defaultdict(list)
    for x0, y0, x1, y1 in segs:
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        if L < MIN_SEG:
            continue
        ang = math.degrees(math.atan2(dy, dx)) % 180
        b = round(ang / ANG_BIN) * ANG_BIN % 180
        t = math.radians(b)
        ux, uy = math.cos(t), math.sin(t)
        nx, ny = -uy, ux
        v = (x0 * nx + y0 * ny + x1 * nx + y1 * ny) / 2
        u0, u1 = sorted((x0 * ux + y0 * uy, x1 * ux + y1 * uy))
        by[b].append(Line(b, v, u0, u1))
    # nối các nét thẳng hàng chồng / sát nhau
    out = {}
    for b, ls in by.items():
        # gom theo hàng (v gần như bằng nhau) trước, rồi mới nối dọc hàng — so với nét vừa nối
        # cuối cùng thì một nét ngắn bị "nuốt" vào nét dài ở xa cùng hàng (mất vạch bậc, mặt tường)
        ls.sort(key=lambda l: l.v)
        rows, row = [], []
        for l in ls:
            if row and l.v - row[-1].v >= 0.006:
                rows.append(row)
                row = []
            row.append(l)
        if row:
            rows.append(row)
        merged = []
        for row in rows:
            row.sort(key=lambda l: l.u0)
            cur = None
            for l in row:
                if cur and l.u0 <= cur.u1 + 0.02:
                    cur.u1 = max(cur.u1, l.u1)
                else:
                    cur = Line(b, l.v, l.u0, l.u1)
                    merged.append(cur)
        merged = drop_dashed(merged)
        merged.sort(key=lambda l: l.v)
        for i, l in enumerate(merged):
            l.id = (b, i)
        out[b] = merged
    return out


def drop_dashed(lines):
    """Bỏ nét đứt / gạch chấm (trục lưới, đường bao mái…): chuỗi ≥ 6 gạch thẳng hàng, dài bằng nhau,
    cách đều — trục lưới thường chạy giữa lòng tường và chặn việc ghép hai mặt tường."""
    rows = defaultdict(list)
    for l in lines:
        rows[round(l.v / 0.006)].append(l)
    drop = set()
    for row in rows.values():
        row.sort(key=lambda l: l.u0)
        run = [row[0]]

        def flush(run):
            if len(run) >= 6 and run[-1].u1 - run[0].u0 >= 4:
                for x in run:
                    drop.add(id(x))

        for l in row[1:]:
            prev = run[-1]
            L, Lp = l.u1 - l.u0, prev.u1 - prev.u0
            gap = l.u0 - prev.u1
            same = L <= 1.5 and abs(L - Lp) <= 0.06 * max(L, Lp) + 0.01 and 0.03 <= gap <= 1.0
            if same and len(run) >= 2:
                g0 = run[1].u0 - run[0].u1
                same = abs(gap - g0) <= 0.15 * max(gap, g0) + 0.01
            if same:
                run.append(l)
            else:
                flush(run)
                run = [l]
        flush(run)
    return [l for l in lines if id(l) not in drop]


def subtract(intervals, a, b):
    res = []
    for x, y in intervals:
        if b <= x or a >= y:
            res.append((x, y))
            continue
        if a > x:
            res.append((x, a))
        if b < y:
            res.append((b, y))
    return res


def find_pairs(lines):
    """Cặp nét gần nhất phía trên mỗi nét (không có nét nào ở giữa)."""
    pairs = []  # (bin, vA, vB, u0, u1, idA, idB)
    for b, ls in lines.items():
        vs = [l.v for l in ls]
        for i, A in enumerate(ls):
            free = [(A.u0, A.u1)]
            j0 = bisect_right(vs, A.v + 0.004)
            j1 = bisect_right(vs, A.v + T_MAX)
            # mọi nét trong dải (kể cả quá mỏng) theo thứ tự xa dần — nét gần che nét xa
            for j in range(bisect_right(vs, A.v), j1):
                B = ls[j]
                o0, o1 = max(A.u0, B.u0), min(A.u1, B.u1)
                if o1 - o0 <= 0:
                    continue
                if j >= j0 and B.v - A.v >= T_MIN:
                    for x, y in free:
                        p0, p1 = max(x, o0), min(y, o1)
                        if p1 - p0 >= 0.1:
                            pairs.append((b, A.v, B.v, p0, p1, A.id, B.id))
                free = subtract(free, o0, o1)
                if not free:
                    break
    return pairs


def drop_series(pairs):
    """Bỏ chuỗi nét cách đều (bậc thang, hatch, khung kính): cặp có cặp kề ở cả hai phía."""
    below = defaultdict(list)  # idB -> pairs có nét trên = idB ... dùng để tìm cặp kề
    above = defaultdict(list)
    for p in pairs:
        above[p[5]].append(p)  # p nằm trên nét A
        below[p[6]].append(p)  # p nằm dưới nét B

    def similar(p, q):
        tp, tq = p[2] - p[1], q[2] - q[1]
        ov = min(p[4], q[4]) - max(p[3], q[3])
        # cùng độ dày và cùng chiều dài (bậc thang, hatch) — ký hiệu nhỏ dính vào tường không tính
        return abs(tp - tq) < 0.3 * max(tp, tq) and ov > 0.6 * max(p[4] - p[3], q[4] - q[3])

    keep = []
    for p in pairs:
        lower = any(similar(p, q) for q in below[p[5]])  # cặp ngay dưới nét A
        upper = any(similar(p, q) for q in above[p[6]])  # cặp ngay trên nét B
        n_lower = [q for q in below[p[5]] if similar(p, q)]
        n_upper = [q for q in above[p[6]] if similar(p, q)]
        series = False
        if lower and upper:
            series = True
        elif lower:
            series = any(any(similar(q, r) for r in below[q[5]]) for q in n_lower)
        elif upper:
            series = any(any(similar(q, r) for r in above[q[6]]) for q in n_upper)
        if not series:
            keep.append(p)
    return keep


def pieces_from_pairs(pairs):
    """Đoạn tường: (bin, vc, t, u0, u1) — gộp các mảnh thẳng hàng cùng độ dày."""
    by = defaultdict(list)
    for b, va, vb, u0, u1, *_ in pairs:
        by[b].append(((va + vb) / 2, vb - va, u0, u1))
    out = []
    for b, ps in by.items():
        for cl in cluster(ps, key=lambda p: p[0], tol=0.015):
            # trong một hàng: nối các mảnh chồng / sát nhau cùng độ dày
            cl.sort(key=lambda p: p[2])
            cur = []
            for vc, t, u0, u1 in cl:
                hit = next((c for c in cur if abs(c[2] - t) < 0.025 and u0 <= c[4] + 0.03), None)
                if hit:
                    hit[4] = max(hit[4], u1)
                else:
                    cur.append([b, vc, t, u0, u1])
            out += [tuple(c) for c in cur]
    return out


def drop_shadowed(pieces):
    """Bỏ mảnh mỏng nằm sát / chồng lên một mảnh dày hơn song song (viền thiết bị dính vào tường)."""
    by = defaultdict(list)
    for p in pieces:
        by[p[0]].append(p)
    out = []
    for b, ps in by.items():
        ps.sort(key=lambda p: p[1])
        vs = [p[1] for p in ps]
        for p in ps:
            L = p[4] - p[3]
            hidden = False
            lo = bisect_left(vs, p[1] - T_MAX - 0.05)
            hi = bisect_right(vs, p[1] + T_MAX + 0.05)
            for q in ps[lo:hi]:
                if q is p or q[2] <= p[2]:
                    continue
                if abs(q[1] - p[1]) > (q[2] + p[2]) / 2 + 0.02:
                    continue
                ov = min(p[4], q[4]) - max(p[3], q[3])
                if ov >= 0.7 * L:
                    hidden = True
                    break
            if not hidden:
                out.append(p)
    return out


def cluster(items, key, tol):
    """Gom phần tử có `key` liên tiếp chênh nhau < tol."""
    items = sorted(items, key=key)
    groups = []
    for it in items:
        if groups and key(it) - key(groups[-1][-1]) < tol:
            groups[-1].append(it)
        else:
            groups.append([it])
    return groups


def door_arcs(cpts, hinge, ux, uy, nx, ny, vc, t, leaf, span):
    """Số điểm cung nằm cách bản lề ≈ chiều rộng cánh, ở một phía tường, trong khoảng ô cửa."""
    import numpy as np

    if not len(cpts):
        return 0
    u = cpts[:, 0] * ux + cpts[:, 1] * uy
    v = cpts[:, 0] * nx + cpts[:, 1] * ny
    dist = np.hypot(u - hinge, v - vc)
    best = 0
    for side in (1, -1):
        m = (
            (u > span[0] - 0.05)
            & (u < span[1] + 0.05)
            & ((v - vc) * side > t / 2 + 0.03)
            & (np.abs(dist - leaf) < 0.08 + 0.12 * leaf)
        )
        if not m.any():
            continue
        # cung phải quét từ gần dọc tường tới gần vuông góc với tường
        ang = np.degrees(np.arctan2(np.abs(v[m] - vc), np.abs(u[m] - hinge)))
        if ang.min() < 35 and ang.max() > 55:
            best = max(best, int(m.sum()))
    return best


def find_doors(pieces, curves):
    """Ghép các đoạn thẳng hàng có khe 0,6–2,6 m mà có cung cánh cửa → một tường + cửa."""
    import numpy as np

    cpts = np.array(curves) if curves else np.zeros((0, 2))
    pieces = [p for p in pieces if p[4] - p[3] >= 0.2]  # bỏ khung cửa, nét vụn
    by = defaultdict(list)
    for p in pieces:
        by[p[0]].append(list(p))
    walls = []
    for b, ps in by.items():
        bb = math.radians(b)
        ux, uy = math.cos(bb), math.sin(bb)
        nx, ny = -uy, ux
        for cl in cluster(ps, key=lambda p: p[1], tol=0.03):
            cl.sort(key=lambda p: p[3])
            groups = [[cl[0]]]
            for p in cl[1:]:
                prev = groups[-1][-1]
                gap = p[3] - prev[4]
                door = None
                if DOOR_MIN <= gap <= DOOR_MAX and abs(p[2] - prev[2]) < 0.06:
                    vc = (p[1] + prev[1]) / 2
                    t = max(p[2], prev[2])
                    a, c = prev[4], p[3]
                    single = max(
                        door_arcs(cpts, a, ux, uy, nx, ny, vc, t, gap, (a, c)),
                        door_arcs(cpts, c, ux, uy, nx, ny, vc, t, gap, (a, c)),
                    )
                    d0 = door_arcs(cpts, a, ux, uy, nx, ny, vc, t, gap / 2, (a, a + gap / 2))
                    d1 = door_arcs(cpts, c, ux, uy, nx, ny, vc, t, gap / 2, (c - gap / 2, c))
                    if gap >= 1.0 and d0 >= 2 and d1 >= 2:
                        door = 'double'
                    elif single >= 3:
                        door = 'single'
                if door:
                    groups[-1].append(('door', prev[4], p[3], door))
                    groups[-1].append(p)
                else:
                    groups.append([p])
            for g in groups:
                parts = [x for x in g if isinstance(x, list)]
                w = dict(bin=b, v=parts[0][1], t=max(x[2] for x in parts), u0=parts[0][3], u1=parts[-1][4],
                         doors=[x[1:] for x in g if isinstance(x, tuple)])
                walls.append(w)
    return walls


def drop_stubs(walls):
    """Bỏ mẩu tường ngắn (< 0,6 m) đứng riêng — ký hiệu ổ mạng, lavabo, chữ…"""
    def ends(w):
        bb = math.radians(w['bin'])
        ux, uy = math.cos(bb), math.sin(bb)
        nx, ny = -uy, ux
        return [(w['u0'] * ux + w['v'] * nx, w['u0'] * uy + w['v'] * ny),
                (w['u1'] * ux + w['v'] * nx, w['u1'] * uy + w['v'] * ny)]

    E = [ends(w) for w in walls]
    long_ = [w['u1'] - w['u0'] >= 0.6 or bool(w['doors']) for w in walls]

    def near(p, j):
        (ax, ay), (bx, by_) = E[j]
        dx, dy = bx - ax, by_ - ay
        L2 = dx * dx + dy * dy or 1e-9
        t = max(0, min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2))
        return math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy) <= walls[j]['t'] / 2 + 0.12

    grid = defaultdict(list)
    for j, e in enumerate(E):
        if not long_[j]:
            continue
        (ax, ay), (bx, by_) = e
        n = max(1, int(math.hypot(bx - ax, by_ - ay) // 1.0))
        for k in range(n + 1):
            grid[(int((ax + (bx - ax) * k / n) // 2), int((ay + (by_ - ay) * k / n) // 2))].append(j)
    keep = []
    for i, w in enumerate(walls):
        L = w['u1'] - w['u0']
        if long_[i]:
            keep.append(w)
            continue
        if abs(L - w['t']) < 0.12:  # ô vuông nhỏ (ký hiệu ổ mạng…), không phải tường
            continue
        cand = set()
        for p in E[i]:
            for gx in range(int(p[0] // 2) - 1, int(p[0] // 2) + 2):
                for gy in range(int(p[1] // 2) - 1, int(p[1] // 2) + 2):
                    cand.update(grid[(gx, gy)])
        if any(j != i and near(p, j) for p in E[i] for j in cand):
            keep.append(w)
    return keep


def drop_dimension_lines(walls, page, scale):
    """Bỏ "tường" là đường ghi kích thước (có số đo ngay cạnh, song song)."""
    import re

    boxes = []
    for w in page.get_text('words'):
        if re.fullmatch(r'\d{3,6}', w[4]):
            boxes.append((w[0] * scale - 0.2, w[1] * scale - 0.2, w[2] * scale + 0.2, w[3] * scale + 0.2))
    keep = []
    for w in walls:
        bb = math.radians(w['bin'])
        ux, uy = math.cos(bb), math.sin(bb)
        nx, ny = -uy, ux
        hit = False
        for x0, y0, x1, y1 in boxes:
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            u = cx * ux + cy * uy
            v = cx * nx + cy * ny
            half = max(x1 - x0, y1 - y0) / 2
            if w['u0'] - 0.1 <= u <= w['u1'] + 0.1 and abs(v - w['v']) <= half:
                hit = True
                break
        if not hit:
            keep.append(w)
    return keep


def columns(fills, circles=()):
    out = []
    for r in circles:  # cột tròn trong ô vuông: ô vuông bao ≈ 1,15 × đường kính
        out.append(((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, r.width * 1.15, r.height * 1.15))
    for r in fills:
        w, h = r.width, r.height
        # ô chữ nhật nhỏ 0,3 × 0,22 m là ký hiệu ổ mạng, không phải cột
        if max(w, h) <= 0.31 and abs(w - h) > 0.05:
            continue
        if 0.18 <= w <= 1.3 and 0.18 <= h <= 1.3 and max(w, h) / min(w, h) < 2.5:
            out.append(((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, w, h))
    # bỏ trùng
    out.sort()
    uniq = []
    for c in out:
        if not any(abs(c[0] - d[0]) < 0.1 and abs(c[1] - d[1]) < 0.1 for d in uniq[-20:]):
            uniq.append(c)
    return uniq


def close_windows(walls, lines):
    """Nối hai đoạn tường thẳng hàng cùng độ dày khi khe giữa chúng là cửa sổ: ≥ 2 nét song song
    nằm trong bề dày tường phủ gần hết khe (khung kính vẽ 2–4 nét — bị `drop_series` bỏ nên tường
    đứt đoạn). Khe không có nét (lối đi, chỗ giao tường) giữ nguyên. Ghi `windows` = [(u0, u1)]."""
    rows = defaultdict(list)
    for w in walls:
        w.setdefault('windows', [])
        if not w.get('kind'):
            rows[w['bin']].append(w)
    gone = set()
    n = 0
    for b, ws in rows.items():
        ls = lines.get(b, [])
        vs = [l.v for l in ls]
        for row in cluster(ws, key=lambda w: w['v'], tol=0.04):
            row.sort(key=lambda w: w['u0'])
            cur = row[0]
            for w in row[1:]:
                g0, g1 = cur['u1'], w['u0']
                gap = g1 - g0
                t = max(cur['t'], w['t'])
                ok = 0.2 <= gap <= 6.0 and abs(cur['t'] - w['t']) <= max(0.05, 0.35 * t)
                if ok:
                    vc = (cur['v'] + w['v']) / 2
                    lo = bisect_left(vs, vc - t / 2 - 0.04)
                    hi = bisect_right(vs, vc + t / 2 + 0.04)
                    rows_v = set()
                    for l in ls[lo:hi]:
                        if min(l.u1, g1) - max(l.u0, g0) >= 0.85 * gap:
                            rows_v.add(round(l.v / 0.01))
                    ok = len(rows_v) >= 2
                if ok:
                    cur['u1'] = max(cur['u1'], w['u1'])
                    cur['doors'] += w['doors']
                    cur['windows'] += [(g0, g1)] + w['windows']
                    cur['v'] = (cur['v'] * cur['t'] + w['v'] * w['t']) / (cur['t'] + w['t'])
                    gone.add(id(w))
                    n += 1
                else:
                    cur = w
    return [w for w in walls if id(w) not in gone], n


def extend_ends(walls):
    """Kéo đầu tường tới tâm tường vuông góc gần đó (góc chữ L / T)."""
    def pts(w):
        b = math.radians(w['bin'])
        ux, uy = math.cos(b), math.sin(b)
        nx, ny = -uy, ux
        return (w['u0'] * ux + w['v'] * nx, w['u0'] * uy + w['v'] * ny), (w['u1'] * ux + w['v'] * nx, w['u1'] * uy + w['v'] * ny), (ux, uy)

    geo = [pts(w) for w in walls]
    # chỉ số theo ô lưới
    grid = defaultdict(list)
    for i, (a, b, _) in enumerate(geo):
        for x, y in (a, b):
            grid[(int(x // 2), int(y // 2))].append(i)
        # điểm giữa cho tường dài
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        n = int(L // 1.5)
        for k in range(1, n + 1):
            x = a[0] + (b[0] - a[0]) * k / (n + 1)
            y = a[1] + (b[1] - a[1]) * k / (n + 1)
            grid[(int(x // 2), int(y // 2))].append(i)
    for i, w in enumerate(walls):
        a, b, (ux, uy) = geo[i]
        for end in (0, 1):
            p = a if end == 0 else b
            sgn = -1 if end == 0 else 1
            best = None
            cands = set()
            for gx in range(int(p[0] // 2) - 1, int(p[0] // 2) + 2):
                for gy in range(int(p[1] // 2) - 1, int(p[1] // 2) + 2):
                    cands.update(grid[(gx, gy)])
            for j in cands:
                if j == i:
                    continue
                c, d, (vx, vy) = geo[j]
                cross = ux * vy - uy * vx
                if abs(cross) < 0.5:  # gần song song
                    continue
                # giao của đường tường i với tâm tường j
                t = ((c[0] - p[0]) * vy - (c[1] - p[1]) * vx) / cross
                s = ((c[0] - p[0]) * uy - (c[1] - p[1]) * ux) / cross
                Lj = math.hypot(d[0] - c[0], d[1] - c[1])
                tj = walls[j]['t']
                ext = t * sgn
                if -0.01 <= ext <= tj / 2 + 0.08 and -w['t'] / 2 - 0.08 <= s <= Lj + w['t'] / 2 + 0.08:
                    if best is None or ext < best:
                        best = ext
            if best is not None and best > 0:
                if end == 0:
                    w['u0'] -= best
                else:
                    w['u1'] += best


def main():
    res = json.load(open(sys.argv[1], encoding='utf-8'))
    params = json.load(open(sys.argv[2], encoding='utf-8'))
    out_dir = sys.argv[3]
    only = {int(x) for x in sys.argv[4:]}
    scales = {int(k): v for k, v in params['scales'].items()}
    doc = fitz.open(PDF)
    for bid, b in res['buildings'].items():
        for f in b['floors']:
            pi = f['page']
            if only and pi not in only:
                continue
            page = doc[pi]
            s = scales[pi]
            # tiêu đề = chữ to nhất
            title = max(((sp['size'], fitz.Rect(l['bbox'])) for bl in page.get_text('dict')['blocks']
                         for l in bl.get('lines', []) for sp in l['spans']), key=lambda x: x[0])[1]
            segs, curves, fills, circles, dots, quads = page_segments(page, s, title)
            # vòng tròn có chữ bên trong là ký hiệu trục, không phải cột
            words = [fitz.Rect(w[:4]) for w in page.get_text('words')]
            circles = [c for c in circles
                       if not any(fitz.Rect(c.x0 / s, c.y0 / s, c.x1 / s, c.y1 / s).intersects(wr) for wr in words)]
            lines = to_lines(segs)

            # thang bộ / thang cuốn / thang máy / dốc
            conns = F.stairs_and_escalators(F.tread_flights(lines))
            xb = F.x_boxes(segs)
            elev, other_x = F.elevators(lines, xb, quads)
            conns += elev
            bounds = (min(min(x0, x1) for x0, y0, x1, y1 in segs), min(min(y0, y1) for x0, y0, x1, y1 in segs),
                      max(max(x0, x1) for x0, y0, x1, y1 in segs), max(max(y0, y1) for x0, y0, x1, y1 in segs))
            conns += F.ramps(segs, bounds)
            polys = [np.array(p, np.float32).reshape(-1, 1, 2) for _, p in conns]

            def in_conn(pt, margin=0.15):
                return any(cv2.pointPolygonTest(pg, (float(pt[0]), float(pt[1])), True) >= margin for pg in polys)

            pairs = find_pairs(lines)
            n_pairs = len(pairs)
            pairs = drop_series(pairs)
            pieces = drop_shadowed(pieces_from_pairs(pairs))
            walls = find_doors(pieces, curves)
            walls = [w for w in walls if w['u1'] - w['u0'] >= 0.25]
            walls = drop_stubs(walls)
            walls = drop_dimension_lines(walls, page, s)
            for w in walls:
                w.setdefault('kind', 0)

            # vách nét đơn có chấm (không trùng mặt tường đã có)
            by_bin = defaultdict(list)
            for w in walls:
                by_bin[w['bin']].append(w)

            def taken(b_, v, u0, u1):
                for w in by_bin.get(b_, []):
                    if abs(w['v'] - v) <= w['t'] / 2 + 0.03:
                        ov = min(u1, w['u1']) - max(u0, w['u0'])
                        if ov >= 0.5 * (u1 - u0):
                            return True
                return False

            parts = F.dotted_partitions(lines, dots, taken)
            parts = [q for q in parts if not in_conn(F.to_xy(q[0], (q[2] + q[3]) / 2, q[1]), -0.3)]
            for b_, v, u0, u1 in parts:
                walls.append(dict(bin=b_, v=v, t=0.1, u0=u0, u1=u1, doors=[], kind=1))

            # bỏ tường nằm trong thang / dốc (vạch bậc, nét gạch chéo)
            def endpoints(w):
                return [F.to_xy(w['bin'], w['u0'], w['v']), F.to_xy(w['bin'], w['u1'], w['v']),
                        F.to_xy(w['bin'], (w['u0'] + w['u1']) / 2, w['v'])]

            walls = [w for w in walls if not all(in_conn(p_) for p_ in endpoints(w))]
            walls, n_win = close_windows(walls, lines)

            extend_ends(walls)
            cols = columns(fills, circles) + F.hatched_columns(segs, quads)
            cols = [c for c in cols if not in_conn((c[0], c[1]), 0.0)]
            # hệ trục toà: (m trên trang) - góc cắt + offset tầng
            ox = -f['crop'][0] * s + f['offset'][0]
            oy = -f['crop'][1] * s + f['offset'][1]
            W, O, G = [], [], []
            for w in walls:
                bb = math.radians(w['bin'])
                ux, uy = math.cos(bb), math.sin(bb)
                nx, ny = -uy, ux
                x0 = w['u0'] * ux + w['v'] * nx + ox
                y0 = w['u0'] * uy + w['v'] * ny + oy
                x1 = w['u1'] * ux + w['v'] * nx + ox
                y1 = w['u1'] * uy + w['v'] * ny + oy
                row = [round(x0, 3), round(y0, 3), round(x1, 3), round(y1, 3), round(w['t'], 3)]
                if w['kind']:
                    row.append(w['kind'])
                W.append(row)
                for d0, d1, style in w['doors']:
                    O.append([len(W) - 1, round((d0 + d1) / 2 - w['u0'], 3), round(d1 - d0, 3),
                              1 if style == 'double' else 0])
                for g0, g1 in w.get('windows', []):
                    G.append([len(W) - 1, round((g0 + g1) / 2 - w['u0'], 3), round(g1 - g0, 3)])
            C = [[round(cx + ox, 3), round(cy + oy, 3), round(cw, 3), round(ch, 3)] for cx, cy, cw, ch in cols]
            K = [{'t': k, 'p': [[round(x + ox, 2), round(y + oy, 2)] for x, y in p]} for k, p in conns]
            name = f['file'][:-4]
            json.dump({'walls': W, 'doors': O, 'windows': G, 'columns': C, 'connectors': K},
                      open(f'{out_dir}/{name}.json', 'w'), separators=(',', ':'))
            kinds = defaultdict(int)
            for k, _ in conns:
                kinds[k] += 1
            print(name, 'segs', len(segs), 'pairs', n_pairs, '->', len(pairs), 'walls', len(W), 'partitions', len(parts),
                  'doors', len(O), 'windows', n_win, 'columns', len(C), dict(kinds), flush=True)

if __name__ == '__main__':
    main()
