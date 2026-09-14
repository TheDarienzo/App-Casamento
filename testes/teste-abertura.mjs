// Reproduz a perda relatada: a Rayane altera um padrinho no celular dela; o
// Lucas abre o app com a cópia velha e a alteração dela some.
//
// O stub da API imita o salvar_estado real: grava linha por linha o que
// chega, não apaga o que não veio, e devolve tudo somado.
import { chromium } from "playwright-core";
const API = "https://rgxkmntpdbvvqcwksrwl.supabase.co/functions/v1/app/api";
const LISTAS = ["convidados", "itens", "padrinhos", "fornecedores", "presentes", "notas"];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

function estadoBase() {
  return {
    config: { noiva: "Rayane", noivo: "Lucas", data: "2027-04-21T16:00", local: "Casa das Pedras", foto: "" },
    convidados: [0, 1, 2].map((i) => ({ id: "g" + i, nome: "Convidado " + i, lado: "noiva", acompanhantes: 0, confirmado: false })),
    itens: [], fornecedores: [], presentes: [], notas: [],
    padrinhos: [
      { id: "p1", padrinho: "Ícaro", madrinha: "Wilma" },
      { id: "p2", padrinho: "Matheus", madrinha: "Poliana" },
    ],
    apagados: [],
  };
}

// servidor em memória com a mesma regra da função salvar_estado
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
      for (const l of LISTAS) {
        if (!Array.isArray(envio[l])) continue;
        const mapa = new Map(nuvem[l].map((x) => [x.id, x]));
        for (const x of envio[l]) if (!apagados.has(x.id)) mapa.set(x.id, x);
        nuvem[l] = [...mapa.values()];
      }
      for (const a of envio.apagados || []) {
        apagados.add(a.id);
        for (const l of LISTAS) nuvem[l] = nuvem[l].filter((x) => x.id !== a.id);
      }
      carimbo = new Date(Date.parse(carimbo) + 1000).toISOString();
    },
    resposta() { return { atualizado_em: carimbo, estado: JSON.parse(JSON.stringify(nuvem)) }; },
  };
}

async function abrirCelular(srv, guardado, { base, demora = 0 } = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 850 } });
  await ctx.route("https://fonts.googleapis.com/**", (r) => r.abort());
  await ctx.route(API, async (route) => {
    const c = JSON.parse(route.request().postData() || "{}");
    if (c.op === "membros") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ membros: ["lucasdarienzo", "rayanelima"] }) });
    if (c.op === "salvar") {
      if (demora) await new Promise((r) => setTimeout(r, demora));
      srv.salvar(c.estado);
    }
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(srv.resposta()) });
  });
  await ctx.addInitScript(`
    localStorage.setItem("nosso-casamento-usuario", "lucasdarienzo");
    localStorage.setItem("nosso-casamento-casal", "5c337697-bad4-4261-abc7-070eb4441509");
    localStorage.setItem("nosso-casamento-token", "t.t");
    localStorage.setItem("nosso-casamento-v1", ${JSON.stringify(JSON.stringify(guardado))});
    ${base ? `localStorage.setItem("nosso-casamento-base", ${JSON.stringify(JSON.stringify(base))});` : ""}`);
  const p = await ctx.newPage();
  await p.goto("http://localhost:8123/", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3000);
  await p.evaluate(() => document.getElementById("abertura")?.remove());
  return { ctx, p };
}

const madrinhaNaTela = (p, id) => p.$eval(`#lista-padrinhos [data-id="${id}"]`, (li) => li.textContent.replace(/\s+/g, " ").trim());
const resultados = [];
const checa = (nome, ok, detalhe) => { resultados.push(ok); console.log(`${ok ? "✅" : "❌"} ${nome}${detalhe ? " — " + detalhe : ""}`); };

// ---------------------------------------------------------------- cenário A
console.log("\nA) Rayane alterou um padrinho; Lucas abre o app com a cópia velha (sem base guardada)");
{
  const srv = servidor(estadoBase());
  srv.nuvem.padrinhos[0].madrinha = "Wilma Santos"; // alteração da Rayane, já no servidor
  const { ctx, p } = await abrirCelular(srv, estadoBase()); // Lucas: cópia de antes
  await p.click('.nav-item[data-view="padrinhos"]');
  await p.waitForTimeout(500);
  checa("servidor manteve a alteração da Rayane", srv.nuvem.padrinhos[0].madrinha === "Wilma Santos", `servidor tem "${srv.nuvem.padrinhos[0].madrinha}"`);
  checa("celular do Lucas mostra a alteração da Rayane", (await madrinhaNaTela(p, "p1")).includes("Wilma Santos"));
  const enviouTudo = srv.envios.some((e) => LISTAS.every((l) => Array.isArray(e[l]) && e[l].length === estadoBase()[l].length) && e.config);
  checa("abertura não mandou o cadastro inteiro", !enviouTudo, `${srv.envios.length} envio(s): ${srv.envios.map((e) => Object.keys(e).filter((k) => k !== "apagados").join("+") || "só apagados").join(" | ") || "nenhum"}`);
  await ctx.close();
}

// ---------------------------------------------------------------- cenário B
console.log("\nB) resposta chega enquanto Lucas está editando um convidado; o envio seguinte não pode levar o que ele não mexeu");
{
  const srv = servidor(estadoBase());
  const { ctx, p } = await abrirCelular(srv, estadoBase(), { base: estadoBase(), demora: 1500 });
  await p.click('.nav-item[data-view="convidados"]');
  await p.waitForTimeout(400);
  const antes = srv.envios.length;
  await p.click('#lista-convidados [data-id="g0"] [data-acao="confirmar"]'); // envio #1 sai em 1,2 s e demora 1,5 s
  await p.waitForTimeout(1500);
  srv.nuvem.padrinhos[0].madrinha = "Wilma Santos"; // Rayane altera enquanto o envio #1 está em voo
  await p.click('#lista-convidados [data-id="g1"] [data-acao="editar"]'); // Lucas abre a edição antes da resposta
  await p.waitForTimeout(2500); // resposta do #1 chega com a edição aberta
  await p.fill('#lista-convidados [data-id="g1"] .ed-nome', "Convidado 1 Silva");
  await p.click('#lista-convidados [data-id="g1"] [data-acao="salvar"]');
  await p.waitForTimeout(4000);
  const depois = srv.envios.slice(antes);
  checa("servidor manteve a alteração da Rayane", srv.nuvem.padrinhos[0].madrinha === "Wilma Santos", `servidor tem "${srv.nuvem.padrinhos[0].madrinha}"`);
  checa("nenhum envio levou padrinhos (Lucas não mexeu neles)", !depois.some((e) => e.padrinhos), depois.map((e) => Object.keys(e).filter((k) => k !== "apagados").join("+")).join(" | "));
  checa("a edição do Lucas chegou", srv.nuvem.convidados.find((c) => c.id === "g1")?.nome === "Convidado 1 Silva");
  checa("a confirmação do Lucas chegou", srv.nuvem.convidados.find((c) => c.id === "g0")?.confirmado === true);
  await p.click('.nav-item[data-view="padrinhos"]');
  await p.waitForTimeout(8000); // próximo ciclo de 7 s traz a alteração
  checa("celular do Lucas acabou mostrando a alteração da Rayane", (await madrinhaNaTela(p, "p1")).includes("Wilma Santos"));
  await ctx.close();
}

// ---------------------------------------------------------------- cenário C
console.log("\nC) Lucas editou um padrinho sem conexão e fechou o app; Rayane mudou outro; Lucas abre de novo");
{
  const srv = servidor(estadoBase());
  srv.nuvem.padrinhos[0].madrinha = "Wilma Santos"; // Rayane, no servidor
  const local = estadoBase();
  local.padrinhos[1].madrinha = "Poliana Lima"; // Lucas, só no aparelho (nunca chegou a enviar)
  const { ctx, p } = await abrirCelular(srv, local, { base: estadoBase() });
  await p.click('.nav-item[data-view="padrinhos"]');
  await p.waitForTimeout(1500);
  checa("servidor manteve a alteração da Rayane", srv.nuvem.padrinhos[0].madrinha === "Wilma Santos", `"${srv.nuvem.padrinhos[0].madrinha}"`);
  checa("servidor recebeu a alteração do Lucas", srv.nuvem.padrinhos[1].madrinha === "Poliana Lima", `"${srv.nuvem.padrinhos[1].madrinha}"`);
  checa("tela do Lucas mostra as duas", (await madrinhaNaTela(p, "p1")).includes("Wilma Santos") && (await madrinhaNaTela(p, "p2")).includes("Poliana Lima"));
  checa("envio levou só o padrinho que o Lucas mexeu", srv.envios.length >= 1 && srv.envios.every((e) => !e.convidados && !e.config && (!e.padrinhos || (e.padrinhos.length === 1 && e.padrinhos[0].id === "p2"))), srv.envios.map((e) => Object.keys(e).filter((k) => k !== "apagados").join("+")).join(" | "));
  await ctx.close();
}

await b.close();
console.log(`\n${resultados.filter(Boolean).length}/${resultados.length} verificações passaram`);
process.exit(resultados.every(Boolean) ? 0 : 1);
