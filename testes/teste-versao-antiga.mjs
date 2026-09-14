// O servidor recusa gravação de versão antiga (426): o app avisa, procura a
// atualização e NÃO perde o que foi alterado (fica pendente e sobe depois).
import { chromium } from "playwright-core";
const API = "https://rgxkmntpdbvvqcwksrwl.supabase.co/functions/v1/app/api";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const resultados = [];
const checa = (nome, ok, detalhe) => { resultados.push(ok); console.log(`${ok ? "✅" : "❌"} ${nome}${detalhe ? " — " + detalhe : ""}`); };
const estado = { config: { noiva: "Rayane", noivo: "Lucas", data: "2027-04-21T16:00", local: "", foto: "" },
  convidados: [{ id: "g0", nome: "Convidado 0", lado: "noiva", acompanhantes: 0, confirmado: false }],
  itens: [], fornecedores: [], presentes: [], notas: [], padrinhos: [], apagados: [] };
let recusar = true; const salvamentos = [];
const ctx = await b.newContext({ viewport: { width: 390, height: 850 } });
await ctx.route("https://fonts.googleapis.com/**", (r) => r.abort());
await ctx.route(API, async (route) => {
  const c = JSON.parse(route.request().postData() || "{}");
  if (c.op === "membros") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ membros: [] }) });
  if (c.op === "salvar") {
    salvamentos.push(c);
    if (recusar) return route.fulfill({ status: 426, contentType: "application/json", body: JSON.stringify({ erro: "esta versão do app não grava mais; atualize para continuar", atualizar: true }) });
    for (const x of c.estado.convidados || []) { const i = estado.convidados.findIndex((p) => p.id === x.id); if (i >= 0) estado.convidados[i] = x; }
  }
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ atualizado_em: "t" + salvamentos.length, estado }) });
});
await ctx.addInitScript(`
  localStorage.setItem("nosso-casamento-usuario", "lucasdarienzo");
  localStorage.setItem("nosso-casamento-token", "t.t");
  localStorage.setItem("nosso-casamento-v1", ${JSON.stringify(JSON.stringify(estado))});
  localStorage.setItem("nosso-casamento-base", ${JSON.stringify(JSON.stringify(estado))});`);
const p = await ctx.newPage();
const avisos = [];
await p.goto("http://localhost:8123/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
await p.evaluate(() => document.getElementById("abertura")?.remove());
await p.click('.nav-item[data-view="convidados"]');
await p.click('#lista-convidados [data-id="g0"] [data-acao="confirmar"]');
await p.waitForTimeout(2500);
const toast = await p.$eval("#toast", (e) => e.textContent).catch(() => "");
checa("servidor recusou (426) e o app avisou para atualizar", salvamentos.length >= 1 && /vers[aã]o nova|atualiz/i.test(toast), `toast: "${toast}"`);
await p.click("#btn-config");
await p.waitForTimeout(200);
checa("rodapé mostra pendência, não 'sincronizado'", (await p.$eval("#sync-status", (e) => e.textContent)).includes("aguardando"));
checa("a alteração continua na tela", await p.$eval('#lista-convidados [data-id="g0"] .check-toggle', (e) => e.classList.contains("is-on")));
recusar = false; // "atualizou": o servidor passa a aceitar
await p.waitForTimeout(9000); // ciclo de 7 s tenta de novo
checa("depois de liberado, a alteração subiu sozinha", estado.convidados[0].confirmado === true, `${salvamentos.length} tentativas`);
await b.close();
console.log(`\n${resultados.filter(Boolean).length}/${resultados.length} verificações passaram`);
process.exit(resultados.every(Boolean) ? 0 : 1);
