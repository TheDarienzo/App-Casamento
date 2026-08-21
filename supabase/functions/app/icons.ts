// Gera em memória os PNGs do ícone do app (anéis entrelaçados) — sem
// dependências: PNG montado à mão, deflate via CompressionStream.

async function deflate(dados: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([dados as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}

function crc32(buf: Uint8Array): number {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function chunk(tipo: string, dados: Uint8Array): Uint8Array {
  const corpo = new Uint8Array(4 + dados.length);
  corpo.set(new TextEncoder().encode(tipo), 0);
  corpo.set(dados, 4);
  const out = new Uint8Array(4 + corpo.length + 4);
  out.set(u32(dados.length), 0);
  out.set(corpo, 4);
  out.set(u32(crc32(corpo)), 4 + corpo.length);
  return out;
}

async function png(largura: number, altura: number, rgba: Uint8Array): Promise<Uint8Array> {
  const linha = largura * 4 + 1;
  const raw = new Uint8Array(linha * altura);
  for (let y = 0; y < altura; y++) {
    raw[y * linha] = 0; // filtro none
    raw.set(rgba.subarray(y * largura * 4, (y + 1) * largura * 4), y * linha + 1);
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(largura), 0);
  ihdr.set(u32(altura), 4);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 6; // RGBA
  const assinatura = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat = await deflate(raw);
  const partes = [assinatura, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = partes.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of partes) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const suave = (borda: number, x: number) => Math.max(0, Math.min(1, (borda - x) / 1.5 + 0.5));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

async function desenhar(S: number, arredondado: boolean): Promise<Uint8Array> {
  const img = new Uint8Array(S * S * 4);
  const bgA = [0x33, 0x40, 0x2c], bgB = [0x24, 0x30, 0x1f];
  const ouro = [0xd4, 0xb4, 0x6a], rosa = [0xf0, 0xde, 0xd9];
  const R = arredondado ? 0.219 * S : 0;
  const anel = 0.205 * S, traco = 0.0215 * S;
  const c1 = [0.402 * S, 0.565 * S], c2 = [0.598 * S, 0.565 * S];

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5, py = y + 0.5;
      let alpha = 1;
      if (R > 0) {
        const dx = Math.max(R - px, px - (S - R), 0);
        const dy = Math.max(R - py, py - (S - R), 0);
        alpha = suave(R, Math.hypot(dx, dy));
      }
      if (alpha <= 0) continue;

      const t = (px + py) / (2 * S);
      let r = lerp(bgA[0], bgB[0], t), g = lerp(bgA[1], bgB[1], t), b = lerp(bgA[2], bgB[2], t);

      for (const [c, cor] of [[c1, ouro], [c2, rosa]] as [number[], number[]][]) {
        const d = Math.abs(Math.hypot(px - c[0], py - c[1]) - anel);
        const a = suave(traco, d);
        if (a > 0) {
          r = lerp(r, cor[0], a);
          g = lerp(g, cor[1], a);
          b = lerp(b, cor[2], a);
        }
      }

      const i = (y * S + x) * 4;
      img[i] = r;
      img[i + 1] = g;
      img[i + 2] = b;
      img[i + 3] = Math.round(alpha * 255);
    }
  }
  return png(S, S, img);
}

const cache = new Map<string, Uint8Array>();

export async function gerarIcone(nome: string): Promise<Uint8Array | null> {
  const specs: Record<string, [number, boolean]> = {
    "icon-192.png": [192, true],
    "icon-512.png": [512, true],
    "icon-maskable-512.png": [512, false],
  };
  const spec = specs[nome];
  if (!spec) return null;
  if (!cache.has(nome)) cache.set(nome, await desenhar(spec[0], spec[1]));
  return cache.get(nome)!;
}
