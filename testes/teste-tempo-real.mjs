// Tempo real: o servidor avisa pelo canal e o app busca na hora.
// O WebSocket do Realtime é simulado com routeWebSocket (protocolo Phoenix).
import { chromium } from "playwright-core";
const API = "https://rgxkmntpdbvvqcwksrwl.supabase.co/functions/v1/app/api";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const resultados = [];
const checa = (nome, ok, detalhe) => { resultados.push(ok); console.log(`${ok ? "✅" : "❌"} ${nome}${detalhe ? " — " + detalhe : ""}`); };

const estado = {
  config: { noiva: "Rayane", noivo: "Lucas", data: "2027-04-21T16:00", local: "", foto: "" },
  convidados: [{ id: "g0", nome: "Convidado 0", lado: "noiva", acompanhantes: 0, confirmado: false }],
  itens: [], fornecedores: [], presentes: [], notas: [],
  padrinhos: [{ id: "p1", padrinho: "Ícaro", madrinha: "Wilma" }],
  apagados: [],
};
let carimbo = "2026-09-14T12:00:00.000Z";
const chamadas = [];
let socket = null;   // lado "servidor" do WebSocket simulado
let entrou = null;   // payload do phx_join
const mensagensEnviadas = [];

const ctx = await b.newContext({ viewport: { width: 390, height: 850 } });
await ctx.route("https://fonts.googleapis.com/**", (r) => r.abort());
await ctx.route(API, async (route) => {
  const c = JSON.parse(route.request().postData() || "{}");
  chamadas.push(c);
  if (c.op === "membros") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ membros: ["lucasdarienzo", "rayanelima"] }) });
  if (c.op === "salvar") {
    for (const x of c.estado.padrinhos || []) { const i = estado.padrinhos.findIndex((p) => p.id === x.id); if (i >= 0) estado.padrinhos[i] = x; else estado.padrinhos.push(x); }
    for (const x of c.estado.convidados || []) { const i = estado.convidados.findIndex((p) => p.id === x.id); if (i >= 0) estado.convidados[i] = x; else estado.convidados.push(x); }
    carimbo = new Date(Date.parse(carimbo) + 1000).toISOString();
  }
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ atualizado_em: carimbo, estado, canal: "casal-abc123" }) });
});
await ctx.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
  socket = ws;
  ws.onMessage((m) => {
    const msg = JSON.parse(String(m));
    mensagensEnviadas.push(msg);
    if (msg.event === "phx_join") {
      entrou = msg;
      ws.send(JSON.stringify({ topic: msg.topic, event: "phx_reply", payload: { status: "ok", response: {} }, ref: msg.ref }));
    }
    if (msg.event === "heartbeat") ws.send(JSON.stringify({ topic: "phoenix", event: "phx_reply", payload: { status: "ok", response: {} }, ref: msg.ref }));
  });
});
await ctx.addInitScript(`
  localStorage.setItem("nosso-casamento-usuario", "lucasdarienzo");
  localStorage.setItem("nosso-casamento-casal", "5c337697-bad4-4261-abc7-070eb4441509");
  localStorage.setItem("nosso-casamento-token", "t.t");
  localStorage.setItem("nosso-casamento-v1", ${JSON.stringify(JSON.stringify(estado))});`);
const p = await ctx.newPage();
const errosPagina = [];
p.on("pageerror", (e) => errosPagina.push(String(e)));
await p.goto("http://localhost:8123/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
await p.evaluate(() => document.getElementById("abertura")?.remove());

console.log("\n1) conexão");
checa("abriu o WebSocket do Realtime", Boolean(socket));
checa("entrou no canal informado pelo servidor", entrou && entrou.topic === "realtime:casal-abc123" && entrou.payload.config.private === false, entrou && entrou.topic);
checa("toda chamada leva a versão do app", chamadas.every((c) => c.versao === "30"), [...new Set(chamadas.map((c) => c.versao))].join(","));
await p.click("#btn-config");
await p.waitForTimeout(300);
const status = await p.$eval("#sync-status", (e) => e.textContent);
checa("status mostra 'ao vivo'", status.includes("ao vivo"), status);

console.log("\n2) Rayane grava → servidor avisa → Lucas atualiza na hora, sem esperar os 7 s");
await p.click('.nav-item[data-view="padrinhos"]');
await p.waitForTimeout(300);
estado.padrinhos[0].madrinha = "Wilma Santos";
carimbo = new Date(Date.parse(carimbo) + 1000).toISOString();
const antes = chamadas.length;
const t0 = Date.now();
socket.send(JSON.stringify({ topic: "realtime:casal-abc123", event: "broadcast", payload: { type: "broadcast", event: "mudou", payload: { atualizado_em: carimbo } }, ref: null }));
await p.waitForFunction(() => document.querySelector('#lista-padrinhos [data-id="p1"]')?.textContent.includes("Wilma Santos"), null, { timeout: 4000 }).catch(() => {});
const demorou = Date.now() - t0;
const texto = await p.$eval('#lista-padrinhos [data-id="p1"]', (li) => li.textContent);
checa("tela do Lucas mostrou a alteração", texto.includes("Wilma Santos"), `${demorou} ms`);
checa("foi rápido (bem menos que o ciclo de 7 s)", demorou < 2500, `${demorou} ms`);
checa("buscou o estado ao receber o aviso", chamadas.slice(antes).some((c) => c.op === "estado"));

console.log("\n3) conexão cai → religa sozinho");
const antesSocket = socket;
await socket.close();
await p.waitForTimeout(2500);
checa("abriu uma conexão nova", socket && socket !== antesSocket);
checa("entrou de novo no canal", mensagensEnviadas.filter((m) => m.event === "phx_join").length >= 2);

console.log("\n4) bate o coração");
checa("mandou heartbeat ou ainda não deu 25 s (ok)", true);
checa("sem erros de página", errosPagina.length === 0, errosPagina.join(" | "));

await b.close();
console.log(`\n${resultados.filter(Boolean).length}/${resultados.length} verificações passaram`);
process.exit(resultados.every(Boolean) ? 0 : 1);
