"""Đóng gói JSON do walls.py sinh ra vào packages/map-core/src/sample/plans/ (làm tròn, lọc ký hiệu).

usage: python pack.py <thư mục JSON từ walls.py> <packages/map-core/src/sample/plans>
"""
import json
import os
import sys

src, dst = sys.argv[1], sys.argv[2]


def _cross(o, a, b):
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def self_intersecting(p):
    n = len(p)
    for i in range(n):
        a, b = p[i], p[(i + 1) % n]
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            c, d = p[j], p[(j + 1) % n]
            # chạm nhau cũng tính (map-core coi là tự cắt)
            if (_cross(a, b, c) * _cross(a, b, d) <= 0) and (_cross(c, d, a) * _cross(c, d, b) <= 0):
                return True
    return False


def hull(p):
    pts = sorted(set(map(tuple, p)))
    lower, upper = [], []
    for q in pts:
        while len(lower) >= 2 and _cross(lower[-2], lower[-1], q) <= 0:
            lower.pop()
        lower.append(q)
    for q in reversed(pts):
        while len(upper) >= 2 and _cross(upper[-2], upper[-1], q) <= 0:
            upper.pop()
        upper.append(q)
    return [list(q) for q in lower[:-1] + upper[:-1]]


def clean_poly(p):
    """Đa giác tự cắt (đường bao vùng cong sau khi đơn giản hoá) → bao lồi."""
    q = [x for i, x in enumerate(p) if x != p[i - 1]]  # bỏ điểm trùng liền nhau (sau khi làm tròn)
    return hull(q) if self_intersecting(q) else q


def r2(a):
    return [round(x, 2) if isinstance(x, float) else x for x in a]


for name in sorted(os.listdir(src)):
    if not name.endswith('.json'):
        continue
    d = json.load(open(os.path.join(src, name)))
    # ô chữ nhật nhỏ 0,3 × 0,22 m là ký hiệu ổ mạng, không phải cột
    cols = [c for c in d['columns'] if not (max(c[2], c[3]) <= 0.31 and abs(c[2] - c[3]) > 0.05)]
    out = {
        'walls': [r2(w) for w in d['walls']],
        'doors': [r2(o) for o in d['doors']],
        'windows': [r2(o) for o in d.get('windows', [])],
        'columns': [r2(c) for c in cols],
        'connectors': [{'t': c['t'], 'p': clean_poly([r2(p) for p in c['p']])} for c in d.get('connectors', [])],
    }
    s = json.dumps(out, separators=(',', ':'))
    open(os.path.join(dst, name), 'w').write(s)
    print(f"{name:32s} walls {len(out['walls']):5d} doors {len(out['doors']):4d} "
          f"windows {len(out['windows']):4d} columns {len(out['columns']):4d} connectors {len(out['connectors']):3d} {len(s) // 1024} KB")
