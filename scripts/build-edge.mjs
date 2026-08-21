// Gera os arquivos da Edge Function "app": assets.ts (arquivos do PWA
// embutidos) e copia o index.ts do template.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const root = "/home/user/App-Casamento";
const out = "/tmp/claude-0/-home-user-App-Casamento/a19c2348-9488-5a39-b743-9f6e6d3d436c/scratchpad/edge";
mkdirSync(out, { recursive: true });

const texto = (p) => readFileSync(root + p, "utf8");

const assets = {
  "/index.html": { type: "text/html; charset=utf-8", body: texto("/index.html") },
  "/css/styles.css": { type: "text/css; charset=utf-8", body: texto("/css/styles.css") },
  "/js/app.js": { type: "text/javascript; charset=utf-8", body: texto("/js/app.js") },
  "/sw.js": { type: "text/javascript; charset=utf-8", body: texto("/sw.js") },
  "/manifest.webmanifest": { type: "application/manifest+json; charset=utf-8", body: texto("/manifest.webmanifest") },
  "/icons/icon.svg": { type: "image/svg+xml", body: texto("/icons/icon.svg") },
};

// uma literal curta por linha do arquivo original: legível e fácil de conferir
const litLinhas = (s) => {
  const linhas = s.split("\n");
  const partes = linhas.map((l, i) => "    " + JSON.stringify(l + (i < linhas.length - 1 ? "\n" : "")));
  return "[\n" + partes.join(",\n") + '\n  ].join("")';
};

const entradas = Object.entries(assets)
  .map(([caminho, a]) => `  ${JSON.stringify(caminho)}: {\n    type: ${JSON.stringify(a.type)},\n    body: ${litLinhas(a.body)},\n  },`)
  .join("\n");

const ts = `// Gerado por scripts/build-edge — arquivos do PWA embutidos.
// Os PNGs dos ícones não ficam aqui: são gerados em memória por icons.ts.
export interface Asset {
  type: string;
  body: string;
}

export const ASSETS: Record<string, Asset> = {
${entradas}
};
`;

writeFileSync(out + "/assets.ts", ts);
console.log("assets.ts:", ts.length, "bytes");
