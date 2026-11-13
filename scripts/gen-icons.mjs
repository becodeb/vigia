// Draws the vigia eye icon as PNG using only Node built-ins. Usage: node scripts/gen-icons.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';

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
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};

function render(size) {
  const BG = [15, 23, 42], EYE = [34, 197, 94], PUPIL = [15, 23, 42], WHITE = [226, 232, 240];
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 3;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const u = ((x + (sx + 0.5) / SS) / size - 0.5) * 2; // -1..1
        const v = ((y + (sy + 0.5) / SS) / size - 0.5) * 2;
        let c = BG;
        // eye: lens shape between two arcs |v| < 0.5*(1-u^2/0.64)
        const w = 0.8;
        const lens = Math.abs(u) < w && Math.abs(v) < 0.5 * (1 - (u * u) / (w * w));
        const lensOuter = Math.abs(u) < w + 0.08 && Math.abs(v) < 0.5 * (1 - (u * u) / ((w + 0.08) ** 2)) + 0.08;
        if (lensOuter) c = EYE;
        if (lens) c = WHITE;
        const d = Math.hypot(u, v);
        if (lens && d < 0.36) c = EYE;
        if (lens && d < 0.17) c = PUPIL;
        r += c[0]; g += c[1]; b += c[2];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r / (SS * SS); raw[o + 1] = g / (SS * SS); raw[o + 2] = b / (SS * SS); raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const s of [192, 512]) {
  fs.writeFileSync(new URL(`../server/public/icon-${s}.png`, import.meta.url), render(s));
}
console.log('icons written');
