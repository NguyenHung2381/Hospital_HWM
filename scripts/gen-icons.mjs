// Sinh icon PNG cho PWA (không cần thư viện ngoài): nền xanh bo góc + ghim vị trí trắng.
// Chạy: node scripts/gen-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [15, 118, 110]; // #0f766e
const FG = [255, 255, 255];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Độ phủ (0..1) của hình tại điểm (x, y) trong hệ toạ độ 0..1 — lấy mẫu 4x4 để khử răng cưa. */
function coverage(inside, px, py, size) {
  let hit = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (inside((px + (i + 0.5) / 4) / size, (py + (j + 0.5) / 4) / size)) hit++;
    }
  }
  return hit / 16;
}

function render(size, { maskable }) {
  // Icon maskable cần chừa vùng an toàn (hình nằm trong 80% ở giữa) và nền phủ kín.
  const radius = maskable ? 0 : 0.22;
  const k = maskable ? 0.72 : 1;
  const bg = (x, y) => {
    const r = radius;
    const cx = Math.min(Math.max(x, r), 1 - r);
    const cy = Math.min(Math.max(y, r), 1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  // Ghim: hình tròn + mũi nhọn phía dưới, có lỗ tròn ở giữa.
  const pin = (x, y) => {
    const u = (x - 0.5) / k + 0.5;
    const v = (y - 0.5) / k + 0.5;
    const cx = 0.5;
    const cy = 0.42;
    const R = 0.22;
    const inHead = (u - cx) ** 2 + (v - cy) ** 2 <= R * R;
    const tipY = 0.82;
    const t = (v - cy) / (tipY - cy);
    const inTail = v >= cy && v <= tipY && Math.abs(u - cx) <= R * (1 - t) * 0.92;
    const inHole = (u - cx) ** 2 + (v - cy) ** 2 <= (R * 0.42) ** 2;
    return (inHead || inTail) && !inHole;
  };

  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = coverage(bg, x, y, size);
      const f = coverage(pin, x, y, size);
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(BG[c] * (1 - f) + FG[c] * f);
      rgba[i + 3] = Math.round(255 * a);
    }
  }
  return encodePng(size, rgba);
}

const out = 'apps/user/public/icons';
mkdirSync(out, { recursive: true });
for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
]) {
  writeFileSync(`${out}/${name}`, render(size, { maskable }));
  console.log(`✓ ${out}/${name}`);
}
