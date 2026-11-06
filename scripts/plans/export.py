"""Export plan images + placement numbers.

usage: python export.py <scratch> <outdir> <params.json>
params.json: {"s_ov": .., "scales": {page: scale}, "place": {page: [rot]}}  (registration recomputed here)
"""
import sys, json
sys.path.insert(0, sys.argv[1])
from reg import *
from PIL import Image

OUT = sys.argv[2]
P = json.load(open(sys.argv[3]))
S_OV = P['s_ov']
SC = {int(k): v for k, v in P['scales'].items()}
ROT = {int(k): v for k, v in P['rot'].items()}

# building -> pages (first = reference floor registered against the overview)
BUILDINGS = P['buildings']

MAX_SIDE = 4096


def crop_of(pi):
    r = content_rect(pi)
    return fitz.Rect(r.x0 - 4, r.y0 - 4, r.x1 + 4, r.y1 + 4) & doc[pi].rect


def save_image(pi, name, scale):
    clip = crop_of(pi)
    w_m, h_m = clip.width * scale, clip.height * scale
    mpp = max(w_m, h_m) / MAX_SIDE
    mpp = max(mpp, 0.02)
    zoom = scale / mpp
    p = doc[pi]
    t = title_rect(pi)
    pm = p.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip, colorspace=fitz.csGRAY, alpha=False)
    img = Image.frombytes('L', (pm.w, pm.h), pm.samples)
    # blank the title if it falls inside the crop
    from PIL import ImageDraw
    dr = ImageDraw.Draw(img)
    dr.rectangle([(t.x0 - clip.x0) * zoom, (t.y0 - clip.y0) * zoom, (t.x1 - clip.x0) * zoom, (t.y1 - clip.y0) * zoom], fill=255)
    # 16-level grey palette keeps line art crisp and the PNG small
    img = img.quantize(colors=16, dither=Image.Dither.NONE)
    img.save(f'{OUT}/{name}.png', optimize=True)
    # metres per image pixel (the image is exactly clip*zoom, rounded)
    real_mpp = clip.width * scale / pm.w
    return dict(file=f'{name}.png', w=pm.w, h=pm.h, mpp=real_mpp, crop=[clip.x0, clip.y0, clip.x1, clip.y1])


result = {'buildings': {}}
ov_crop = crop_of(13)
result['overview'] = save_image(13, P['overview_name'], S_OV)

# overview target for placement (1 px = 1 pt)
T = blur(ink(13, 1.0), 2)

for bid, b in BUILDINGS.items():
    ref = b['pages'][0][0]
    rot = ROT[ref]
    ref_crop = crop_of(ref)
    zoom = SC[ref] / S_OV
    B = blur(np.rot90(ink(ref, zoom, ref_crop), k=-rot // 90), 2)
    sc, dy, dx = correlate(T, B)
    w_m, h_m = ref_crop.width * SC[ref], ref_crop.height * SC[ref]
    tl = np.array([(dx - ov_crop.x0) * S_OV, (dy - ov_crop.y0) * S_OV])
    corner = {0: (0, 0), 90: (h_m, 0), 180: (w_m, h_m), 270: (0, w_m)}[rot]
    pos = tl + np.array(corner)
    floors = []
    # floor registration vs reference floor at 0.2 m/px
    MPP = 0.2
    TR = blur(ink(ref, SC[ref] / MPP, ref_crop), 2)
    for pi, fname in b['pages']:
        info = save_image(pi, fname, SC[pi])
        if pi == ref:
            off = (0.0, 0.0); fs = 1.0
        else:
            c = crop_of(pi)
            BB = blur(ink(pi, SC[pi] / MPP, c), 2)
            fs, fdy, fdx = correlate(TR, BB)
            off = (fdx * MPP, fdy * MPP)
        info.update(page=pi, offset=off, score=fs)
        floors.append(info)
        print(bid, pi, fname, 'score', round(fs, 3), 'offset', off, 'size', info['w'], info['h'], 'mpp', round(info['mpp'], 4), flush=True)
    result['buildings'][bid] = dict(position=pos.tolist(), rotation=rot, score=sc, floors=floors)
    print(bid, 'placed', pos, 'rot', rot, 'score', round(sc, 3), flush=True)

json.dump(result, open(f'{OUT}/../result.json', 'w'), indent=1)
