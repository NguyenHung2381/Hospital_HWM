"""Nhận dạng thang bộ, thang cuốn, thang máy, dốc, vách nét đơn, cột gạch chéo, ô kỹ thuật (ô X).

Dùng chung đầu vào với walls.py: các nét đã gom theo hướng (`Line`: bin, v, u0, u1 — mét trên trang).
"""
import math
from collections import defaultdict

import cv2
import numpy as np

RASTER = 0.1  # m / px khi raster hoá vùng gạch chéo


def _uv(b):
    t = math.radians(b)
    ux, uy = math.cos(t), math.sin(t)
    return ux, uy, -uy, ux


def to_xy(b, u, v):
    ux, uy, nx, ny = _uv(b)
    return (u * ux + v * nx, u * uy + v * ny)


def rect_poly(b, u0, u1, v0, v1):
    return [to_xy(b, u0, v0), to_xy(b, u1, v0), to_xy(b, u1, v1), to_xy(b, u0, v1)]


# ---------------------------------------------------------------- thang bộ / thang cuốn


def tread_flights(lines):
    """Chuỗi ≥ 5 nét song song cách đều 0,18–0,45 m, dài gần bằng nhau → một vế thang.

    Trả về [(bin, u0, u1, v0, v1, số bậc)]."""
    flights = []
    for b, ls in lines.items():
        cand = [l for l in ls if 0.3 <= l.u1 - l.u0 <= 4.0]
        cand.sort(key=lambda l: l.v)
        vs = [l.v for l in cand]
        used = set()
        import bisect

        for i, a in enumerate(cand):
            if id(a) in used:
                continue
            chain = [a]
            step = None
            while True:
                cur = chain[-1]
                L = cur.u1 - cur.u0
                lo = bisect.bisect_left(vs, cur.v + 0.15)
                hi = bisect.bisect_right(vs, cur.v + 0.47)
                nxt = None
                for c in cand[lo:hi]:
                    Lc = c.u1 - c.u0
                    ov = min(cur.u1, c.u1) - max(cur.u0, c.u0)
                    if ov < 0.85 * max(L, Lc) or abs(Lc - L) > 0.15 * max(L, Lc) + 0.05:
                        continue
                    d = c.v - cur.v
                    if step is not None and abs(d - step) > 0.2 * step + 0.02:
                        continue
                    if nxt is None or d < nxt.v - cur.v:
                        nxt = c
                if nxt is None:
                    break
                step = nxt.v - cur.v if step is None else step
                chain.append(nxt)
            if len(chain) >= 5:
                for c in chain:
                    used.add(id(c))
                u0 = min(c.u0 for c in chain)
                u1 = max(c.u1 for c in chain)
                flights.append((b, u0, u1, chain[0].v, chain[-1].v, len(chain)))
    return flights


def stairs_and_escalators(flights):
    """Gộp các vế thang kề nhau (≤ 0,8 m) rồi phân loại: dải hẹp (≤ 1,7 m), dài (≥ 4,5 m), ≥ 15 bậc
    là thang cuốn; còn lại là thang bộ. Hai thang cuốn đặt song song cách nhau > 0,8 m nên không gộp."""
    items = [[b, u0, u1, v0, v1, n] for b, u0, u1, v0, v1, n in flights]

    def can_merge(a, c):
        if a[0] != c[0]:
            return False
        gap_u = max(a[1], c[1]) - min(a[2], c[2])
        gap_v = max(a[3], c[3]) - min(a[4], c[4])
        if gap_u > 0.8 or gap_v > 0.8:
            return False
        # vế nối tiếp theo chiều dài (cùng bề ngang) hoặc hai vế đặt cạnh nhau (thang 2 vế)
        same_width = abs(a[1] - c[1]) < 0.3 and abs(a[2] - c[2]) < 0.3
        side_by_side = gap_v < 0 and gap_u > -0.1
        return same_width or side_by_side

    merged = True
    while merged:
        merged = False
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                a, c = items[i], items[j]
                if can_merge(a, c):
                    items[i] = [a[0], min(a[1], c[1]), max(a[2], c[2]), min(a[3], c[3]), max(a[4], c[4]), a[5] + c[5]]
                    items.pop(j)
                    merged = True
                    break
            if merged:
                break
    out = []
    for b, u0, u1, v0, v1, n in items:
        width, run = u1 - u0, v1 - v0
        if width * run < 1.0:
            continue
        kind = 'escalator' if width <= 1.7 and run >= 4.5 and n >= 15 else 'stairs'
        out.append((kind, rect_poly(b, u0, u1, v0, v1)))
    return out


# ---------------------------------------------------------------- thang máy, ô X


def x_boxes(segs):
    """Hình chữ nhật có hai đường chéo: (x0, y0, x1, y1)."""
    diag = []
    for x0, y0, x1, y1 in segs:
        dx, dy = abs(x1 - x0), abs(y1 - y0)
        if dx < 0.25 or dy < 0.25:
            continue
        diag.append((min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1), (x1 - x0) * (y1 - y0) > 0))
    diag.sort()
    out = []
    import bisect

    xs = [d[0] for d in diag]
    for i, a in enumerate(diag):
        lo = bisect.bisect_left(xs, a[0] - 0.06)
        hi = bisect.bisect_right(xs, a[0] + 0.06)
        for c in diag[lo:hi]:
            if c is a or c[4] == a[4]:
                continue
            if all(abs(a[k] - c[k]) < 0.06 for k in range(4)):
                out.append(a[:4])
                break
    # bỏ trùng
    uniq = []
    for r in out:
        if not any(all(abs(r[k] - q[k]) < 0.1 for k in range(4)) for q in uniq):
            uniq.append(r)
    return uniq


def has_bar(r, quads):
    """Thanh đối trọng / ray: ô hẹp (≤ 0,35 m) song song một cạnh buồng, ngay bên ngoài (≤ 0,7 m)."""
    x0, y0, x1, y1 = r
    for qx0, qy0, qx1, qy1 in quads:
        qw, qh = qx1 - qx0, qy1 - qy0
        if qw <= 0.35 and qh >= 0.5 * (y1 - y0) and min(qy1, y1) - max(qy0, y0) >= 0.5 * (y1 - y0):
            if -0.7 <= x0 - qx1 <= 0.7 and qx1 <= x0 + 0.05 or -0.7 <= qx0 - x1 <= 0.7 and qx0 >= x1 - 0.05:
                return True
        if qh <= 0.35 and qw >= 0.5 * (x1 - x0) and min(qx1, x1) - max(qx0, x0) >= 0.5 * (x1 - x0):
            if -0.7 <= y0 - qy1 <= 0.7 and qy1 <= y0 + 0.05 or -0.7 <= qy0 - y1 <= 0.7 and qy0 >= y1 - 0.05:
                return True
    return False


def elevators(lines, xboxes, quads=()):
    """Buồng thang có dấu X (0,9–3 m) kèm thanh đối trọng bên cạnh, hoặc buồng chữ nhật có thanh
    đối trọng (≥ 2 nét sát nhau song song cạnh trên, ngay bên ngoài). Trả về (thang máy, ô X khác)."""
    out = []
    others = []
    for r in xboxes:
        x0, y0, x1, y1 = r
        w, h = x1 - x0, y1 - y0
        if 0.9 <= w <= 3.2 and 0.9 <= h <= 3.2 and has_bar(r, quads):
            out.append((x0 - 0.15, y0 - 0.15, x1 + 0.15, y1 + 0.15))
        else:
            others.append(r)
    # buồng không có dấu X: cạnh ngang trên/dưới + cạnh dọc trái/phải khép kín
    H = lines.get(0.0, [])
    V = lines.get(90.0, [])
    hv = sorted(H, key=lambda l: l.v)
    vx = [(-l.v, l.u0, l.u1) for l in V]  # bin 90: u = y, v = -x
    for i, top in enumerate(hv):
        w = top.u1 - top.u0
        if not 0.8 <= w <= 2.6:
            continue
        for bot in hv[i + 1:]:
            h = bot.v - top.v
            if h > 2.6:
                break
            if h < 0.8 or abs(bot.u0 - top.u0) > 0.12 or abs(bot.u1 - top.u1) > 0.12:
                continue
            left = any(abs(x - top.u0) < 0.08 and min(c, bot.v) - max(a, top.v) >= 0.75 * h for x, a, c in vx)
            right = any(abs(x - top.u1) < 0.08 and min(c, bot.v) - max(a, top.v) >= 0.75 * h for x, a, c in vx)
            if not (left and right):
                continue
            # thanh đối trọng: ≥ 2 nét ngang ngắn sát nhau (≤ 0,1 m) ngay trên cạnh trên
            bar = [l for l in hv if top.v - 0.3 < l.v < top.v - 0.01 and l.u0 >= top.u0 - 0.1 and l.u1 <= top.u1 + 0.1
                   and l.u1 - l.u0 >= 0.25 * w]
            if len(bar) >= 2 and max(l.v for l in bar) - min(l.v for l in bar) <= 0.16:
                out.append((top.u0 - 0.15, top.v - 0.35, top.u1 + 0.15, bot.v + 0.15))
    uniq = []
    for r in out:
        if not any(r[0] < q[2] and q[0] < r[2] and r[1] < q[3] and q[1] < r[3] for q in uniq):
            uniq.append(r)
    return [('elevator', [(r[0], r[1]), (r[2], r[1]), (r[2], r[3]), (r[0], r[3])]) for r in uniq], others


# ---------------------------------------------------------------- dốc (gạch chéo hình thoi)


def ramps(segs, bounds):
    """Vùng có nét chéo theo cả hai hướng đan nhau (gạch hình thoi) → dốc."""
    x0, y0, x1, y1 = bounds
    W = int((x1 - x0) / RASTER) + 2
    Hh = int((y1 - y0) / RASTER) + 2
    a = np.zeros((Hh, W), np.uint8)
    c = np.zeros((Hh, W), np.uint8)
    P = lambda x, y: (int((x - x0) / RASTER), int((y - y0) / RASTER))
    for sx0, sy0, sx1, sy1 in segs:
        dx, dy = sx1 - sx0, sy1 - sy0
        L = math.hypot(dx, dy)
        if L < 0.25:
            continue
        ang = math.degrees(math.atan2(dy, dx)) % 180
        if 25 <= ang <= 65:
            cv2.line(a, P(sx0, sy0), P(sx1, sy1), 1, 1)
        elif 115 <= ang <= 155:
            cv2.line(c, P(sx0, sy0), P(sx1, sy1), 1, 1)
    k = np.ones((5, 5), np.uint8)
    both = cv2.dilate(a, k) & cv2.dilate(c, k)
    both = cv2.morphologyEx(both, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(both)
    out = []
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA] * RASTER * RASTER
        if area < 4:
            continue
        m = (lab == i).astype(np.uint8)
        # mật độ: phải có nhiều nét chéo theo cả hai hướng
        if (a & m).sum() * RASTER < 6 or (c & m).sum() * RASTER < 6:
            continue
        cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cnt = max(cs, key=cv2.contourArea)
        if stats[i, cv2.CC_STAT_AREA] < 0.55 * max(cv2.contourArea(cnt), 1):
            continue  # vành mỏng (tường gạch chéo quanh phòng), không phải mặt dốc
        (_, _), (rw, rh), _ = cv2.minAreaRect(cnt)
        if min(rw, rh) * RASTER < 1.5:
            continue
        # bề rộng trung bình ≈ 2 × diện tích / chu vi: dải mỏng dọc tường (tường gạch chéo) bị loại
        if 2 * cv2.contourArea(cnt) / max(cv2.arcLength(cnt, True), 1) * RASTER < 1.0:
            continue
        approx = cv2.approxPolyDP(cnt, 0.25 / RASTER, True)  # pack.py thay đa giác tự cắt bằng bao lồi
        poly = [(x0 + (p[0][0] + 0.5) * RASTER, y0 + (p[0][1] + 0.5) * RASTER) for p in approx]
        if len(poly) >= 3:
            out.append(('ramp', poly))
    return out


# ---------------------------------------------------------------- vách nét đơn có chấm


def dotted_partitions(lines, dots, taken):
    """Nét đơn có chấm tròn đều dọc theo (≥ 2 chấm, trung bình ≤ 1,6 m / chấm) → vách.

    `taken`: hàm (bin, v, u0, u1) → True nếu đoạn đã là mặt của một bức tường (bỏ qua)."""
    if not dots:
        return []
    D = np.array(dots)
    out = []
    for b, ls in lines.items():
        ux, uy, nx, ny = _uv(b)
        du = D[:, 0] * ux + D[:, 1] * uy
        dv = D[:, 0] * nx + D[:, 1] * ny
        order = np.argsort(dv)
        dvs = dv[order]
        for l in ls:
            L = l.u1 - l.u0
            if L < 0.8:
                continue
            lo = np.searchsorted(dvs, l.v - 0.06)
            hi = np.searchsorted(dvs, l.v + 0.06)
            if hi - lo < 2:
                continue
            us = np.sort(du[order[lo:hi]])
            us = us[(us > l.u0 - 0.05) & (us < l.u1 + 0.05)]
            if len(us) < 2 or L / len(us) > 1.6:
                continue
            if taken(b, l.v, l.u0, l.u1):
                continue
            out.append((b, l.v, l.u0, l.u1))
    return out


# ---------------------------------------------------------------- cột gạch chéo


def hatched_columns(segs, quads):
    """Ô chữ nhật 0,2–0,9 m có ≥ 2 nét chéo song song bên trong → cột."""
    out = []
    if not quads:
        return out
    small = []
    for x0, y0, x1, y1 in segs:
        L = math.hypot(x1 - x0, y1 - y0)
        if 0.05 <= L <= 1.2 and abs(x1 - x0) > 0.03 and abs(y1 - y0) > 0.03:
            small.append(((x0 + x1) / 2, (y0 + y1) / 2))
    if not small:
        return out
    S = np.array(small)
    for qx0, qy0, qx1, qy1 in quads:
        w, h = qx1 - qx0, qy1 - qy0
        if not (0.2 <= w <= 0.9 and 0.2 <= h <= 0.9):
            continue
        inside = ((S[:, 0] > qx0) & (S[:, 0] < qx1) & (S[:, 1] > qy0) & (S[:, 1] < qy1)).sum()
        if inside >= 2:
            out.append(((qx0 + qx1) / 2, (qy0 + qy1) / 2, w, h))
    return out
