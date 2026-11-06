"""Register PDF pages against each other (scale / rotation / translation) by FFT cross-correlation."""
import os

import numpy as np
import pymupdf as fitz

# Bộ bản vẽ: biến môi trường HWN_PLANS_PDF, mặc định trong thư mục Downloads.
PDF = os.environ.get('HWN_PLANS_PDF') or os.path.expanduser(
    os.path.join('~', 'Downloads', 'HE THONG LAN - MAT BANG KHONG DAY.pdf'))
doc = fitz.open(PDF)

SCALES = {0: 0.05447, 1: 0.0827, 2: 0.08075, 3: 0.08009, 4: 0.08021, 5: 0.05203, 6: 0.05203,
          7: 0.05203, 10: 0.03088}


def title_rect(pi):
    p = doc[pi]
    best = None
    for b in p.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                if best is None or s['size'] > best[0]:
                    best = (s['size'], fitz.Rect(l['bbox']))
    return best[1]


def content_rect(pi):
    """Bounding box of everything drawn except the title."""
    p = doc[pi]
    t = title_rect(pi)
    r = fitz.Rect()
    for dr in p.get_drawings():
        rr = dr['rect']
        if rr.width > 0.9 * p.rect.width or rr.height > 0.9 * p.rect.height:
            continue  # matplotlib figure background
        if rr.intersects(t) and rr.y0 > t.y0 - 5:
            continue
        r |= rr
    for b in p.get_text('dict')['blocks']:
        bb = fitz.Rect(b['bbox'])
        if bb.intersects(t):
            continue
        r |= bb
    return r & p.rect


def ink(pi, zoom, clip=None):
    p = doc[pi]
    clip = clip or p.rect
    pm = p.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip, colorspace=fitz.csGRAY, alpha=False)
    a = np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.h, pm.stride)[:, : pm.w]
    a = 1.0 - a.astype(np.float32) / 255.0
    t = title_rect(pi)
    x0 = int((t.x0 - clip.x0) * zoom); x1 = int((t.x1 - clip.x0) * zoom) + 1
    y0 = int((t.y0 - clip.y0) * zoom); y1 = int((t.y1 - clip.y0) * zoom) + 1
    a[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = 0
    return a


def blur(a, r=2):
    # separable box blur
    k = 2 * r + 1
    c = np.cumsum(np.pad(a, ((0, 0), (r + 1, r))), axis=1)
    a = (c[:, k:] - c[:, :-k]) / k
    c = np.cumsum(np.pad(a, ((r + 1, r), (0, 0))), axis=0)
    return (c[k:, :] - c[:-k, :]) / k


def correlate(A, B):
    """Best shift (dy, dx) such that B placed at (dy, dx) in A's frame overlaps best. Returns score, dy, dx."""
    H = A.shape[0] + B.shape[0]
    W = A.shape[1] + B.shape[1]
    FA = np.fft.rfft2(A, (H, W))
    FB = np.fft.rfft2(B, (H, W))
    C = np.fft.irfft2(FA * np.conj(FB), (H, W))
    i = np.unravel_index(np.argmax(C), C.shape)
    dy, dx = i
    if dy > A.shape[0]:
        dy -= H
    if dx > A.shape[1]:
        dx -= W
    score = C[i] / (np.linalg.norm(A) * np.linalg.norm(B) + 1e-9)
    return float(score), int(dy), int(dx)


def register(target, src_pi, src_scale, mpp, rots=(0,), clip=None, r=2):
    """target: blurred ink array at `mpp` m/px. Returns best (score, rot, dy, dx, shape)."""
    zoom = src_scale / mpp
    B0 = ink(src_pi, zoom, clip)
    best = None
    for rot in rots:
        B = blur(np.rot90(B0, k=-rot // 90), r)  # rot clockwise degrees
        s, dy, dx = correlate(target, B)
        if best is None or s > best[0]:
            best = (s, rot, dy, dx, B.shape)
    return best
