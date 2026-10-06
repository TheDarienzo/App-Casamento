// Transições de tela: fotografa o meio da animação (esticada para 3 s) e
// confere que não há tela em branco nem duas telas sobrepostas, e que o
// estado final é sempre o certo — inclusive com toques rápidos seguidos.
import { chromium } from "playwright-core";
const API = "https://rgxkmntpdbvvqcwksrwl.supabase.co/functions/v1/app/api";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const resultados = [];
const checa = (nome, ok, detalhe) => { resultados.push(ok); console.log(`${ok ? "✅" : "❌"} ${nome}${detalhe ? " — " + detalhe : ""}`); };

const estado = {
  config: { noiva: "Rayane", noivo: "Lucas", data: "2027-04-21T16:00", local: "Casa das Pedras", foto: "" },
  convidados: [1, 2, 3, 4, 5, 6].map((i) => ({ id: "g" + i, nome: "Convidado " + i, lado: i % 2 ? "noiva" : "noivo", acompanhantes: 0, confirmado: i < 3 })),
  itens: [{ id: "i1", descricao: "Buffet", valor: 1000000, resolvido: false, prazo: "2026-12-01" }],
  padrinhos: [{ id: "p1", padrinho: "Ícaro", madrinha: "Wilma" }], fornecedores: [], presentes: [], notas: [], apagados: [],
};
{
  const tmp = await b.newPage();
  estado.config.foto = await tmp.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 600; c.height = 450;
    const g = c.getContext("2d"); const grad = g.createLinearGradient(0, 0, 600, 450);
    grad.addColorStop(0, "#c98a80"); grad.addColorStop(1, "#7d9070"); g.fillStyle = grad; g.fillRect(0, 0, 600, 450);
    g.fillStyle = "#fffdf8"; g.font = "bold 80px serif"; g.fillText("R & L", 180, 260);
    return c.toDataURL("image/jpeg", 0.8);
  });
  await tmp.close();
}
const ctx = await b.newContext({ viewport: { width: 390, height: 850 }, deviceScaleFactor: 2 });
await ctx.route("https://fonts.googleapis.com/**", (r) => r.abort());
await ctx.route(/realtime\/v1\/websocket/, (r) => r.abort());
await ctx.route(API, (route) => {
  const c = JSON.parse(route.request().postData() || "{}");
  if (c.op === "membros") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ membros: [] }) });
  if (c.op === "salvar" && c.estado.config) estado.config = { ...estado.config, ...c.estado.config };
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ atualizado_em: "t1", estado }) });
});
await ctx.addInitScript(`
  localStorage.setItem("nosso-casamento-usuario", "lucasdarienzo");
  localStorage.setItem("nosso-casamento-token", "t.t");
  localStorage.setItem("nosso-casamento-v1", ${JSON.stringify(JSON.stringify(estado))});
  localStorage.setItem("nosso-casamento-base", ${JSON.stringify(JSON.stringify(estado))});`);
const p = await ctx.newPage();
const erros = []; p.on("pageerror", (e) => erros.push(String(e)));
await p.goto("http://localhost:8123/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
await p.evaluate(() => document.getElementById("abertura")?.remove());

checa("navegador suporta a API e o app detectou", await p.evaluate(() => document.documentElement.classList.contains("vt")));

// estica as animações para fotografar o meio
await p.addStyleTag({ content: ":root{--vt-sai:1200ms;--vt-espera:600ms;--vt-entra:2000ms;--vt-move:2800ms}" });

const ativas = () => p.$$eval(".view.is-active", (l) => l.map((v) => v.id));
const fotografar = async (nome) => p.screenshot({ path: `shots-vt/${nome}.png` });

async function trocar(nome, acao, esperado) {
  await acao();
  await p.waitForTimeout(1000);  // ~meio da saída/entrada
  await fotografar(nome + "-meio");
  const emCurso = await p.evaluate(() => document.documentElement.dataset.transicao || "");
  await p.waitForTimeout(3200);
  await fotografar(nome + "-fim");
  const a = await ativas();
  checa(`${nome}: uma única tela ativa no fim (${esperado})`, a.length === 1 && a[0] === "view-" + esperado, a.join(","));
  checa(`${nome}: transição rodou e terminou limpa`, Boolean(emCurso) && !(await p.evaluate(() => document.documentElement.dataset.transicao)), `tipo "${emCurso}"`);
  // nada em branco: a tela ativa tem conteúdo visível
  const altura = await p.$eval(".view.is-active", (v) => v.getBoundingClientRect().height);
  checa(`${nome}: tela com conteúdo (${Math.round(altura)}px)`, altura > 100);
}

console.log("\n1) aba → aba (lateral)");
await trocar("lateral", () => p.click('.nav-item[data-view="convidados"]'), "convidados");
console.log("\n2) engrenagem (avança)");
await trocar("avanca", () => p.click("#btn-config"), "config");
console.log("\n3) config → início pela barra (volta)");
await trocar("volta", () => p.click('.nav-item[data-view="dashboard"]'), "dashboard");
console.log("\n4) atalho do início → lista (avança)");
const temGoto = await p.$("[data-goto]");
if (temGoto) await trocar("atalho", () => p.click("[data-goto]"), await p.$eval("[data-goto]", (e) => e.dataset.goto));

console.log("\n5) toques rápidos em três abas seguidas");
await p.click('.nav-item[data-view="checklist"]');
await p.waitForTimeout(150);
await p.click('.nav-item[data-view="padrinhos"]');
await p.waitForTimeout(150);
await p.click('.nav-item[data-view="notas"]');
await p.waitForTimeout(400);
await fotografar("rapido-meio");
await p.waitForTimeout(3500);
const a5 = await ativas();
checa("fim: só a última aba tocada está ativa", a5.length === 1 && a5[0] === "view-notas", a5.join(","));
checa("barra marca a aba certa", await p.$eval(".nav-item.is-active", (e) => e.dataset.view) === "notas");

console.log("\n6) foto: pequena vira grande e volta");
await p.click("#monogram");
await p.waitForTimeout(900);
await fotografar("foto-meio");
await p.waitForTimeout(3000);
await fotografar("foto-aberta");
checa("foto grande aberta", await p.$eval("#foto-grande", (e) => !e.hidden));
await p.click("#foto-grande-fechar");
await p.waitForTimeout(3600);
checa("foto fechada e nome devolvido ao cabeçalho", await p.evaluate(() => document.getElementById("foto-grande").hidden && !document.body.classList.contains("foto-aberta")));

console.log("\n7) sem a API (navegador antigo): troca seca, sem erro");
await p.evaluate(() => { document.startViewTransition = undefined; });
await p.click('.nav-item[data-view="presentes"]');
await p.waitForTimeout(300);
const a7 = await ativas();
checa("trocou mesmo assim", a7.length === 1 && a7[0] === "view-presentes", a7.join(","));
checa("sem erros de página", erros.length === 0, erros.join(" | "));

await b.close();
console.log(`\n${resultados.filter(Boolean).length}/${resultados.length} verificações passaram`);
process.exit(resultados.every(Boolean) ? 0 : 1);
