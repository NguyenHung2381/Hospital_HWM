"""Write the generated PLAN_BUILDINGS block into lanPlans.ts from result.json."""
import json, sys, re

res = json.load(open(sys.argv[1], encoding='utf-8'))
ts_path = sys.argv[2]

META = {
    'bld_lan_main': ('Nhà chính – khối khám & điều trị', {
        'nha-chinh-ban-am': ('ban-am', 'Tầng bán âm', -1, -3.0, 3.0),
        'nha-chinh-t1': ('t1', 'Tầng 1', 0, 0, 4.5),
        'nha-chinh-t2': ('t2', 'Tầng 2', 1, 4.5, 4.5),
        'nha-chinh-t3': ('t3', 'Tầng 3', 2, 9.0, 3.6),
        'nha-chinh-t4': ('t4', 'Tầng 4', 3, 12.6, 3.6),
        'nha-chinh-t5': ('t5', 'Tầng 5', 4, 16.2, 3.6),
        'nha-chinh-t6': ('t6', 'Tầng 6', 5, 19.8, 3.6),
        'nha-chinh-t7': ('t7', 'Tầng 7', 6, 23.4, 3.6),
    }),
    'bld_lan_cnk': ('Khoa Chống nhiễm khuẩn', {'khoa-chong-nhiem-khuan': ('t1', 'Tầng 1', 0, 0, 4.2)}),
    'bld_lan_dd': ('Khoa Dinh dưỡng', {'khoa-dinh-duong': ('t1', 'Tầng 1', 0, 0, 4.2)}),
    'bld_lan_gpbl': ('Khoa Giải phẫu bệnh lý', {'khoa-giai-phau-benh': ('t1', 'Tầng 1', 0, 0, 4.2)}),
    'bld_lan_lay': ('Khoa Lây (Truyền nhiễm)', {
        'khoa-lay-t1': ('t1', 'Tầng 1', 0, 0, 3.6),
        'khoa-lay-t2': ('t2', 'Tầng 2', 1, 3.6, 3.6),
    }),
}

r2 = lambda v: round(v, 2)
lines = ['const PLAN_BUILDINGS: PlanBuilding[] = [']
for bid, b in res['buildings'].items():
    name, floors = META[bid]
    x, y = b['position']
    lines.append('  {')
    lines.append(f"    id: '{bid}',")
    lines.append(f"    name: '{name}',")
    lines.append(f"    placement: {{ position: {{ x: {r2(x)}, y: {r2(y)} }}, rotation: {b['rotation']} }},")
    lines.append('    floors: [')
    rows = []
    for f in b['floors']:
        stem = f['file'][:-4]
        key, fname, level, elev, h = floors[stem]
        rows.append((level, f"      {{ key: '{key}', name: '{fname}', level: {level}, elevation: {elev}, height: {h}, "
                            f"image: '{f['file']}', metersPerPixel: {round(f['mpp'], 6)}, "
                            f"offset: {{ x: {r2(f['offset'][0])}, y: {r2(f['offset'][1])} }} }},"))
    lines += [r for _, r in sorted(rows)]
    lines.append('    ],')
    lines.append('  },')
lines.append('];')
ov = res['overview']
lines.append(f"const OVERVIEW = {{ image: '{ov['file']}', metersPerPixel: {round(ov['mpp'], 6)} }};")
block = '\n'.join(lines)

ts = open(ts_path, encoding='utf-8').read()
ts = re.sub(r'(// @generated-plans-start\n).*?(\n// @generated-plans-end)', lambda m: m.group(1) + block + m.group(2), ts, flags=re.S)
open(ts_path, 'w', encoding='utf-8', newline='').write(ts)
print(block)
