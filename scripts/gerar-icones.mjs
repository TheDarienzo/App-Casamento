// Gera os ícones PNG do PWA (anéis entrelaçados sobre fundo verde) sem dependências.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const smooth = (edge, x) => Math.max(0, Math.min(1, (edge - x) / 1.5 + 0.5));
const lerp = (a, b, t) => a + (b - a) * t;

function draw(S, { rounded }) {
  const img = Buffer.alloc(S * S * 4);
  const bgA = [0x33, 0x40, 0x2c], bgB = [0x24, 0x30, 0x1f];
  const gold = [0xd4, 0xb4, 0x6a], blush = [0xf0, 0xde, 0xd9];
  const R = rounded ? 0.219 * S : 0;
  const ring = 0.205 * S, stroke = 0.0215 * S;
  const c1 = [0.402 * S, 0.565 * S], c2 = [0.598 * S, 0.565 * S];

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5, py = y + 0.5;
      // máscara do retângulo arredondado
      let alpha = 1;
      if (R > 0) {
        const dx = Math.max(R - px, px - (S - R), 0);
        const dy = Math.max(R - py, py - (S - R), 0);
        alpha = smooth(R, Math.hypot(dx, dy));
      }
      if (alpha <= 0) continue;

      const t = (px + py) / (2 * S);
      let r = lerp(bgA[0], bgB[0], t), g = lerp(bgA[1], bgB[1], t), b = lerp(bgA[2], bgB[2], t);

      // anéis (distância até a circunferência)
      for (const [c, col] of [[c1, gold], [c2, blush]]) {
        const d = Math.abs(Math.hypot(px - c[0], py - c[1]) - ring);
        const a = smooth(stroke, d);
        if (a > 0) { r = lerp(r, col[0], a); g = lerp(g, col[1], a); b = lerp(b, col[2], a); }
      }

      const i = (y * S + x) * 4;
      img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = Math.round(alpha * 255);
    }
  }
  return png(S, S, img);
}

mkdirSync("icons", { recursive: true });
writeFileSync("icons/icon-192.png", draw(192, { rounded: true }));
writeFileSync("icons/icon-512.png", draw(512, { rounded: true }));
writeFileSync("icons/icon-maskable-512.png", draw(512, { rounded: false }));
console.log("ícones gerados");
