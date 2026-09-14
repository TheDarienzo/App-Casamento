// Todas as telas de uma vez: a Rayane altera um cadastro em CADA lista, mais
// dados do casal e do convite; o Lucas abre com a cópia velha e, num segundo
// cenário, com alterações próprias sem conexão em cada lista.
import { chromium } from "playwright-core";
const API = "https://rgxkmntpdbvvqcwksrwl.supabase.co/functions/v1/app/api";
const LISTAS = ["convidados", "itens", "padrinhos", "fornecedores", "presentes", "notas"];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const resultados = [];
const checa = (nome, ok, detalhe) => { resultados.push(ok); console.log(`${ok ? "✅" : "❌"} ${nome}${detalhe ? " — " + detalhe : ""}`); };

function estadoBase() {
  return {
    config: { noiva: "Rayane", noivo: "Lucas", data: "2027-04-21T16:00", local: "Casa das Pedras", foto: "" },
    convite: { slug: "rayane-e-lucas", publicado: false, titulo: "", mensagem: "", localNome: "", endereco: "", mapaLink: "", presentesLink: "", presentesTexto: "", pixChave: "", pixNome: "", traje: "", prazo: "" },
    convidados: [{ id: "g1", nome: "Ana", lado: "noiva", acompanhantes: 0, confirmado: false, telefone: "" }, { id: "g2", nome: "Bruno", lado: "noivo", acompanhantes: 1, confirmado: false, telefone: "" }],
    itens: [{ id: "i1", descricao: "Buffet", valor: 1000000, resolvido: false, prazo: "" }, { id: "i2", descricao: "DJ", valor: 200000, resolvido: false, prazo: "" }],
    padrinhos: [{ id: "p1", padrinho: "Ícaro", madrinha: "Wilma" }, { id: "p2", padrinho: "Matheus", madrinha: "Poliana" }],
    fornecedores: [{ id: "f1", nome: "Foto Luz", categoria: "Fotografia", contato: "" }, { id: "f2", nome: "Som Bom", categoria: "Música / DJ", contato: "" }],
    presentes: [{ id: "pr1", nome: "Jogo de panelas", valor: 50000, link: "", status: "falta" }, { id: "pr2", nome: "Cafeteira", valor: 30000, link: "", status: "falta" }],
    notas: [{ id: "n1", texto: "Ligar para o buffet", cor: "papel", autor: "Lucas", fixada: false, criadoEm: "2026-09-01T10:00:00Z", editadoEm: "" }, { id: "n2", texto: "Ver flores", cor: "papel", autor: "Rayane", fixada: false, criadoEm: "2026-09-01T10:00:00Z", editadoEm: "" }],
    apagados: [],
  };
}
// o que a Rayane muda: sempre o registro 1 de cada lista, mais config e convite
function alteracoesDaRayane(e) {
  e.convidados[0].nome = "Ana Paula"; e.convidados[0].confirmado = true;
  e.itens[0].descricao = "Buffet (fechado)"; e.itens[0].resolvido = true;
  e.padrinhos[0].madrinha = "Wilma Santos";
  e.fornecedores[0].contato = "(65) 9 9999-0000";
  e.presentes[0].status = "ganho";
  e.notas[0].texto = "Ligar para o buffet — feito";
  e.config.local = "Casa das Pedras, Cuiabá";
  e.convite.mensagem = "Venha celebrar com a gente";
}
// o que o Lucas muda sem conexão: sempre o registro 2 de cada lista
function alteracoesDoLucas(e) {
  e.convidados[1].acompanhantes = 3;
  e.itens[1].valor = 250000;
  e.padrinhos[1].madrinha = "Poliana Lima";
  e.fornecedores[1].categoria = "Decoração";
  e.presentes[1].status = "comprado";
  e.notas[1].fixada = true;
}
const esperadoRayane = estadoBase(); alteracoesDaRayane(esperadoRayane);
const esperadoLucas = estadoBase(); alteracoesDoLucas(esperadoLucas);
const impressao = (x) => JSON.stringify(x, Object.keys(x).sort());

function servidor(inicial) {
  const nuvem = JSON.parse(JSON.stringify(inicial));
  const apagados = new Set();
  let carimbo = "2026-09-14T12:00:00.000Z";
  const envios = [];
  return {
    nuvem, envios,
    salvar(envio) {
      envios.push(JSON.parse(JSON.stringify(envio)));
      if (envio.config) nuvem.config = { ...nuvem.config, ...envio.config };
      if (envio.convite) nuvem.convite = { ...nuvem.convite, ...envio.convite };
      for (const l of LISTAS) {
        if (!Array.isArray(envio[l])) continue;
        const mapa = new Map(nuvem[l].map((x) => [x.id, x]));
        for (const x of envio[l]) if (!apagados.has(x.id)) mapa.set(x.id, x);
        nuvem[l] = [...mapa.values()];
      }
      for (const a of envio.apagados || []) { apagados.add(a.id); for (const l of LISTAS) nuvem[l] = nuvem[l].filter((x) => x.id !== a.id); }
      carimbo = new Date(Date.parse(carimbo) + 1000).toISOString();
    },
    resposta() { return { atualizado_em: carimbo, estado: JSON.parse(JSON.stringify(nuvem)) }; },
  };
}

async function abrirCelular(srv, guardado, base) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 850 } });
  await ctx.route("https://fonts.googleapis.com/**", (r) => r.abort());
  await ctx.route(/realtime\/v1\/websocket/, (r) => r.abort());
  await ctx.route(API, async (route) => {
    const c = JSON.parse(route.request().postData() || "{}");
    if (c.op === "membros") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ membros: [] }) });
    if (c.op === "salvar") srv.salvar(c.estado);
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(srv.resposta()) });
  });
  await ctx.addInitScript(`
    localStorage.setItem("nosso-casamento-usuario", "lucasdarienzo");
    localStorage.setItem("nosso-casamento-token", "t.t");
    localStorage.setItem("nosso-casamento-v1", ${JSON.stringify(JSON.stringify(guardado))});
    ${base ? `localStorage.setItem("nosso-casamento-base", ${JSON.stringify(JSON.stringify(base))});` : ""}`);
  const p = await ctx.newPage();
  const erros = []; p.on("pageerror", (e) => erros.push(String(e)));
  await p.goto("http://localhost:8123/", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3500);
  return { ctx, p, erros };
}

// confere, lista por lista, que o servidor tem o registro esperado
function conferir(srv, esperado, quem) {
  for (const l of LISTAS) {
    const idx = quem === "Rayane" ? 0 : 1;
    const alvo = esperado[l][idx];
    const atual = srv.nuvem[l].find((x) => x.id === alvo.id);
    checa(`${l}: alteração da ${quem} preservada`, impressao(atual) === impressao(alvo), impressao(atual) !== impressao(alvo) ? `servidor tem ${JSON.stringify(atual)}` : "");
  }
}

console.log("\nA) Rayane mudou algo em TODAS as telas; Lucas abre com a cópia velha (sem base)");
{
  const srv = servidor(estadoBase()); alteracoesDaRayane(srv.nuvem);
  const { ctx, p, erros } = await abrirCelular(srv, estadoBase(), null);
  conferir(srv, esperadoRayane, "Rayane");
  checa("config (dados do casal) preservada", srv.nuvem.config.local === "Casa das Pedras, Cuiabá", srv.nuvem.config.local);
  checa("convite preservado", srv.nuvem.convite.mensagem === "Venha celebrar com a gente", srv.nuvem.convite.mensagem);
  checa("nenhum envio levou lista inteira", !srv.envios.some((e) => LISTAS.some((l) => (e[l] || []).length >= 2)), `${srv.envios.length} envio(s)`);
  const tela = await p.evaluate(() => JSON.parse(localStorage.getItem("nosso-casamento-v1")));
  checa("tela do Lucas ficou igual ao servidor em todas as listas", LISTAS.every((l) => impressao(tela[l].find((x) => x.id === esperadoRayane[l][0].id)) === impressao(esperadoRayane[l][0])));
  checa("sem erros de página", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

console.log("\nB) Lucas alterou algo em TODAS as telas sem conexão; Rayane mudou outro registro em cada uma; Lucas abre");
{
  const srv = servidor(estadoBase()); alteracoesDaRayane(srv.nuvem);
  const local = estadoBase(); alteracoesDoLucas(local);
  const { ctx, p, erros } = await abrirCelular(srv, local, estadoBase());
  await p.waitForTimeout(2000);
  conferir(srv, esperadoRayane, "Rayane");
  conferir(srv, esperadoLucas, "Lucas");
  checa("config e convite da Rayane preservados", srv.nuvem.config.local === "Casa das Pedras, Cuiabá" && srv.nuvem.convite.mensagem === "Venha celebrar com a gente");
  const soDiferenca = srv.envios.every((e) => !e.config && !e.convite && LISTAS.every((l) => !e[l] || (e[l].length === 1 && e[l][0].id === esperadoLucas[l][1].id)));
  checa("envio do Lucas levou só os 6 registros que ele mexeu", soDiferenca, srv.envios.map((e) => Object.keys(e).filter((k) => k !== "apagados").map((k) => k + (Array.isArray(e[k]) ? `(${e[k].length})` : "")).join("+")).join(" | "));
  checa("sem erros de página", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

await b.close();
console.log(`\n${resultados.filter(Boolean).length}/${resultados.length} verificações passaram`);
process.exit(resultados.every(Boolean) ? 0 : 1);
