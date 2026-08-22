// Sobe o número de versão do app (sw.js e js/app.js) antes de publicar.
// Uso: node scripts/subir-versao.mjs
import { readFileSync, writeFileSync } from "node:fs";

const sw = readFileSync("sw.js", "utf8");
const app = readFileSync("js/app.js", "utf8");

const atual = Number(/const VERSAO = "(\d+)"/.exec(sw)?.[1]);
if (!Number.isFinite(atual)) throw new Error("não achei a VERSAO em sw.js");
const nova = atual + 1;

writeFileSync("sw.js", sw.replace(/const VERSAO = "\d+"/, `const VERSAO = "${nova}"`));
writeFileSync("js/app.js", app.replace(/const VERSAO_APP = "\d+"/, `const VERSAO_APP = "${nova}"`));

console.log(`versão ${atual} → ${nova}`);
