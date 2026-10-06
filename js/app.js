/* ============================================================
   Nosso Casamento — lógica do app
   Dados salvos em localStorage (apenas neste aparelho).
   ============================================================ */

(() => {
  "use strict";

  const VERSAO_APP = "31";
  const STORAGE_KEY = "nosso-casamento-v1";
  const CASAL_KEY = "nosso-casamento-casal";
  // bilhete de sessão assinado pelo servidor (substitui guardar o código do casal)
  const TOKEN_KEY = "nosso-casamento-token";
  const BASE_KEY = "nosso-casamento-base"; // última versão confirmada pelo servidor

  // API de sincronização (Edge Function no Supabase). O app pode estar
  // hospedado em qualquer lugar (Cloudflare Pages, GitHub Pages, …).
  const API_URL = "https://rgxkmntpdbvvqcwksrwl.supabase.co/functions/v1/app/api";

  const estadoInicial = () => ({
    config: { noiva: "", noivo: "", data: "", local: "", foto: "" },
    // conteúdo da página pública do convite (ver convite/)
    convite: { slug: "", publicado: false, titulo: "", mensagem: "", localNome: "",
               endereco: "", mapaLink: "", presentesLink: "", presentesTexto: "",
               pixChave: "", pixNome: "", traje: "", prazo: "" },
    convidados: [],   // { id, nome, lado: "noiva"|"noivo", acompanhantes, confirmado }
    itens: [],        // { id, descricao, valor (centavos), resolvido, prazo: "AAAA-MM-DD" }
    padrinhos: [],    // { id, padrinho, madrinha }
    fornecedores: [], // { id, nome, categoria, contato }
    presentes: [],    // { id, nome, valor (centavos), link, status: "falta"|"comprado"|"ganho" }
    notas: [],        // { id, texto, cor, autor, fixada, criadoEm, editadoEm }
    apagados: [],     // { id, em } — o que foi removido, para não voltar na sincronização
  });

  let state = carregar();
  let filtroConvidados = "todos";
  let filtroChecklist = "todos";
  let filtroPresentes = "todos";
  let filtroNotaAutor = "todos";
  let buscaNotas = "";
  let notaEditando = "";
  let membrosCasal = [];
  let editandoId = "";  // item aberto para edição (qualquer lista)
  const busca = { convidados: "", checklist: "", padrinhos: "", presentes: "", fornecedores: "" };

  /* ---------- persistência ---------- */

  function carregar() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return estadoInicial();
      const dados = JSON.parse(raw);
      return { ...estadoInicial(), ...dados, config: { ...estadoInicial().config, ...dados.config } };
    } catch {
      return estadoInicial();
    }
  }

  function salvar() {
    // cada alteração local avança a revisão: é assim que o envio descobre,
    // ao receber a resposta, se algo mudou aqui enquanto ela vinha
    revisaoLocal++;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      toast("Não foi possível salvar os dados 😢");
    }
    agendarEnvio();
  }

  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

  const LISTAS = ["convidados", "itens", "padrinhos", "fornecedores", "presentes", "notas"];

  // marca ids como apagados para que a sincronização não os traga de volta
  function marcarApagados(...ids) {
    const em = new Date().toISOString();
    if (!Array.isArray(state.apagados)) state.apagados = [];
    for (const id of ids.flat()) {
      if (id) state.apagados.push({ id: String(id), em });
    }
    if (state.apagados.length > 300) state.apagados = state.apagados.slice(-300);
  }

  /* ---------- helpers ---------- */

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const brl = (centavos) => fmtBRL.format((centavos || 0) / 100);

  function parseValor(texto) {
    // aceita "1.234,56", "1234.56", "1234", "R$ 50"
    const limpo = String(texto).replace(/[^\d.,-]/g, "").trim();
    if (!limpo) return 0;
    let normalizado = limpo;
    if (limpo.includes(",")) {
      normalizado = limpo.replace(/\./g, "").replace(",", ".");
    }
    const n = parseFloat(normalizado);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
  }

  function escapeHtml(texto) {
    const div = document.createElement("div");
    div.textContent = texto;
    return div.innerHTML;
  }

  const escapeAttr = (texto) => escapeHtml(texto).replace(/"/g, "&quot;");

  // tira acentos mantendo o mesmo número de letras, para buscar "fotografo"
  // e encontrar "Fotógrafo" (e o destaque continuar alinhado com o texto)
  function semAcentos(texto) {
    return Array.from(String(texto))
      .map((ch) => {
        const simples = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return simples.length === 1 ? simples : ch;
      })
      .join("");
  }

  const normalizar = (texto) => semAcentos(texto).toLowerCase();

  function normalizarLink(link) {
    const l = String(link || "").trim();
    if (!l) return "";
    return /^https?:\/\//i.test(l) ? l : "https://" + l;
  }

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2400);
  }

  const nomeNoiva = () => state.config.noiva.trim() || "Noiva";
  const nomeNoivo = () => state.config.noivo.trim() || "Noivo";

  const totalPessoas = (c) => 1 + (c.acompanhantes || 0);

  const iconeLixeira =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-.8 12.1a2 2 0 0 1-2 1.9H8.8a2 2 0 0 1-2-1.9L6 7"/><path d="M10 11v6M14 11v6"/></svg>';
  // avião de papel: mandar o convite
  const iconeConvite =
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 10.5 13.5"/><path d="M21 3l-6.5 18-4-8-8-4z"/></svg>';

  // o que a família respondeu na página do convite
  function seloResposta(c) {
    if (!c.respondeu) return "";
    if (!c.confirmado) return '<span class="selo-resposta selo-nao-vem">não vai</span>';
    const n = c.pessoasConfirmadas || 0;
    return `<span class="selo-resposta selo-vem">confirmou ${n || "presença"}${n ? (n === 1 ? " pessoa" : " pessoas") : ""}</span>`;
  }

  const iconeCheck =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4 10-10"/></svg>';

  const CATEGORIAS_FORNECEDOR = [
    "Buffet", "Fotografia", "Música / DJ", "Decoração", "Espaço / Local",
    "Vestido & Traje", "Doces & Bolo", "Convites", "Cerimonial", "Outro",
  ];

  const btnEditar = (rotulo) =>
    `<button class="btn-editar" data-acao="editar" aria-label="Editar ${rotulo}" title="Editar">${iconeEditar}</button>`;

  const acoesEdicao = () =>
    `<div class="edit-acoes">
      <button type="button" class="btn-secondary" data-acao="cancelar">Cancelar</button>
      <button type="button" class="btn-primary" data-acao="salvar">Salvar</button>
    </div>`;

  // abre um item para edição e leva o cursor para o primeiro campo
  function abrirEdicao(id) {
    editandoId = id;
    renderTudo();
    const campo = document.querySelector(`[data-id="${id}"] .ed-foco`);
    if (campo) {
      campo.focus();
      if (campo.setSelectionRange) campo.setSelectionRange(campo.value.length, campo.value.length);
    }
  }

  const valorParaCampo = (centavos) => (centavos ? (centavos / 100).toFixed(2).replace(".", ",") : "");

  // Soma meses respeitando o tamanho de cada um: 31 de janeiro mais um mês
  // vira 28 de fevereiro, e não 3 de março como o padrão do navegador faria.
  function somarMeses(data, meses) {
    const d = new Date(data.getTime());
    const dia = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + meses);
    const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(dia, ultimoDia));
    return d;
  }

  // Meses inteiros de calendário até a data, e os dias que sobram depois
  // deles — não é dias ÷ 30, porque os meses têm tamanhos diferentes.
  function mesesEDias(agora, alvo) {
    let meses =
      (alvo.getFullYear() - agora.getFullYear()) * 12 + (alvo.getMonth() - agora.getMonth());
    if (somarMeses(agora, meses) > alvo) meses--;
    const marco = somarMeses(agora, Math.max(0, meses));
    return {
      meses: Math.max(0, meses),
      dias: Math.max(0, Math.floor((alvo - marco) / 864e5)),
    };
  }

  function textoMeses(agora, alvo) {
    const { meses, dias } = mesesEDias(agora, alvo);
    if (meses === 0) return "menos de um mês";
    const m = `${meses} ${meses === 1 ? "mês" : "meses"}`;
    if (dias === 0) return m;
    return `${m} e ${dias} ${dias === 1 ? "dia" : "dias"}`;
  }

  // Quantos dias faltam até o prazo. Compara só as datas, sem as horas,
  // para que "hoje" continue sendo hoje até a meia-noite.
  function diasAte(prazo) {
    if (!prazo) return null;
    const [ano, mes, dia] = String(prazo).split("-").map(Number);
    if (!ano || !mes || !dia) return null;
    const alvo = new Date(ano, mes - 1, dia);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return Math.round((alvo - hoje) / 86400000);
  }

  // "faltam 3 dias", "vence hoje", "2 semanas", "atrasado 5 dias"…
  function prazoTexto(dias, curto) {
    if (dias === null) return "";
    if (dias < 0) {
      const d = Math.abs(dias);
      if (curto) return d === 1 ? "1 dia atrás" : `${d} dias atrás`;
      return d === 1 ? "atrasado 1 dia" : `atrasado ${d} dias`;
    }
    if (dias === 0) return curto ? "hoje" : "vence hoje";
    if (dias === 1) return curto ? "amanhã" : "vence amanhã";
    if (dias < 14) return curto ? `${dias} dias` : `faltam ${dias} dias`;
    if (dias < 60) {
      const semanas = Math.round(dias / 7);
      return curto ? `${semanas} sem.` : `faltam ${semanas} semanas`;
    }
    const meses = Math.round(dias / 30);
    return curto ? `${meses} meses` : `faltam ${meses} meses`;
  }

  // vermelho para o que passou, dourado para o que está chegando
  const prazoClasse = (dias) =>
    dias === null ? "" : dias < 0 ? "prazo-vencido" : dias <= 7 ? "prazo-perto" : "prazo-ok";

  const prazoCurto = (prazo) => {
    const [ano, mes, dia] = String(prazo).split("-");
    return `${dia}/${mes}/${ano.slice(2)}`;
  };

  // etiqueta de prazo usada no checklist e no painel
  function selo(prazo, resolvido, curto) {
    if (!prazo) return "";
    const dias = diasAte(prazo);
    if (dias === null) return "";
    if (resolvido) return `<span class="prazo-selo prazo-feito">${prazoCurto(prazo)}</span>`;
    return `<span class="prazo-selo ${prazoClasse(dias)}" title="Prazo: ${prazoCurto(prazo)}">${escapeHtml(prazoTexto(dias, curto))}</span>`;
  }

  // Ordem alfabética do português: "Ângela" fica junto de "Angela", e
  // maiúscula não muda o lugar. numeric faz "Taça 2" vir antes de "Taça 10".
  const porNome = (campo) => (a, b) =>
    String(a[campo] || "").localeCompare(String(b[campo] || ""), "pt-BR", {
      sensitivity: "base",
      numeric: true,
    });

  // mais urgente primeiro; sem prazo vai para o fim
  const porUrgencia = (a, b) => {
    if (!a.prazo && !b.prazo) return 0;
    if (!a.prazo) return 1;
    if (!b.prazo) return -1;
    return a.prazo < b.prazo ? -1 : a.prazo > b.prazo ? 1 : 0;
  };

  // texto digitado na busca de uma seção, em minúsculas e sem espaços nas pontas
  const termoDe = (secao) => normalizar(busca[secao].trim());

  const combina = (termo, ...campos) =>
    !termo || campos.some((c) => normalizar(c || "").includes(termo));

  // mostra a busca só quando há algo para procurar
  function ajustarBusca(secao, total) {
    $(`#busca-${secao}-wrap`).hidden = total === 0;
  }

  // mensagem de lista vazia: sem nada cadastrado x nada encontrado
  function ajustarVazio(secao, total, visiveis, textoInicial) {
    const el = $(`#${secao}-empty`);
    el.classList.toggle("is-visible", total === 0 || visiveis === 0);
    el.textContent = total === 0 ? textoInicial : "Nada encontrado com essa busca";
  }

  $("#busca-convidados").addEventListener("input", (e) => {
    busca.convidados = e.target.value;
    renderConvidados();
  });

  $("#busca-checklist").addEventListener("input", (e) => {
    busca.checklist = e.target.value;
    renderChecklist();
  });

  $("#busca-padrinhos").addEventListener("input", (e) => {
    busca.padrinhos = e.target.value;
    renderPadrinhos();
  });

  $("#busca-presentes").addEventListener("input", (e) => {
    busca.presentes = e.target.value;
    renderPresentes();
  });

  $("#busca-fornecedores").addEventListener("input", (e) => {
    busca.fornecedores = e.target.value;
    renderFornecedores();
  });

  /* ---------- navegação ---------- */

  /* ---------- transições de tela (View Transitions API) ---------- */

  // Trocar de tela e abrir a foto usam a View Transitions API do navegador:
  // ele tira um retrato do antes e do depois e anima entre os dois no
  // compositor, sem recalcular layout no meio. Onde a API não existe, ou
  // quem pediu menos movimento no sistema, a troca é seca e vale a animação
  // de entrada do CSS, como sempre foi.
  //
  // Tipos: "lateral" (uma aba para outra: só esmaece, sem sugerir
  // profundidade), "avanca"/"volta" (engrenagem e atalhos do início descem
  // um nível e voltam, deslizando) e "foto" (a foto pequena vira a grande).
  const movimentoReduzido = matchMedia("(prefers-reduced-motion: reduce)");
  const temTransicao = () =>
    typeof document.startViewTransition === "function" && !movimentoReduzido.matches;
  if (typeof document.startViewTransition === "function") document.documentElement.classList.add("vt");
  let transicaoEmCurso = null;

  function comTransicao(tipo, mudar) {
    if (!tipo || tipo === "nenhum" || !temTransicao()) {
      mudar();
      return;
    }
    // toque rápido em duas abas: a segunda troca ganha, sem esperar a primeira
    if (transicaoEmCurso) transicaoEmCurso.skipTransition();
    document.documentElement.dataset.transicao = tipo;
    const transicao = document.startViewTransition(mudar);
    transicaoEmCurso = transicao;
    transicao.finished.finally(() => {
      if (transicaoEmCurso !== transicao) return;
      transicaoEmCurso = null;
      delete document.documentElement.dataset.transicao;
    });
  }

  function irPara(view, tipo) {
    const ativa = $(".view.is-active");
    const de = ativa ? ativa.id.replace("view-", "") : "";
    if (de === view) return;
    if (!tipo) tipo = view === "config" ? "avanca" : de === "config" ? "volta" : "lateral";
    comTransicao(tipo, () => {
      $$(".view").forEach((v) => v.classList.remove("is-active"));
      const alvo = $("#view-" + view);
      if (alvo) alvo.classList.add("is-active");
      $$(".nav-item").forEach((b) => b.classList.toggle("is-active", b.dataset.view === view));
      window.scrollTo({ top: 0, behavior: "instant" });
    });
  }

  $$(".nav-item").forEach((btn) => btn.addEventListener("click", () => irPara(btn.dataset.view)));
  // atalhos do início levam para dentro de uma lista: desce um nível
  $$("[data-goto]").forEach((btn) => btn.addEventListener("click", () => irPara(btn.dataset.goto, "avanca")));
  $("#btn-config").addEventListener("click", () => irPara("config"));

  /* ---------- contagem regressiva ---------- */

  function atualizarContagem() {
    const cfg = state.config;
    const cartao = $(".countdown-card");
    if (!cfg.data) {
      ["dias", "horas", "min", "seg"].forEach((u) => ($("#cd-" + u).textContent = "--"));
      $("#countdown-meses").hidden = true;
      $("#countdown-date").textContent = "Toque na engrenagem para configurar a data 💍";
      $(".countdown-label").textContent = "Faltam";
      cartao.classList.remove("is-past");
      return;
    }

    const alvo = new Date(cfg.data);
    const agora = new Date();
    let diff = alvo - agora;

    const dataFmt = alvo.toLocaleDateString("pt-BR", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
    const horaFmt = alvo.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const local = cfg.local.trim() ? " · " + cfg.local.trim() : "";
    $("#countdown-date").textContent = `${dataFmt}, às ${horaFmt}${local}`;

    if (diff <= 0) {
      cartao.classList.add("is-past");
      $(".countdown-label").textContent = diff > -864e5 ? "É hoje! 🎉" : "Felizes para sempre 💛";
      ["dias", "horas", "min", "seg"].forEach((u) => ($("#cd-" + u).textContent = "0"));
      $("#countdown-meses").hidden = true;
      return;
    }

    cartao.classList.remove("is-past");
    $(".countdown-label").textContent = "Faltam";
    const dias = Math.floor(diff / 864e5);
    diff -= dias * 864e5;
    const horas = Math.floor(diff / 36e5);
    diff -= horas * 36e5;
    const min = Math.floor(diff / 6e4);
    diff -= min * 6e4;
    const seg = Math.floor(diff / 1e3);

    const textoDias = String(dias);
    $("#cd-dias").textContent = textoDias;
    // a partir de 4 algarismos o número precisa encolher para caber no quadro
    $("#cd-dias").classList.toggle("longo", textoDias.length > 3);
    $("#cd-horas").textContent = String(horas).padStart(2, "0");
    $("#cd-min").textContent = String(min).padStart(2, "0");
    $("#cd-seg").textContent = String(seg).padStart(2, "0");

    const meses = $("#countdown-meses");
    meses.textContent = textoMeses(agora, alvo);
    meses.hidden = false;
  }

  setInterval(atualizarContagem, 1000);

  /* ---------- cabeçalho ---------- */

  function iniciaisCasal() {
    const { noiva, noivo } = state.config;
    if (!noiva.trim() && !noivo.trim()) return "N&N";
    return `${nomeNoiva()[0].toUpperCase()}&${nomeNoivo()[0].toUpperCase()}`;
  }

  function renderHeader() {
    const { noiva, noivo, data, foto } = state.config;
    const temNomes = noiva.trim() || noivo.trim();
    $("#header-couple").textContent = temNomes ? `${nomeNoiva()} & ${nomeNoivo()}` : "Nosso Casamento";
    const mono = $("#monogram");
    if (foto) {
      mono.innerHTML = `<img src="${escapeAttr(foto)}" alt="Foto do casal">`;
      mono.classList.add("tem-foto");
      mono.setAttribute("aria-label", "Ver foto do casal em tamanho grande");
    } else {
      mono.textContent = iniciaisCasal();
      mono.classList.remove("tem-foto");
      mono.setAttribute("aria-label", "Iniciais do casal");
    }
    $("#header-date").textContent = data
      ? new Date(data).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })
      : "Configure a data do grande dia";

    // rótulos dos lados acompanham os nomes do casal
    $("#lado-a-label").textContent = nomeNoiva();
    $("#lado-b-label").textContent = nomeNoivo();
    $("#seg-lado-a").textContent = nomeNoiva();
    $("#seg-lado-b").textContent = nomeNoivo();
    $("#chip-lado-a").textContent = nomeNoiva();
    $("#chip-lado-b").textContent = nomeNoivo();
  }

  /* ---------- dashboard ---------- */

  function renderDashboard() {
    const conv = state.convidados;
    const totalConvidados = conv.reduce((s, c) => s + totalPessoas(c), 0);
    const confirmados = conv.filter((c) => c.confirmado).reduce((s, c) => s + totalPessoas(c), 0);
    const ladoNoiva = conv.filter((c) => c.lado === "noiva").reduce((s, c) => s + totalPessoas(c), 0);
    const ladoNoivo = conv.filter((c) => c.lado === "noivo").reduce((s, c) => s + totalPessoas(c), 0);

    $("#stat-convidados").textContent = totalConvidados;
    $("#stat-convidados-sub").textContent = `${confirmados} confirmado${confirmados === 1 ? "" : "s"}`;

    const pendentes = state.itens.filter((i) => !i.resolvido);
    const valorPendente = pendentes.reduce((s, i) => s + (i.valor || 0), 0);
    const valorResolvido = state.itens.filter((i) => i.resolvido).reduce((s, i) => s + (i.valor || 0), 0);
    const valorTotal = valorPendente + valorResolvido;

    $("#stat-pendencias").textContent = pendentes.length;
    $("#stat-pendencias-sub").textContent = valorPendente ? brl(valorPendente) : "tudo em dia 🎉";

    $("#stat-padrinhos").textContent = state.padrinhos.length * 2;
    $("#stat-padrinhos-sub").textContent = `${state.padrinhos.length} par${state.padrinhos.length === 1 ? "" : "es"}`;

    $("#stat-fornecedores").textContent = state.fornecedores.length;
    $("#stat-fornecedores-sub").textContent = state.fornecedores.length
      ? "contatos salvos"
      : "nenhum ainda";

    // orçamento
    $("#resumo-orcamento-total").textContent = brl(valorTotal);
    $("#resumo-valor-resolvido").textContent = brl(valorResolvido);
    $("#resumo-valor-pendente").textContent = brl(valorPendente);
    $("#orcamento-progress").style.width = valorTotal ? (valorResolvido / valorTotal) * 100 + "%" : "0%";

    // checklist
    const feitos = state.itens.length - pendentes.length;
    $("#resumo-checklist-frac").textContent = `${feitos}/${state.itens.length}`;
    $("#checklist-progress").style.width = state.itens.length ? (feitos / state.itens.length) * 100 + "%" : "0%";
    $("#cl-feitos").textContent = feitos;
    $("#cl-faltam").textContent = pendentes.length;
    $("#cl-valor-pendente").textContent = brl(valorPendente);

    // as que estão mais perto de vencer aparecem primeiro
    const proximos = [...pendentes].sort(porUrgencia).slice(0, 4);
    const atrasadas = pendentes.filter((i) => {
      const d = diasAte(i.prazo);
      return d !== null && d < 0;
    }).length;

    $("#dash-pendentes-titulo").textContent = atrasadas
      ? `Próximas pendências · ${atrasadas} atrasada${atrasadas === 1 ? "" : "s"}`
      : "Próximas pendências";
    $("#dash-pendentes-titulo").classList.toggle("tem-atraso", atrasadas > 0);
    $("#dash-pendentes-titulo").hidden = state.itens.length === 0;
    $("#dash-pendentes").innerHTML = state.itens.length === 0
      ? `<li><span>Cadastre as tarefas do casamento na aba Checklist ✨</span></li>`
      : proximos.length
        ? proximos
            .map(
              (i) =>
                `<li><span class="mini-nome">${escapeHtml(i.descricao)}</span>` +
                (i.prazo
                  ? selo(i.prazo, false, true)
                  : `<span class="prazo-selo prazo-sem">sem prazo</span>`) +
                (i.valor ? `<span class="mini-valor">${brl(i.valor)}</span>` : "") +
                `</li>`
            )
            .join("")
        : `<li><span>Tudo resolvido — aproveitem o momento 💛</span></li>`;

    // presentes
    const pres = state.presentes;
    const presGanhos = pres.filter((p) => p.status === "ganho").length;
    const presComprados = pres.filter((p) => p.status === "comprado").length;
    const presFaltam = pres.filter((p) => p.status === "falta").length;
    const presTemos = presGanhos + presComprados;
    $("#resumo-presentes-frac").textContent = `${presTemos}/${pres.length}`;
    $("#presentes-progress").style.width = pres.length ? (presTemos / pres.length) * 100 + "%" : "0%";
    $("#stat-presentes").textContent = pres.length;
    $("#stat-presentes-sub").textContent = pres.length
      ? `${presTemos} já ${presTemos === 1 ? "conquistado" : "conquistados"}`
      : "nenhum ainda";
    $("#pr-ganhos").textContent = presGanhos;
    $("#pr-comprados").textContent = presComprados;
    $("#pr-faltam").textContent = presFaltam;

    const faltamItens = pres.filter((p) => p.status === "falta").slice(0, 4);
    $("#dash-presentes-titulo").hidden = pres.length === 0 || presFaltam === 0;
    $("#dash-presentes-faltam").innerHTML = pres.length === 0
      ? `<li><span>Montem a lista do que gostariam de ganhar 🎁</span></li>`
      : presFaltam === 0
        ? `<li><span>Vocês já conquistaram tudo da lista! 🎉</span></li>`
        : faltamItens
            .map(
              (p) =>
                `<li><span>${escapeHtml(p.nome)}</span>` +
                (p.valor ? `<span class="mini-valor">${brl(p.valor)}</span>` : "") +
                `</li>`
            )
            .join("");

    const presValorTotal = pres.reduce((s, p) => s + (p.valor || 0), 0);
    const presValorConquistado = pres.filter((p) => p.status !== "falta").reduce((s, p) => s + (p.valor || 0), 0);
    if (presValorTotal > 0) {
      $("#presentes-valor-legenda").hidden = false;
      $("#pr-valor-conquistado").textContent = brl(presValorConquistado);
      $("#pr-valor-total").textContent = brl(presValorTotal);
    } else {
      $("#presentes-valor-legenda").hidden = true;
    }

    // convidados: totais e confirmações
    $("#resumo-convidados-total").textContent = `${totalConvidados} pessoa${totalConvidados === 1 ? "" : "s"}`;
    $("#cv-pessoas").textContent = totalConvidados;
    $("#cv-confirmados").textContent = confirmados;
    $("#cv-aconfirmar").textContent = totalConvidados - confirmados;
    $("#convidados-progress").style.width = totalConvidados ? (confirmados / totalConvidados) * 100 + "%" : "0%";

    // lados
    $("#resumo-lado-a").textContent = ladoNoiva;
    $("#resumo-lado-b").textContent = ladoNoivo;
    const somaLados = ladoNoiva + ladoNoivo;
    $("#split-noiva").style.width = somaLados ? (ladoNoiva / somaLados) * 100 + "%" : "50%";
    $("#split-noivo").style.width = somaLados ? (ladoNoivo / somaLados) * 100 + "%" : "50%";
  }

  /* ---------- convidados ---------- */

  function renderConvidados() {
    const lista = $("#lista-convidados");
    const conv = state.convidados;

    const termo = termoDe("convidados");
    const filtrados = conv
      .filter((c) => {
        if (filtroConvidados === "noiva" && c.lado !== "noiva") return false;
        if (filtroConvidados === "noivo" && c.lado !== "noivo") return false;
        if (filtroConvidados === "confirmados" && !c.confirmado) return false;
        return combina(termo, c.nome);
      })
      .sort(porNome("nome"));

    lista.innerHTML = filtrados
      .map((c) => {
        if (editandoId === c.id) {
          return `<li class="list-item is-editing" data-id="${c.id}">
            <div class="edit-form">
              <input type="text" class="ed-nome ed-foco" value="${escapeAttr(c.nome)}" maxlength="80" placeholder="Nome do convidado">
              <div class="form-row">
                <div class="seg-control" role="radiogroup" aria-label="Lado">
                  <label><input type="radio" name="ed-lado" value="noiva" ${c.lado === "noiva" ? "checked" : ""}><span>${escapeHtml(nomeNoiva())}</span></label>
                  <label><input type="radio" name="ed-lado" value="noivo" ${c.lado === "noivo" ? "checked" : ""}><span>${escapeHtml(nomeNoivo())}</span></label>
                </div>
                <label class="field-inline">
                  <span>+ acomp.</span>
                  <input type="number" class="ed-acomp" min="0" max="20" value="${c.acompanhantes || 0}">
                </label>
              </div>
              ${acoesEdicao()}
            </div>
          </li>`;
        }
        const pessoas = totalPessoas(c);
        const badge =
          c.lado === "noiva"
            ? `<span class="badge badge-noiva">${escapeHtml(nomeNoiva())}</span>`
            : `<span class="badge badge-noivo">${escapeHtml(nomeNoivo())}</span>`;
        return `<li class="list-item ${c.confirmado ? "is-done" : ""}" data-id="${c.id}">
          <button class="check-toggle ${c.confirmado ? "is-on" : ""}" data-acao="confirmar" aria-label="Confirmar presença" title="Confirmar presença">${iconeCheck}</button>
          <div class="item-main">
            <div class="item-title">${destacar(c.nome, termo)}</div>
            <div class="item-meta">${badge}<span>${pessoas} pessoa${pessoas === 1 ? "" : "s"}${c.acompanhantes ? ` (+${c.acompanhantes} acomp.)` : ""}</span>${seloResposta(c)}</div>
            ${c.recado ? `<div class="recado-convidado">“${escapeHtml(c.recado)}”</div>` : ""}
          </div>
          ${c.codigo ? `<button class="btn-convite" data-acao="convidar" aria-label="Mandar o convite" title="Mandar o convite pelo WhatsApp">${iconeConvite}</button>` : ""}
          ${btnEditar("convidado")}
          <button class="btn-remove" data-acao="remover" aria-label="Remover">${iconeLixeira}</button>
        </li>`;
      })
      .join("");

    ajustarBusca("convidados", conv.length);
    ajustarVazio("convidados", conv.length, filtrados.length, "Adicione o primeiro convidado acima ✨");

    const total = conv.reduce((s, c) => s + totalPessoas(c), 0);
    const confirmados = conv.filter((c) => c.confirmado).reduce((s, c) => s + totalPessoas(c), 0);
    $("#convidados-resumo").textContent = conv.length
      ? `${total} pessoa${total === 1 ? "" : "s"} no total · ${confirmados} confirmada${confirmados === 1 ? "" : "s"}`
      : "Nenhum convidado ainda";
  }

  $("#form-convidado").addEventListener("submit", (e) => {
    e.preventDefault();
    const nome = $("#convidado-nome").value.trim();
    if (!nome) return;
    const lado = document.querySelector('input[name="convidado-lado"]:checked').value;
    const acomp = Math.max(0, Math.min(20, parseInt($("#convidado-acomp").value, 10) || 0));
    state.convidados.push({ id: uid(), nome, lado, acompanhantes: acomp, confirmado: false });
    salvar();
    renderTudo();
    e.target.reset();
    document.querySelector(`input[name="convidado-lado"][value="${lado}"]`).checked = true;
    $("#convidado-nome").focus();
    toast(`${nome} adicionado 🎉`);
  });

  $("#lista-convidados").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-acao]");
    if (!btn) return;
    const id = btn.closest("[data-id]").dataset.id;
    const c = state.convidados.find((x) => x.id === id);
    if (!c) return;
    const acao = btn.dataset.acao;
    if (acao === "convidar") {
      convidarPeloWhatsApp(c);
      return;
    }
    if (acao === "editar") {
      abrirEdicao(id);
      return;
    }
    if (acao === "cancelar") {
      editandoId = "";
      renderConvidados();
      return;
    }
    if (acao === "salvar") {
      const li = btn.closest("[data-id]");
      const nome = li.querySelector(".ed-nome").value.trim();
      if (!nome) {
        toast("O nome não pode ficar vazio");
        return;
      }
      c.nome = nome;
      c.lado = li.querySelector('input[name="ed-lado"]:checked').value;
      c.acompanhantes = Math.max(0, Math.min(20, parseInt(li.querySelector(".ed-acomp").value, 10) || 0));
      editandoId = "";
      salvar();
      renderTudo();
      toast("Convidado atualizado ✅");
      return;
    }
    if (acao === "confirmar") {
      c.confirmado = !c.confirmado;
    } else if (acao === "remover") {
      if (!confirm(`Remover ${c.nome} da lista?`)) return;
      marcarApagados(id);
      state.convidados = state.convidados.filter((x) => x.id !== id);
    }
    salvar();
    renderTudo();
  });

  $("#convidados-filtros").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    filtroConvidados = chip.dataset.filtro;
    $$("#convidados-filtros .chip").forEach((c) => c.classList.toggle("is-active", c === chip));
    renderConvidados();
  });

  /* ---------- checklist ---------- */

  function renderChecklist() {
    const lista = $("#lista-itens");
    const itens = state.itens;

    const termo = termoDe("checklist");
    const filtrados = itens
      .filter((i) => {
        if (filtroChecklist === "pendentes" && i.resolvido) return false;
        if (filtroChecklist === "resolvidos" && !i.resolvido) return false;
        return combina(termo, i.descricao);
      })
      // o que está mais perto de vencer aparece antes; resolvidos vão para o fim
      .sort((a, b) => (a.resolvido === b.resolvido ? porUrgencia(a, b) : a.resolvido ? 1 : -1));

    lista.innerHTML = filtrados
      .map((i) => {
        if (editandoId === i.id) {
          return `<li class="list-item is-editing" data-id="${i.id}">
            <div class="edit-form">
              <input type="text" class="ed-desc ed-foco" value="${escapeAttr(i.descricao)}" maxlength="120" placeholder="O que precisa ser resolvido?">
              <div class="edit-linha">
                <label class="field-inline field-money">
                  <span>R$</span>
                  <input type="text" class="ed-valor" inputmode="decimal" value="${valorParaCampo(i.valor)}" placeholder="0,00">
                </label>
                <label class="field-inline field-prazo">
                  <span>até</span>
                  <input type="date" class="ed-prazo" value="${escapeAttr(i.prazo || "")}">
                </label>
              </div>
              ${acoesEdicao()}
            </div>
          </li>`;
        }
        return `<li class="list-item ${i.resolvido ? "is-done" : ""}" data-id="${i.id}">
          <button class="check-toggle ${i.resolvido ? "is-on" : ""}" data-acao="resolver" aria-label="Marcar como resolvido" title="Marcar como resolvido">${iconeCheck}</button>
          <div class="item-main">
            <div class="item-title">${destacar(i.descricao, termo)}</div>
            ${i.prazo ? `<div class="item-meta">${selo(i.prazo, i.resolvido)}</div>` : ""}
          </div>
          ${i.valor ? `<span class="item-valor">${brl(i.valor)}</span>` : ""}
          ${btnEditar("tarefa")}
          <button class="btn-remove" data-acao="remover" aria-label="Remover">${iconeLixeira}</button>
        </li>`;
      })
      .join("");

    ajustarBusca("checklist", itens.length);
    ajustarVazio("checklist", itens.length, filtrados.length, "Cadastre a primeira tarefa acima ✨");

    const valorTotal = itens.reduce((s, i) => s + (i.valor || 0), 0);
    const valorResolvido = itens.filter((i) => i.resolvido).reduce((s, i) => s + (i.valor || 0), 0);
    $("#total-geral").textContent = brl(valorTotal);
    $("#total-resolvido").textContent = brl(valorResolvido);
    $("#total-pendente").textContent = brl(valorTotal - valorResolvido);

    const feitos = itens.filter((i) => i.resolvido).length;
    $("#checklist-resumo").textContent = itens.length
      ? `${feitos} de ${itens.length} resolvido${itens.length === 1 ? "" : "s"}`
      : "Nenhum item ainda";
  }

  $("#form-item").addEventListener("submit", (e) => {
    e.preventDefault();
    const desc = $("#item-desc").value.trim();
    if (!desc) return;
    const valor = parseValor($("#item-valor").value);
    const prazo = $("#item-prazo").value;
    state.itens.push({ id: uid(), descricao: desc, valor, resolvido: false, prazo });
    salvar();
    renderTudo();
    e.target.reset();
    $("#item-desc").focus();
    toast("Item adicionado ✅");
  });

  $("#lista-itens").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-acao]");
    if (!btn) return;
    const id = btn.closest("[data-id]").dataset.id;
    const item = state.itens.find((x) => x.id === id);
    if (!item) return;
    const acao = btn.dataset.acao;
    if (acao === "editar") {
      abrirEdicao(id);
      return;
    }
    if (acao === "cancelar") {
      editandoId = "";
      renderChecklist();
      return;
    }
    if (acao === "salvar") {
      const li = btn.closest("[data-id]");
      const desc = li.querySelector(".ed-desc").value.trim();
      if (!desc) {
        toast("A descrição não pode ficar vazia");
        return;
      }
      item.descricao = desc;
      item.valor = parseValor(li.querySelector(".ed-valor").value);
      item.prazo = li.querySelector(".ed-prazo").value;
      editandoId = "";
      salvar();
      renderTudo();
      toast("Tarefa atualizada ✅");
      return;
    }
    if (acao === "resolver") {
      item.resolvido = !item.resolvido;
      if (item.resolvido) toast("Resolvido! 🎉");
    } else if (acao === "remover") {
      if (!confirm(`Remover "${item.descricao}"?`)) return;
      marcarApagados(id);
      state.itens = state.itens.filter((x) => x.id !== id);
    }
    salvar();
    renderTudo();
  });

  $("#checklist-filtros").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    filtroChecklist = chip.dataset.filtro;
    $$("#checklist-filtros .chip").forEach((c) => c.classList.toggle("is-active", c === chip));
    renderChecklist();
  });

  /* ---------- padrinhos ---------- */

  function renderPadrinhos() {
    const lista = $("#lista-padrinhos");
    const termo = termoDe("padrinhos");
    // guarda o número original do par para a numeração não mudar na busca
    const filtrados = state.padrinhos
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => combina(termo, p.padrinho, p.madrinha));
    lista.innerHTML = filtrados
      .map(({ p, idx }) => {
        if (editandoId === p.id) {
          return `<li class="pair-item is-editing" data-id="${p.id}">
            <div class="edit-form">
              <div class="form-row form-row-stack">
                <input type="text" class="ed-padrinho ed-foco" value="${escapeAttr(p.padrinho)}" maxlength="80" placeholder="Padrinho">
                <span class="amp">&amp;</span>
                <input type="text" class="ed-madrinha" value="${escapeAttr(p.madrinha)}" maxlength="80" placeholder="Madrinha">
              </div>
              ${acoesEdicao()}
            </div>
          </li>`;
        }
        return `<li class="pair-item" data-id="${p.id}">
          <span class="pair-num">${idx + 1}</span>
          <div class="pair-names">
            <span class="nome">${destacar(p.padrinho, termo)}</span>
            <span class="amp">&amp;</span>
            <span class="nome">${destacar(p.madrinha, termo)}</span>
          </div>
          ${btnEditar("par")}
          <button class="btn-remove" data-acao="remover" aria-label="Remover par">${iconeLixeira}</button>
        </li>`;
      })
      .join("");

    ajustarBusca("padrinhos", state.padrinhos.length);
    ajustarVazio("padrinhos", state.padrinhos.length, filtrados.length, "Adicione o primeiro par acima ✨");

    const n = state.padrinhos.length;
    $("#padrinhos-resumo").textContent = n
      ? `${n} par${n === 1 ? "" : "es"} · ${n * 2} pessoa${n * 2 === 1 ? "" : "s"}`
      : "Nenhum par ainda";
  }

  $("#form-padrinho").addEventListener("submit", (e) => {
    e.preventDefault();
    const padrinho = $("#padrinho-nome").value.trim();
    const madrinha = $("#madrinha-nome").value.trim();
    if (!padrinho || !madrinha) return;
    state.padrinhos.push({ id: uid(), padrinho, madrinha });
    salvar();
    renderTudo();
    e.target.reset();
    $("#padrinho-nome").focus();
    toast("Par adicionado 💛");
  });

  $("#lista-padrinhos").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-acao]");
    if (!btn) return;
    const id = btn.closest("[data-id]").dataset.id;
    const p = state.padrinhos.find((x) => x.id === id);
    if (!p) return;
    const acao = btn.dataset.acao;
    if (acao === "editar") {
      abrirEdicao(id);
      return;
    }
    if (acao === "cancelar") {
      editandoId = "";
      renderPadrinhos();
      return;
    }
    if (acao === "salvar") {
      const li = btn.closest("[data-id]");
      const padrinho = li.querySelector(".ed-padrinho").value.trim();
      const madrinha = li.querySelector(".ed-madrinha").value.trim();
      if (!padrinho || !madrinha) {
        toast("Preencha os dois nomes do par");
        return;
      }
      p.padrinho = padrinho;
      p.madrinha = madrinha;
      editandoId = "";
      salvar();
      renderTudo();
      toast("Par atualizado ✅");
      return;
    }
    if (!confirm(`Remover ${p.padrinho} & ${p.madrinha}?`)) return;
    marcarApagados(id);
    state.padrinhos = state.padrinhos.filter((x) => x.id !== id);
    salvar();
    renderTudo();
  });

  /* ---------- fornecedores ---------- */

  function renderFornecedores() {
    const lista = $("#lista-fornecedores");
    const termo = termoDe("fornecedores");
    const filtrados = state.fornecedores.filter((f) => combina(termo, f.nome, f.categoria, f.contato));
    lista.innerHTML = filtrados
      .map((f) => {
        if (editandoId === f.id) {
          const opcoes = CATEGORIAS_FORNECEDOR.map(
            (cat) => `<option ${cat === f.categoria ? "selected" : ""}>${escapeHtml(cat)}</option>`
          ).join("");
          return `<li class="list-item is-editing" data-id="${f.id}">
            <div class="edit-form">
              <input type="text" class="ed-nome ed-foco" value="${escapeAttr(f.nome)}" maxlength="80" placeholder="Nome do fornecedor">
              <div class="form-row">
                <select class="ed-categoria">${opcoes}</select>
                <input type="tel" class="ed-contato" value="${escapeAttr(f.contato || "")}" maxlength="20" placeholder="WhatsApp / telefone">
              </div>
              ${acoesEdicao()}
            </div>
          </li>`;
        }
        const tel = (f.contato || "").replace(/\D/g, "");
        const linkContato = tel
          ? `<a class="link-contato" href="https://wa.me/55${tel}" target="_blank" rel="noopener">WhatsApp: ${escapeHtml(f.contato)}</a>`
          : "";
        return `<li class="list-item" data-id="${f.id}">
          <div class="item-main">
            <div class="item-title">${destacar(f.nome, termo)}</div>
            <div class="item-meta"><span class="badge badge-cat">${escapeHtml(f.categoria)}</span>${linkContato}</div>
          </div>
          ${btnEditar("fornecedor")}
          <button class="btn-remove" data-acao="remover" aria-label="Remover">${iconeLixeira}</button>
        </li>`;
      })
      .join("");

    ajustarBusca("fornecedores", state.fornecedores.length);
    ajustarVazio("fornecedores", state.fornecedores.length, filtrados.length, "Cadastre o primeiro fornecedor acima ✨");

    const n = state.fornecedores.length;
    $("#fornecedores-resumo").textContent = n
      ? `${n} fornecedor${n === 1 ? "" : "es"} cadastrado${n === 1 ? "" : "s"}`
      : "Nenhum fornecedor ainda";
  }

  $("#form-fornecedor").addEventListener("submit", (e) => {
    e.preventDefault();
    const nome = $("#fornecedor-nome").value.trim();
    if (!nome) return;
    state.fornecedores.push({
      id: uid(),
      nome,
      categoria: $("#fornecedor-categoria").value,
      contato: $("#fornecedor-contato").value.trim(),
    });
    salvar();
    renderTudo();
    e.target.reset();
    $("#fornecedor-nome").focus();
    toast("Fornecedor adicionado 📇");
  });

  $("#lista-fornecedores").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-acao]");
    if (!btn) return;
    const id = btn.closest("[data-id]").dataset.id;
    const f = state.fornecedores.find((x) => x.id === id);
    if (!f) return;
    const acao = btn.dataset.acao;
    if (acao === "editar") {
      abrirEdicao(id);
      return;
    }
    if (acao === "cancelar") {
      editandoId = "";
      renderFornecedores();
      return;
    }
    if (acao === "salvar") {
      const li = btn.closest("[data-id]");
      const nome = li.querySelector(".ed-nome").value.trim();
      if (!nome) {
        toast("O nome não pode ficar vazio");
        return;
      }
      f.nome = nome;
      f.categoria = li.querySelector(".ed-categoria").value;
      f.contato = li.querySelector(".ed-contato").value.trim();
      editandoId = "";
      salvar();
      renderTudo();
      toast("Fornecedor atualizado ✅");
      return;
    }
    if (!confirm(`Remover ${f.nome}?`)) return;
    marcarApagados(id);
    state.fornecedores = state.fornecedores.filter((x) => x.id !== id);
    salvar();
    renderTudo();
  });

  /* ---------- presentes ---------- */

  const CORES_NOTA = ["papel", "rosa", "sage", "dourado", "azul"];

  const ROTULO_STATUS = { falta: "Falta", comprado: "Comprado", ganho: "Ganho" };
  const PROXIMO_STATUS = { falta: "comprado", comprado: "ganho", ganho: "falta" };

  function renderPresentes() {
    const lista = $("#lista-presentes");
    const presentes = state.presentes;

    const termo = termoDe("presentes");
    const filtrados = presentes.filter((p) => {
      if (filtroPresentes === "faltam" && p.status !== "falta") return false;
      if (filtroPresentes === "comprado" && p.status !== "comprado") return false;
      if (filtroPresentes === "ganho" && p.status !== "ganho") return false;
      return combina(termo, p.nome);
    });

    lista.innerHTML = filtrados
      .map((p) => {
        if (editandoId === p.id) {
          return `<li class="list-item is-editing" data-id="${p.id}">
            <div class="edit-form">
              <input type="text" class="ed-nome ed-foco" value="${escapeAttr(p.nome)}" maxlength="100" placeholder="Nome do presente">
              <input type="text" class="ed-link" value="${escapeAttr(p.link || "")}" maxlength="300" inputmode="url" placeholder="Link da loja (opcional)">
              <label class="field-inline field-money">
                <span>R$</span>
                <input type="text" class="ed-valor" inputmode="decimal" value="${valorParaCampo(p.valor)}" placeholder="0,00">
              </label>
              ${acoesEdicao()}
            </div>
          </li>`;
        }
        const pego = p.status !== "falta";
        const link = p.link
          ? `<a class="link-contato" href="${escapeAttr(p.link)}" target="_blank" rel="noopener">ver loja ↗</a>`
          : "";
        const valor = p.valor ? `<span>${brl(p.valor)}</span>` : "";
        const meta = valor || link ? `<div class="item-meta">${valor}${link}</div>` : "";
        return `<li class="list-item ${pego ? "pego" : ""}" data-id="${p.id}">
          <button class="present-status st-${p.status}" data-acao="status" aria-label="Mudar situação" title="Toque para mudar">${ROTULO_STATUS[p.status]}</button>
          <div class="item-main">
            <div class="item-title">${destacar(p.nome, termo)}</div>
            ${meta}
          </div>
          ${btnEditar("presente")}
          <button class="btn-remove" data-acao="remover" aria-label="Remover">${iconeLixeira}</button>
        </li>`;
      })
      .join("");

    ajustarBusca("presentes", presentes.length);
    ajustarVazio("presentes", presentes.length, filtrados.length, "Adicione o primeiro presente acima ✨");

    const temos = presentes.filter((p) => p.status !== "falta").length;
    $("#presentes-total").textContent = presentes.length;
    $("#presentes-temos").textContent = temos;
    $("#presentes-faltam").textContent = presentes.length - temos;
    $("#presentes-resumo").textContent = presentes.length
      ? `${temos} de ${presentes.length} já ${temos === 1 ? "conquistado" : "conquistados"}`
      : "Nenhum presente ainda";
  }

  $("#form-presente").addEventListener("submit", (e) => {
    e.preventDefault();
    const nome = $("#presente-nome").value.trim();
    if (!nome) return;
    state.presentes.push({
      id: uid(),
      nome,
      valor: parseValor($("#presente-valor").value),
      link: normalizarLink($("#presente-link").value),
      status: "falta",
    });
    salvar();
    renderTudo();
    e.target.reset();
    $("#presente-nome").focus();
    toast("Presente adicionado 🎁");
  });

  $("#lista-presentes").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-acao]");
    if (!btn) return;
    const id = btn.closest("[data-id]").dataset.id;
    const p = state.presentes.find((x) => x.id === id);
    if (!p) return;
    const acao = btn.dataset.acao;
    if (acao === "editar") {
      abrirEdicao(id);
      return;
    }
    if (acao === "cancelar") {
      editandoId = "";
      renderPresentes();
      return;
    }
    if (acao === "salvar") {
      const li = btn.closest("[data-id]");
      const nome = li.querySelector(".ed-nome").value.trim();
      if (!nome) {
        toast("O nome não pode ficar vazio");
        return;
      }
      p.nome = nome;
      p.link = normalizarLink(li.querySelector(".ed-link").value);
      p.valor = parseValor(li.querySelector(".ed-valor").value);
      editandoId = "";
      salvar();
      renderTudo();
      toast("Presente atualizado ✅");
      return;
    }
    if (acao === "status") {
      p.status = PROXIMO_STATUS[p.status] || "falta";
      if (p.status === "comprado") toast("Marcado como comprado 🛒");
      else if (p.status === "ganho") toast("Que presente! 🎁💛");
    } else if (acao === "remover") {
      if (!confirm(`Remover "${p.nome}" da lista?`)) return;
      marcarApagados(id);
      state.presentes = state.presentes.filter((x) => x.id !== id);
    }
    salvar();
    renderTudo();
  });

  $("#presentes-filtros").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    filtroPresentes = chip.dataset.filtro;
    $$("#presentes-filtros .chip").forEach((c) => c.classList.toggle("is-active", c === chip));
    renderPresentes();
  });

  /* ---------- bloco de anotações ---------- */

  const iconeFixar =
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l-.7 5.2 3 2.6V14H6.7v-2.2l3-2.6z"/><path d="M12 14v6"/></svg>';
  const iconeEditar =
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14.5 7.5 2.9 2.9"/></svg>';
  const iconeCompartilhar =
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5.5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="18.5" r="2.6"/><path d="m8.4 10.7 7.2-3.9M8.4 13.3l7.2 3.9"/></svg>';

  function tempoRelativo(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const min = Math.floor(Math.max(0, Date.now() - d.getTime()) / 6e4);
    if (min < 1) return "agora mesmo";
    if (min < 60) return `há ${min} min`;
    const horas = Math.floor(min / 60);
    if (horas < 24) return `há ${horas} h`;
    const dias = Math.floor(horas / 24);
    if (dias === 1) return "ontem";
    if (dias < 7) return `há ${dias} dias`;
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  }

  // cor estável por autor, para o avatar da inicial
  function corDoAutor(nome) {
    const paleta = ["#7d9070", "#c98a80", "#b3892e", "#6e85a0", "#8a7ba8", "#a8735a"];
    let h = 0;
    for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
    return paleta[h % paleta.length];
  }

  const autorAtual = () => usuarioLogado || "nós";

  // marca no texto original os trechos que casam com o termo (sem acentos)
  function destacar(texto, termo) {
    const original = String(texto ?? "");
    const alvo = normalizar(termo || "").trim();
    if (!alvo) return escapeHtml(original);
    const base = normalizar(original);
    let saida = "";
    let de = 0;
    let achou = base.indexOf(alvo, de);
    while (achou !== -1) {
      saida +=
        escapeHtml(original.slice(de, achou)) +
        `<mark>${escapeHtml(original.slice(achou, achou + alvo.length))}</mark>`;
      de = achou + alvo.length;
      achou = base.indexOf(alvo, de);
    }
    return saida + escapeHtml(original.slice(de));
  }

  function notasOrdenadas() {
    return [...state.notas].sort((a, b) => {
      if (Boolean(a.fixada) !== Boolean(b.fixada)) return a.fixada ? -1 : 1;
      return String(b.criadoEm || "").localeCompare(String(a.criadoEm || ""));
    });
  }

  function renderFiltrosNotas() {
    const autores = [...new Set(state.notas.map((n) => n.autor).filter(Boolean))];
    const box = $("#notas-filtros");
    box.hidden = autores.length < 2;
    if (autores.length < 2) {
      box.innerHTML = "";
      filtroNotaAutor = "todos";
      return;
    }
    if (filtroNotaAutor !== "todos" && !autores.includes(filtroNotaAutor)) filtroNotaAutor = "todos";
    box.innerHTML =
      `<button class="chip ${filtroNotaAutor === "todos" ? "is-active" : ""}" data-autor="todos">Todos</button>` +
      autores
        .map(
          (a) =>
            `<button class="chip ${filtroNotaAutor === a ? "is-active" : ""}" data-autor="${escapeAttr(a)}">${escapeHtml(a)}</button>`
        )
        .join("");
  }

  function htmlNota(n, opts = {}) {
    const cor = CORES_NOTA.includes(n.cor) ? n.cor : "papel";
    const autor = n.autor || "nós";
    const editando = !opts.compacta && notaEditando === n.id;
    const corpo = editando
      ? `<div class="nota-edicao">
          <textarea id="nota-edit-campo" maxlength="1000">${escapeHtml(n.texto)}</textarea>
          <div class="nota-edicao-acoes">
            <button type="button" class="btn-secondary" data-acao="cancelar">Cancelar</button>
            <button type="button" class="btn-primary" data-acao="salvar">Salvar</button>
          </div>
        </div>`
      : `<p class="nota-texto">${destacar(n.texto, opts.compacta ? "" : buscaNotas)}</p>`;
    const acoes = opts.compacta
      ? ""
      : `<div class="nota-acoes">
          <button class="nota-btn ${n.fixada ? "is-on" : ""}" data-acao="fixar" aria-label="${n.fixada ? "Desafixar" : "Fixar no topo"}" title="${n.fixada ? "Desafixar" : "Fixar no topo"}">${iconeFixar}</button>
          <button class="nota-btn" data-acao="editar" aria-label="Editar" title="Editar">${iconeEditar}</button>
          <button class="nota-btn" data-acao="compartilhar" aria-label="Compartilhar" title="Compartilhar">${iconeCompartilhar}</button>
          <button class="nota-btn btn-apagar" data-acao="apagar" aria-label="Apagar" title="Apagar">${iconeLixeira}</button>
        </div>`;
    const rodape = `<div class="nota-rodape">
        <span>${tempoRelativo(n.criadoEm)}</span>
        ${n.editadoEm ? '<span class="nota-editado">· editada</span>' : ""}
        ${n.fixada && !opts.compacta ? '<span class="nota-fixa-tag">fixada</span>' : ""}
      </div>`;
    return `<article class="nota n-${cor} ${n.fixada ? "fixada" : ""}" data-id="${n.id}">
      <div class="nota-topo">
        <span class="nota-autor">
          <i class="nota-avatar" style="background:${corDoAutor(autor)}">${escapeHtml(autor[0].toUpperCase())}</i>
          <span class="nota-nome">${escapeHtml(autor)}</span>
        </span>
        ${acoes}
      </div>
      ${corpo}
      ${rodape}
    </article>`;
  }

  function renderNotas() {
    const todas = notasOrdenadas();
    const termo = normalizar(buscaNotas.trim());
    const filtradas = todas.filter((n) => {
      if (filtroNotaAutor !== "todos" && n.autor !== filtroNotaAutor) return false;
      if (termo && !normalizar(n.texto).includes(termo)) return false;
      return true;
    });

    renderFiltrosNotas();
    $("#lista-notas").innerHTML = filtradas.map((n) => htmlNota(n)).join("");

    const vazioGeral = state.notas.length === 0;
    const empty = $("#notas-empty");
    empty.classList.toggle("is-visible", vazioGeral || filtradas.length === 0);
    empty.textContent = vazioGeral
      ? "Escreva a primeira anotação de vocês ✨"
      : "Nenhuma anotação encontrada com esse filtro";

    const n = state.notas.length;
    const fixadas = state.notas.filter((x) => x.fixada).length;
    $("#notas-resumo").textContent = n
      ? `${n} ${n === 1 ? "anotação" : "anotações"}${fixadas ? ` · ${fixadas} fixada${fixadas === 1 ? "" : "s"}` : ""}`
      : "Nenhuma anotação ainda";

    // card do dashboard com a anotação mais recente
    const card = $("#card-notas");
    card.hidden = n === 0;
    $("#resumo-notas-total").textContent = n ? `${n} no total` : "0";
    if (n) $("#dash-nota-recente").innerHTML = htmlNota(todas[0], { compacta: true });
  }

  $("#form-nota").addEventListener("submit", (e) => {
    e.preventDefault();
    const texto = $("#nota-texto").value.trim();
    if (!texto) return;
    const cor = document.querySelector('input[name="nota-cor"]:checked').value;
    state.notas.push({
      id: uid(),
      texto,
      cor,
      autor: autorAtual(),
      fixada: false,
      criadoEm: new Date().toISOString(),
      editadoEm: "",
    });
    salvar();
    renderTudo();
    $("#nota-texto").value = "";
    $("#nota-texto").focus();
    toast("Anotação salva 📝");
  });

  $("#notas-busca").addEventListener("input", (e) => {
    buscaNotas = e.target.value;
    renderNotas();
  });

  $("#notas-filtros").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    filtroNotaAutor = chip.dataset.autor;
    renderNotas();
  });

  $("#lista-notas").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-acao]");
    if (!btn) return;
    const artigo = btn.closest("[data-id]");
    const nota = state.notas.find((x) => x.id === artigo.dataset.id);
    if (!nota) return;
    const acao = btn.dataset.acao;

    if (acao === "fixar") {
      nota.fixada = !nota.fixada;
      salvar();
      renderTudo();
      toast(nota.fixada ? "Fixada no topo 📌" : "Desafixada");
    } else if (acao === "editar") {
      notaEditando = nota.id;
      renderNotas();
      const campo = $("#nota-edit-campo");
      if (campo) {
        campo.focus();
        campo.setSelectionRange(campo.value.length, campo.value.length);
      }
    } else if (acao === "cancelar") {
      notaEditando = "";
      renderNotas();
    } else if (acao === "salvar") {
      const campo = $("#nota-edit-campo");
      const novo = campo ? campo.value.trim() : "";
      if (!novo) {
        toast("A anotação não pode ficar vazia");
        return;
      }
      if (novo !== nota.texto) {
        nota.texto = novo;
        nota.editadoEm = new Date().toISOString();
      }
      notaEditando = "";
      salvar();
      renderTudo();
      toast("Anotação atualizada ✅");
    } else if (acao === "compartilhar") {
      const mensagem = `📝 ${nota.texto}\n— ${nota.autor || "nós"} · Nosso Casamento`;
      if (navigator.share) {
        navigator.share({ text: mensagem }).catch(() => {});
      } else {
        window.open("https://wa.me/?text=" + encodeURIComponent(mensagem), "_blank", "noopener");
      }
    } else if (acao === "apagar") {
      if (!confirm("Apagar esta anotação?")) return;
      marcarApagados(nota.id);
      state.notas = state.notas.filter((x) => x.id !== nota.id);
      if (notaEditando === nota.id) notaEditando = "";
      salvar();
      renderTudo();
      toast("Anotação apagada");
    }
  });

  /* ---------- configurações ---------- */

  function preencherConfig() {
    $("#config-noiva").value = state.config.noiva;
    $("#config-noivo").value = state.config.noivo;
    $("#config-data").value = state.config.data;
    $("#config-local").value = state.config.local;
    atualizarPreviewFoto();
  }

  function atualizarPreviewFoto() {
    const preview = $("#config-foto-preview");
    const foto = state.config.foto;
    if (foto) {
      preview.style.backgroundImage = `url("${foto}")`;
      preview.textContent = "";
      $("#btn-remover-foto").hidden = false;
      $("#btn-escolher-foto").textContent = "Trocar foto";
    } else {
      preview.style.backgroundImage = "";
      preview.textContent = iniciaisCasal();
      $("#btn-remover-foto").hidden = true;
      $("#btn-escolher-foto").textContent = "Escolher foto";
    }
  }

  $("#form-config").addEventListener("submit", (e) => {
    e.preventDefault();
    state.config.noiva = $("#config-noiva").value.trim();
    state.config.noivo = $("#config-noivo").value.trim();
    state.config.data = $("#config-data").value;
    state.config.local = $("#config-local").value.trim();
    salvar();
    renderTudo();
    toast("Configurações salvas 💾");
    irPara("dashboard");
  });

  /* ---------- foto do casal ---------- */

  // Reduz a imagem para caber com folga no estado sincronizado (limite ~512KB).
  // A foto viaja dentro do estado, então tem orçamento de tamanho. Em vez de
  // fixar um lado pequeno, tenta o maior que caiba: começa grande e só desce
  // quando o arquivo passa do limite. Assim ela fica nítida ao ser expandida
  // sem inchar a sincronização.
  const FOTO_LIMITE = 240000; // caracteres do endereço de dados
  const FOTO_TENTATIVAS = [
    { lado: 1100, qualidade: 0.82 },
    { lado: 1100, qualidade: 0.7 },
    { lado: 900, qualidade: 0.72 },
    { lado: 750, qualidade: 0.7 },
    { lado: 600, qualidade: 0.68 },
    { lado: 460, qualidade: 0.66 },
  ];

  function lerFotoReduzida(arquivo, cb) {
    const leitor = new FileReader();
    leitor.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        let ultima = null;
        for (const { lado, qualidade } of FOTO_TENTATIVAS) {
          const escala = Math.min(1, lado / Math.max(img.width, img.height));
          canvas.width = Math.max(1, Math.round(img.width * escala));
          canvas.height = Math.max(1, Math.round(img.height * escala));
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          let url;
          try {
            url = canvas.toDataURL("image/jpeg", qualidade);
          } catch {
            cb(null);
            return;
          }
          ultima = url;
          if (url.length <= FOTO_LIMITE) break;
        }
        cb(ultima);
      };
      img.onerror = () => cb(null);
      img.src = leitor.result;
    };
    leitor.onerror = () => cb(null);
    leitor.readAsDataURL(arquivo);
  }


  $("#btn-escolher-foto").addEventListener("click", () => $("#input-foto").click());

  $("#input-foto").addEventListener("change", (e) => {
    const arquivo = e.target.files[0];
    e.target.value = "";
    if (!arquivo) return;
    if (!arquivo.type.startsWith("image/")) {
      toast("Escolha um arquivo de imagem");
      return;
    }
    lerFotoReduzida(arquivo, (dataUrl) => {
      if (!dataUrl) {
        toast("Não foi possível usar essa imagem 😢");
        return;
      }
      state.config.foto = dataUrl;
      salvar();
      atualizarPreviewFoto();
      renderHeader();
      toast("Foto do casal atualizada 📸");
    });
  });

  $("#btn-remover-foto").addEventListener("click", () => {
    state.config.foto = "";
    salvar();
    atualizarPreviewFoto();
    renderHeader();
    toast("Foto removida");
  });

  $("#btn-exportar").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const hoje = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `casamento-backup-${hoje}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Backup exportado 📦");
  });

  $("#btn-importar").addEventListener("click", () => $("#input-importar").click());

  $("#input-importar").addEventListener("change", (e) => {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    const leitor = new FileReader();
    leitor.onload = () => {
      try {
        const dados = JSON.parse(leitor.result);
        if (!dados || typeof dados !== "object" || !("config" in dados)) {
          throw new Error("formato inválido");
        }
        if (!confirm("Importar este backup? Os dados atuais serão substituídos.")) return;
        state = { ...estadoInicial(), ...dados, config: { ...estadoInicial().config, ...dados.config } };
        salvar();
        preencherConfig();
        renderTudo();
        toast("Backup importado ✅");
      } catch {
        toast("Arquivo de backup inválido 😢");
      }
      e.target.value = "";
    };
    leitor.readAsText(arquivo);
  });

  $("#btn-limpar").addEventListener("click", () => {
    if (!confirm("Apagar TODOS os dados deste aparelho? Essa ação não pode ser desfeita.")) return;
    if (!confirm("Tem certeza mesmo? Considere exportar um backup antes.")) return;
    marcarApagados(LISTAS.flatMap((lista) => (state[lista] || []).map((item) => item.id)));
    const apagados = state.apagados;
    state = estadoInicial();
    state.apagados = apagados;
    salvar();
    preencherConfig();
    renderTudo();
    toast("Dados apagados");
  });

  /* ---------- sincronização entre celulares (Supabase) ---------- */

  let casal = "";
  try { casal = localStorage.getItem(CASAL_KEY) || ""; } catch {}
  let token = "";
  try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch {}

  // O que o servidor precisa para saber quem está pedindo. O código do casal
  // só vai enquanto o aparelho ainda não tiver recebido um bilhete.
  const credencial = () => ({ versao: VERSAO_APP, ...(token ? { token } : { casal }) });

  // Vale tanto o bilhete novo quanto o código antigo, enquanto a transição durar.
  const temSessao = () => Boolean(token || casal);

  // O servidor renova o bilhete sozinho quando está perto de vencer.
  function guardarToken(novo) {
    if (!novo || novo === token) return;
    token = novo;
    try { localStorage.setItem(TOKEN_KEY, novo); } catch {}
  }
  let syncTimer;
  let syncPendente = false;   // um envio falhou; há mudanças locais não salvas
  let envioPendente = false;  // há um envio agendado (debounce) esperando
  let enviando = false;       // há um envio em voo, esperando resposta
  let reenviar = false;       // mudou algo durante o envio: manda de novo
  let revisaoLocal = 0;       // sobe a cada alteração feita neste aparelho

  // Compara dois estados sem depender da ordem dos itens nem da ordem das
  // chaves de cada item: o servidor devolve as duas em ordem própria, e sem
  // isto o app se achava desatualizado a cada resposta e redesenhava à toa.
  const impressao = (item) =>
    item && typeof item === "object"
      ? JSON.stringify(item, Object.keys(item).sort())
      : JSON.stringify(item);
  const impressaoLista = (lista) => (lista || []).map(impressao).sort().join("|");
  // config e convite são objetos únicos, não listas de cadastros
  const OBJETOS = ["config", "convite"];

  const estadosDiferem = (a, b) =>
    LISTAS.some((lista) => impressaoLista(a[lista]) !== impressaoLista(b[lista])) ||
    OBJETOS.some((o) => impressao(a[o] || {}) !== impressao(b[o] || {}));

  // Última versão que sabemos estar no servidor. Serve de referência para
  // descobrir o que mudou aqui — e é sempre a resposta do servidor, nunca o
  // que julgamos ter mandado, para refletir qualquer ajuste que ele faça.
  //
  // Fica guardada no aparelho: sem ela, ao reabrir o app não há como saber o
  // que foi alterado aqui e o que só está velho porque o outro celular mudou.
  let baseSincronizada = null;
  try {
    const raw = localStorage.getItem(BASE_KEY);
    if (raw) baseSincronizada = JSON.parse(raw);
  } catch {}

  const copiar = (o) => JSON.parse(JSON.stringify(o));

  function guardarBase(nuvem) {
    baseSincronizada = nuvem ? copiar(nuvem) : null;
    try {
      if (baseSincronizada) localStorage.setItem(BASE_KEY, JSON.stringify(baseSincronizada));
      else localStorage.removeItem(BASE_KEY);
    } catch {}
  }

  // Junta o que veio do servidor com o formato padrão. config e convite são
  // objetos (não listas), então precisam ser mesclados campo a campo — senão
  // um objeto vazio vindo da nuvem apagaria os campos que o app espera.
  function comoEstado(nuvem) {
    const base = estadoInicial();
    return {
      ...base,
      ...nuvem,
      config: { ...base.config, ...(nuvem.config || {}) },
      convite: { ...base.convite, ...(nuvem.convite || {}) },
    };
  }

  // Manda só o que mudou neste aparelho.
  //
  // Antes ia o cadastro inteiro a cada salvamento, inclusive os registros que
  // este celular nem tocou — e eles sobrescreviam o que o outro celular tinha
  // acabado de alterar. Com dois ou três aparelhos abertos, quem salvasse por
  // último desfazia a alteração do outro.
  //
  // O servidor grava o que chega e não apaga o que não veio, então enviar só
  // a diferença é seguro: cada aparelho mexe apenas no que ele mesmo mudou.
  //
  // Sem base não há diferença a calcular — e mandar o cadastro inteiro nessa
  // hora foi o que apagou alterações da Rayane: a cópia velha deste celular
  // passava por cima do que ela tinha mudado. Quem chama busca primeiro.
  function estadoParaEnviar() {
    return baseSincronizada ? diferenca(state, baseSincronizada) : null;
  }

  // Os cadastros de `atual` que não estão iguais em `base`, mais os apagados.
  function diferenca(atual, base) {
    const saida = { apagados: atual.apagados || [] };
    for (const o of OBJETOS) {
      if (impressao(atual[o] || {}) !== impressao(base[o] || {})) saida[o] = atual[o];
    }
    for (const lista of LISTAS) {
      const antes = new Map((base[lista] || []).map((x) => [x.id, impressao(x)]));
      const mudados = (atual[lista] || []).filter((x) => antes.get(x.id) !== impressao(x));
      if (mudados.length) saida[lista] = mudados;
    }
    return saida;
  }
  let ultimoAtualizadoEm = null; // carimbo da última versão vista da nuvem

  async function api(corpo) {
    // text/plain evita preflight de CORS; o servidor interpreta como JSON
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(corpo),
    });
    let dados = null;
    try { dados = await resp.json(); } catch {}
    if (!resp.ok) {
      const erro = new Error((dados && dados.erro) || "HTTP " + resp.status);
      erro.status = resp.status;
      erro.aviso = dados && dados.erro;
      // sessão vencida ou cancelada: volta para a tela de entrada
      if (resp.status === 401) sessaoCaiu();
      // o servidor não grava mais desta versão: procura a nova
      if (resp.status === 426) atualizacaoObrigatoria();
      throw erro;
    }
    if (dados && dados.token) guardarToken(dados.token);
    if (dados && dados.canal) conectarTempoReal(dados.canal);
    return dados;
  }

  function agendarEnvio() {
    if (!temSessao()) return;
    envioPendente = true;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(enviarAgora, 1200);
  }

  // Toma a resposta do servidor como a nova referência e, se ela trouxe
  // novidade, põe na tela. As duas coisas andam sempre juntas: se a base
  // avançasse e a tela não, o envio seguinte veria como "alteração daqui"
  // tudo o que o outro celular mudou — e mandaria a cópia velha por cima.
  function adotarNuvem(r, comAviso) {
    const nuvem = comoEstado(r.estado || {});
    if (r.atualizado_em) ultimoAtualizadoEm = r.atualizado_em;
    guardarBase(nuvem);
    if (!estadosDiferem(nuvem, state)) return false;
    state = nuvem;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
    preencherConfig();
    renderTudo();
    if (comAviso) toast("Atualizado ✨");
    return true;
  }

  async function enviarAgora() {
    if (!temSessao()) return;
    // um envio de cada vez: dois em voo podem chegar fora de ordem e a
    // resposta mais velha desfazer a alteração mais nova
    if (enviando) {
      reenviar = true;
      return;
    }
    // sem referência do que o servidor tem, não dá para saber o que mudou
    // aqui: busca primeiro, nunca manda o cadastro inteiro às cegas
    if (!baseSincronizada) return sincronizarAoAbrir();
    clearTimeout(syncTimer);
    enviando = true;
    envioPendente = false;
    const revisaoEnviada = revisaoLocal;
    try {
      const r = await api({ op: "salvar", ...credencial(), estado: estadoParaEnviar() });

      // Se alguém mexeu no app enquanto a resposta vinha, o que está aqui é
      // mais novo do que o que o servidor devolveu. Aplicar a resposta agora
      // desfaria essa alteração — e o envio seguinte gravaria o desfazimento.
      // Então mantém o que temos (base inclusive) e manda de novo.
      const mudouDurante = revisaoLocal !== revisaoEnviada;
      if (mudouDurante) {
        reenviar = true;
      } else if (r && r.estado && !editandoId && !notaEditando) {
        // o servidor devolve tudo somado (o nosso + o que o outro celular
        // cadastrou): aplica só se realmente trouxe novidade
        adotarNuvem(r, false);
      }
      syncPendente = false;
    } catch (e) {
      if (e.status === 404) {
        guardarCasal("", "");
        toast("A conta foi desconectada; entre novamente.");
      } else {
        // não deu para gravar agora: fica marcado e o app tenta de novo
        syncPendente = true;
      }
    } finally {
      enviando = false;
    }
    renderSync();
    if (reenviar) {
      reenviar = false;
      agendarEnvio();
    }
  }

  // Verifica a nuvem periodicamente e aplica se o OUTRO celular mudou algo.
  // Não sobrescreve enquanto há edição local pendente. Só o formulário de
  // configurações é preenchido de volta, então apenas ele bloqueia a
  // atualização — os campos de cadastro e de busca não atrapalham (antes
  // qualquer campo em foco travava a sincronização, e o app deixa o cursor
  // no campo de nome logo depois de cadastrar alguém).
  async function puxarSeMudou() {
    if (!temSessao() || enviando || envioPendente || syncPendente) return;
    if (!baseSincronizada) return sincronizarAoAbrir();
    if (editandoId || notaEditando) return; // não sobrescreve algo sendo editado
    if (document.visibilityState !== "visible") return;
    const ativo = document.activeElement;
    // formulários que o app preenche de volta: não sobrescreve enquanto
    // alguém está digitando neles
    if (ativo && ativo.closest && ativo.closest("#form-config, #card-convite")) return;
    try {
      const revisaoAoBuscar = revisaoLocal;
      const r = await api({ op: "estado", ...credencial() });
      if (!r || !r.atualizado_em || r.atualizado_em === ultimoAtualizadoEm) return;
      // Reconfirma que nada mudou aqui durante a busca. Se mudou, o nosso é
      // mais novo: não sobrescreve, deixa o envio levar a alteração.
      if (revisaoLocal !== revisaoAoBuscar) return;
      if (enviando || envioPendente || syncPendente) return;
      if (editandoId || notaEditando) return;
      adotarNuvem(r, true);
    } catch {}
  }

  setInterval(() => {
    // Um envio que falhou (rede caiu no meio) ficava esperando a próxima
    // alteração para ser tentado de novo — podia ficar parado para sempre.
    if (syncPendente && !enviando) {
      enviarAgora();
      return;
    }
    puxarSeMudou();
  }, 7000);

  /* ---------- tempo real ---------- */

  // O servidor avisa por um canal do Realtime sempre que alguém do casal
  // grava algo (ou um convidado confirma presença). O aviso não traz dado
  // nenhum — só "mudou" — e o app busca na hora pela API, com a sessão.
  // A verificação a cada 7 s continua como rede de segurança.
  //
  // Conversa direto com o protocolo do Realtime (Phoenix): entrar no canal,
  // bater o coração a cada 25 s, ouvir as mensagens. Sem biblioteca.
  //
  // A chave abaixo é a chave pública do projeto: serve só para abrir a
  // conexão. As tabelas têm RLS sem policies, então ela não lê nada.
  const CHAVE_PUBLICA = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJneGttbnRwZGJ2dnFjd2tzcndsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMTQ1MDQsImV4cCI6MjEwMjg5MDUwNH0.a_4i1ZTKiEKQoBpLsSOSyd5rBCLlixS6YLKlNHxiW_w";
  const TEMPO_REAL_URL = "wss://rgxkmntpdbvvqcwksrwl.supabase.co/realtime/v1/websocket?apikey=" + CHAVE_PUBLICA + "&vsn=1.0.0";
  let canalAtual = "";
  let conexao = null;
  let aoVivo = false;         // entrou no canal e está ouvindo
  let batimento = null;
  let refMensagem = 0;
  let tentativasConexao = 0;
  let religar = null;

  function mandarAoCanal(topic, event, payload) {
    if (!conexao || conexao.readyState !== 1) return;
    refMensagem++;
    try { conexao.send(JSON.stringify({ topic, event, payload, ref: String(refMensagem) })); } catch {}
  }

  function conectarTempoReal(canal) {
    if (!canal || !temSessao() || typeof WebSocket === "undefined") return;
    // já conectado (ou conectando) neste canal: nada a fazer
    if (canal === canalAtual && conexao && conexao.readyState <= 1) return;
    desconectarTempoReal();
    canalAtual = canal;
    let ws;
    try { ws = new WebSocket(TEMPO_REAL_URL); } catch { return; }
    conexao = ws;
    ws.onopen = () => {
      if (conexao !== ws) return;
      mandarAoCanal("realtime:" + canal, "phx_join", {
        config: { broadcast: { self: false, ack: false }, presence: { key: "" }, postgres_changes: [], private: false },
      });
      batimento = setInterval(() => mandarAoCanal("phoenix", "heartbeat", {}), 25000);
    };
    ws.onmessage = (e) => {
      if (conexao !== ws) return;
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.event === "phx_reply" && m.topic === "realtime:" + canal) {
        const ok = m.payload && m.payload.status === "ok";
        if (ok !== aoVivo) { aoVivo = ok; renderSync(); }
        if (ok) tentativasConexao = 0;
        return;
      }
      if (m.event === "broadcast" && m.payload && m.payload.event === "mudou") {
        // alguém gravou: busca agora em vez de esperar o próximo ciclo
        puxarSeMudou();
      }
    };
    ws.onclose = () => {
      if (conexao !== ws) return;
      clearInterval(batimento);
      conexao = null;
      if (aoVivo) { aoVivo = false; renderSync(); }
      // tenta de novo, esperando cada vez mais (1 s, 2 s, 4 s… até 30 s)
      const espera = Math.min(30000, 1000 * 2 ** Math.min(tentativasConexao++, 5));
      clearTimeout(religar);
      religar = setTimeout(() => conectarTempoReal(canalAtual), espera);
    };
    ws.onerror = () => {};
  }

  function desconectarTempoReal() {
    clearTimeout(religar);
    clearInterval(batimento);
    if (aoVivo) { aoVivo = false; renderSync(); }
    if (conexao) {
      const ws = conexao;
      conexao = null;
      try { ws.close(); } catch {}
    }
  }

  // ao voltar para o app (ou a rede voltar), religa se a conexão caiu
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && canalAtual && !conexao) {
      tentativasConexao = 0;
      conectarTempoReal(canalAtual);
    }
  });
  window.addEventListener("online", () => {
    if (canalAtual && !conexao) { tentativasConexao = 0; conectarTempoReal(canalAtual); }
  });

  function guardarCasal(codigo, bilhete) {
    casal = codigo;
    try {
      if (codigo) localStorage.setItem(CASAL_KEY, codigo);
      else localStorage.removeItem(CASAL_KEY);
    } catch {}
    if (!codigo) {
      guardarBase(null);
      canalAtual = "";
      desconectarTempoReal();
    }
    if (bilhete !== undefined) {
      token = bilhete || "";
      try {
        if (token) localStorage.setItem(TOKEN_KEY, token);
        else localStorage.removeItem(TOKEN_KEY);
      } catch {}
    }
    renderSync();
  }

  // A sessão venceu ou foi cancelada em outro aparelho: pede login de novo,
  // sem apagar o que está guardado aqui.
  let avisandoSessao = false;
  function sessaoCaiu() {
    if (!token && !casal) return;
    guardarCasal("", "");
    if (avisandoSessao) return;
    avisandoSessao = true;
    setTimeout(() => {
      renderLogin();
      toast("Sua sessão expirou. Entre de novo 🔒");
      avisandoSessao = false;
    }, 0);
  }

  function renderSync() {
    $("#conta-usuario").textContent = usuarioLogado || "—";
    $("#conta-codigo").value = casal || "";
    const status = $("#sync-status");
    if (!temSessao()) {
      status.textContent = "";
    } else if (syncPendente) {
      status.textContent = "aguardando conexão";
      status.className = "sync-status is-erro";
    } else {
      status.textContent = aoVivo ? "sincronizado · ao vivo ✓" : "sincronizado ✓";
      status.className = "sync-status is-ok";
    }
  }

  /* ---------- conta: com quem o casamento é compartilhado ---------- */

  function renderConta() {
    const box = $("#membros-box");
    const lista = $("#membros-lista");
    box.hidden = membrosCasal.length === 0;
    lista.innerHTML = membrosCasal
      .map((m) => {
        const eu = m === usuarioLogado;
        return `<span class="membro-chip ${eu ? "eu" : ""}"><i style="background:${corDoAutor(m)}">${escapeHtml(m[0].toUpperCase())}</i>${escapeHtml(m)}${eu ? " (você)" : ""}</span>`;
      })
      .join("");
    // só avisa quando temos certeza de que a lista veio do servidor
    $("#aviso-sozinho").hidden = membrosCasal.length !== 1;
  }

  async function buscarMembros() {
    if (!temSessao()) {
      membrosCasal = [];
      renderConta();
      return;
    }
    try {
      const r = await api({ op: "membros", ...credencial() });
      membrosCasal = Array.isArray(r.membros) ? r.membros : [];
    } catch {
      membrosCasal = [];
    }
    renderConta();
  }

  $("#btn-juntar").addEventListener("click", async () => {
    const codigo = $("#juntar-codigo").value.trim();
    const senha = $("#juntar-senha").value;
    const erro = $("#juntar-erro");
    erro.textContent = "";
    if (!codigo) { erro.textContent = "Cole o código do casal do seu par."; return; }
    if (!senha) { erro.textContent = "Confirme com a sua senha."; return; }
    if (!confirm("Juntar sua conta à do seu par? As listas dos dois serão somadas numa só.")) return;
    const btn = $("#btn-juntar");
    btn.disabled = true;
    try {
      const r = await api({ op: "juntar", usuario: usuarioLogado, senha, casal: codigo });
      membrosCasal = Array.isArray(r.membros) ? r.membros : [];
      await entrarComCasal(r.casal, r.token || "");
      renderConta();
      $("#juntar-codigo").value = "";
      $("#juntar-senha").value = "";
      $("#juntar-box").open = false;
      toast("Contas juntas! Agora vocês veem as mesmas listas 💛");
    } catch (e) {
      erro.textContent =
        e.status === 401 ? "Senha incorreta."
        : e.status === 404 ? "Código do casal não encontrado. Confira e tente de novo."
        : e.status === 400 ? "Código do casal inválido."
        : "Não foi possível juntar agora. Verifique a internet e tente de novo.";
    }
    btn.disabled = false;
  });

  /* ---------- login ---------- */

  const LOGIN_KEY = "nosso-casamento-usuario";
  let usuarioLogado = "";
  try { usuarioLogado = localStorage.getItem(LOGIN_KEY) || ""; } catch {}

  function renderLogin() {
    // só entra no app quem tem usuário E sessão válida: antes a sessão era
    // o código do casal, que nunca vencia; agora ela pode cair sozinha.
    $("#login-screen").hidden = Boolean(usuarioLogado && (token || casal));
  }

  // alterna entre as abas "Entrar" e "Criar conta"
  $$(".login-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const aba = tab.dataset.aba;
      $$(".login-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
      const entrar = aba === "entrar";
      $("#form-login").classList.toggle("is-active", entrar);
      $("#form-login").hidden = !entrar;
      $("#form-criar").classList.toggle("is-active", !entrar);
      $("#form-criar").hidden = entrar;
      $("#login-erro").textContent = "";
      $("#criar-erro").textContent = "";
    });
  });

  // Após o login, decide a direção da sincronização: se a nuvem já tem
  // dados, ela manda; se está vazia, sobe o que já existe neste aparelho.
  async function entrarComCasal(codigo, bilhete) {
    guardarCasal(codigo, bilhete);
    try {
      const r = await api({ op: "estado", ...credencial() });
      const nuvem = r.estado || {};
      if (nuvemTemDados(nuvem)) {
        adotarNuvem(r, false);
      } else {
        // conta ainda vazia: a referência é o vazio, e a diferença — tudo o
        // que já existe neste aparelho — sobe no envio
        if (r.atualizado_em) ultimoAtualizadoEm = r.atualizado_em;
        guardarBase(comoEstado(nuvem));
        enviarAgora();
      }
      syncPendente = false;
    } catch {
      syncPendente = true;
    }
    renderSync();
  }

  $("#form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const usuario = $("#login-usuario").value.trim();
    const senha = $("#login-senha").value;
    const btn = $("#btn-entrar");
    btn.disabled = true;
    $("#login-erro").textContent = "";
    try {
      const r = await api({ op: "login", usuario, senha });
      usuarioLogado = usuario.toLowerCase();
      try { localStorage.setItem(LOGIN_KEY, usuarioLogado); } catch {}
      membrosCasal = Array.isArray(r.membros) ? r.membros : [];
      await entrarComCasal(r.casal);
      renderConta();
      renderLogin();
      e.target.reset();
      toast("Bem-vindos! 💛");
    } catch (err) {
      $("#login-erro").textContent =
        err.status === 401
          ? "Usuário ou senha incorretos."
          : "Não foi possível entrar. Verifique a internet e tente de novo.";
    }
    btn.disabled = false;
  });

  $("#form-criar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const usuario = $("#criar-usuario").value.trim();
    const senha = $("#criar-senha").value;
    const senha2 = $("#criar-senha2").value;
    const codigo = $("#criar-codigo").value.trim();
    const erro = $("#criar-erro");
    erro.textContent = "";
    if (usuario.length < 3) { erro.textContent = "O usuário precisa ter ao menos 3 letras."; return; }
    if (senha.length < 8) { erro.textContent = "A senha precisa ter ao menos 8 caracteres."; return; }
    if (senha !== senha2) { erro.textContent = "As senhas não são iguais."; return; }
    const btn = $("#btn-criar");
    btn.disabled = true;
    try {
      const corpo = { op: "criar_conta", usuario, senha };
      if (codigo) corpo.casal = codigo;
      const r = await api(corpo);
      usuarioLogado = usuario.toLowerCase();
      try { localStorage.setItem(LOGIN_KEY, usuarioLogado); } catch {}
      await entrarComCasal(r.casal, r.token || "");
      renderLogin();
      $("#form-criar").reset();
      $("#form-login").reset();
      buscarMembros();
      toast(codigo ? "Conta criada! Vocês já compartilham as listas 💛" : "Conta criada! Bem-vindos 💛");
    } catch (err) {
      erro.textContent =
        err.status === 409 ? "Esse usuário já existe. Escolha outro."
        : err.status === 404 ? "Código do casal não encontrado. Confira e tente de novo."
        : err.status === 400 ? "Confira os dados e tente de novo."
        : "Não foi possível criar a conta. Verifique a internet e tente de novo.";
    }
    btn.disabled = false;
  });

  $("#btn-copiar-codigo").addEventListener("click", async () => {
    const campo = $("#conta-codigo");
    campo.select();
    try {
      await navigator.clipboard.writeText(casal);
      toast("Código copiado 📋");
    } catch {
      toast("Selecione o código e copie manualmente");
    }
  });

  function fazerLogout() {
    if (!confirm("Sair da conta neste aparelho? Os dados continuam salvos na nuvem.")) return;
    usuarioLogado = "";
    try { localStorage.removeItem(LOGIN_KEY); } catch {}
    guardarCasal("", "");
    ultimoAtualizadoEm = null;
    membrosCasal = [];
    editandoId = "";
    renderConta();
    renderLogin();
    // volta a tela de login para a aba "Entrar"
    const abaEntrar = document.querySelector('.login-tab[data-aba="entrar"]');
    if (abaEntrar) abaEntrar.click();
    irPara("dashboard");
    toast("Você saiu da conta");
  }

  $("#btn-sair-conta").addEventListener("click", fazerLogout);
  $("#btn-logout").addEventListener("click", fazerLogout);

  // Trocar a própria senha. O servidor exige a senha atual e, ao trocar,
  // derruba as sessões abertas em outros aparelhos.
  $("#btn-trocar-senha").addEventListener("click", async () => {
    const erro = $("#senha-erro");
    const atual = $("#senha-atual").value;
    const nova = $("#senha-nova").value;
    erro.textContent = "";
    if (!atual || !nova) { erro.textContent = "Preencha as duas senhas."; return; }
    if (nova.length < 8) { erro.textContent = "A senha nova precisa ter ao menos 8 caracteres."; return; }
    if (nova === atual) { erro.textContent = "A senha nova precisa ser diferente da atual."; return; }
    const btn = $("#btn-trocar-senha");
    btn.disabled = true;
    try {
      const r = await api({
        op: "trocar_senha",
        usuario: usuarioLogado,
        senha: atual,
        nova,
      });
      if (r.token) guardarCasal(casal, r.token);
      $("#senha-atual").value = "";
      $("#senha-nova").value = "";
      $("#senha-box").open = false;
      toast("Senha trocada 🔒");
    } catch (e) {
      erro.textContent = e.aviso || "Não foi possível trocar a senha agora.";
    } finally {
      btn.disabled = false;
    }
  });

  // Cancela as sessões de todos os aparelhos — inclusive este.
  $("#btn-sair-todos").addEventListener("click", async () => {
    if (!confirm("Desconectar todos os aparelhos? Todo mundo vai precisar entrar de novo.")) return;
    const btn = $("#btn-sair-todos");
    btn.disabled = true;
    try {
      await api({ op: "sair_de_todos", ...credencial() });
      toast("Todos os aparelhos foram desconectados");
      setTimeout(sessaoCaiu, 400);
    } catch (e) {
      toast(e.aviso || "Não foi possível desconectar agora");
    } finally {
      btn.disabled = false;
    }
  });

  const nuvemTemDados = (nuvem) =>
    LISTAS.some((lista) => (nuvem[lista] || []).length > 0) ||
    Boolean(nuvem.config && (nuvem.config.noiva || nuvem.config.noivo || nuvem.config.data));

  // O que este aparelho mudou desde a última sincronização, para pôr por
  // cima do que o servidor tem ao abrir o app.
  //
  // Sem base guardada (app recém-instalado, ou a primeira abertura depois
  // desta versão) não dá para distinguir "eu mudei" de "o outro celular
  // mudou e a minha cópia ficou velha". Então o servidor manda nos cadastros
  // que ele conhece; daqui sobem os que ele não tem e o que foi mexido
  // enquanto a busca corria. Se ele não tem nada, este aparelho é a origem
  // e sobe tudo.
  function mudancasLocais(nuvem, antesDaBusca) {
    if (baseSincronizada) return diferenca(state, baseSincronizada);
    if (!nuvemTemDados(nuvem)) return state;
    const saida = diferenca(state, antesDaBusca);
    for (const lista of LISTAS) {
      const conhecidos = new Set((nuvem[lista] || []).map((x) => x.id));
      const jaInclusos = new Set((saida[lista] || []).map((x) => x.id));
      const novos = (state[lista] || []).filter((x) => !conhecidos.has(x.id) && !jaInclusos.has(x.id));
      if (novos.length) saida[lista] = [...(saida[lista] || []), ...novos];
    }
    return saida;
  }

  // Ao abrir o app: busca o que o servidor tem e põe por cima só o que mudou
  // aqui; a diferença sobe em seguida.
  //
  // Antes o app mandava o cadastro inteiro guardado no aparelho, "para nada
  // se perder". Como o servidor grava linha por linha, era o contrário: a
  // cópia velha deste celular apagava tudo o que o outro tinha alterado
  // desde a última vez que este foi aberto.
  async function sincronizarAoAbrir() {
    if (!temSessao()) return;
    if (enviando) {
      reenviar = true;
      return;
    }
    clearTimeout(syncTimer);
    enviando = true;
    envioPendente = false;
    const antesDaBusca = copiar(state);
    try {
      const r = await api({ op: "estado", ...credencial() });
      const nuvem = comoEstado(r.estado || {});
      const mudancas = mudancasLocais(nuvem, antesDaBusca);
      const novo = comoEstado(nuvem);
      for (const o of OBJETOS) if (mudancas[o]) novo[o] = mudancas[o];
      // o que foi apagado aqui e ainda não subiu não volta para a tela
      const apagadosAqui = new Set((state.apagados || []).map((a) => a.id));
      for (const lista of LISTAS) {
        const porId = new Map(
          (novo[lista] || []).filter((x) => !apagadosAqui.has(x.id)).map((x) => [x.id, x]),
        );
        for (const x of mudancas[lista] || []) porId.set(x.id, x);
        novo[lista] = [...porId.values()];
      }
      novo.apagados = state.apagados || [];
      if (r.atualizado_em) ultimoAtualizadoEm = r.atualizado_em;
      guardarBase(nuvem);
      state = novo;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
      preencherConfig();
      renderTudo();
      syncPendente = false;
      if (estadosDiferem(state, baseSincronizada)) reenviar = true;
    } catch (e) {
      if (e.status === 404) {
        // registro apagado no servidor: mantém os dados locais e desconecta
        guardarCasal("", "");
        toast("A conta foi desconectada; entre novamente.");
      } else {
        syncPendente = true;
      }
    } finally {
      enviando = false;
    }
    renderSync();
    if (reenviar) {
      reenviar = false;
      agendarEnvio();
    }
  }

  window.addEventListener("online", enviarAgora);
  document.addEventListener("visibilitychange", () => {
    if (!temSessao()) return;
    if (document.visibilityState === "hidden") {
      // envia imediatamente o que estiver pendente ao sair do app
      // inclui o envio em voo: fechar o app pode cancelar o fetch no meio
      const envio = (enviando || envioPendente || syncPendente) ? estadoParaEnviar() : null;
      if (envio) {
        clearTimeout(syncTimer);
        try {
          navigator.sendBeacon(
            API_URL,
            new Blob([JSON.stringify({ op: "salvar", ...credencial(), estado: envio })], { type: "text/plain;charset=UTF-8" })
          );
        } catch {}
      }
    } else {
      // ao voltar para o app, busca na hora o que mudou
      puxarSeMudou();
    }
  });

  /* ---------- render geral ---------- */

  function renderTudo() {
    renderHeader();
    renderDashboard();
    renderConvidados();
    renderChecklist();
    renderPadrinhos();
    renderFornecedores();
    renderPresentes();
    renderNotas();
    preencherConvite();
    atualizarContagem();
  }

  /* ---------- página do convite ---------- */

  // endereço da página que os convidados abrem
  const enderecoConvite = () =>
    location.origin + location.pathname.replace(/[^/]*$/, "") + "convite/";

  const CAMPOS_CONVITE = {
    "#convite-slug": "slug",
    "#convite-mensagem": "mensagem",
    "#convite-endereco": "endereco",
    "#convite-mapa": "mapaLink",
    "#convite-presentes": "presentesLink",
    "#convite-presentes-texto": "presentesTexto",
    "#convite-pix": "pixChave",
    "#convite-pix-nome": "pixNome",
    "#convite-traje": "traje",
    "#convite-prazo": "prazo",
  };

  function preencherConvite() {
    const c = state.convite || {};
    for (const [seletor, campo] of Object.entries(CAMPOS_CONVITE)) {
      const el = $(seletor);
      if (el && document.activeElement !== el) el.value = c[campo] || "";
    }
    const publicado = $("#convite-publicado");
    if (publicado && document.activeElement !== publicado) publicado.checked = !!c.publicado;
    $("#convite-situacao").textContent = c.publicado ? "no ar" : "não publicado";
    $("#convite-endereco-completo").textContent = enderecoConvite();
  }

  $("#btn-salvar-convite").addEventListener("click", () => {
    const c = { ...state.convite };
    for (const [seletor, campo] of Object.entries(CAMPOS_CONVITE)) {
      c[campo] = $(seletor).value.trim();
    }
    c.publicado = $("#convite-publicado").checked;
    if (!c.slug) {
      toast("Escolha um endereço para a página");
      return;
    }
    state.convite = c;
    salvar();
    renderTudo();
    toast(c.publicado ? "Convite salvo e no ar 💌" : "Convite salvo (ainda não publicado)");
  });

  $("#btn-abrir-convite").addEventListener("click", () => {
    window.open(enderecoConvite(), "_blank", "noopener");
  });

  // Mensagem pronta para mandar no WhatsApp, com o link pessoal da família.
  function convidarPeloWhatsApp(convidado) {
    const link = enderecoConvite() + "#" + convidado.codigo;
    const quando = state.config.data
      ? new Date(state.config.data).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })
      : "";
    const texto =
      `Oi, ${convidado.nome}! 💛\n\n` +
      `Estamos casando${quando ? " no dia " + quando : ""} e queremos muito você com a gente.\n\n` +
      `Confirme sua presença aqui:\n${link}`;
    const tel = (convidado.telefone || "").replace(/\D/g, "");
    const numero = tel ? (tel.length <= 11 ? "55" + tel : tel) : "";
    window.open(
      `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`,
      "_blank",
      "noopener"
    );
  }

  /* ---------- foto do casal em tamanho grande ---------- */

  const fotoGrande = $("#foto-grande");

  // A foto pequena do cabeçalho "vira" a grande: as duas têm o mesmo nome de
  // transição, e o navegador anima uma na outra.
  function abrirFoto() {
    const foto = state.config.foto;
    if (!foto) return;
    $("#foto-grande-img").src = foto;
    comTransicao("foto", () => {
      document.body.classList.add("foto-aberta");
      fotoGrande.hidden = false;
    });
    $("#foto-grande-fechar").focus();
  }

  function fecharFoto() {
    comTransicao("foto", () => {
      fotoGrande.hidden = true;
      document.body.classList.remove("foto-aberta");
      $("#foto-grande-img").src = "";
    });
    $("#monogram").focus();
  }

  $("#monogram").addEventListener("click", abrirFoto);
  // clicar em qualquer lugar do fundo fecha
  fotoGrande.addEventListener("click", fecharFoto);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !fotoGrande.hidden) fecharFoto();
  });

  /* ---------- abertura ---------- */

  (function abertura() {
    const painel = $("#abertura");
    if (!painel) return;
    // os nomes do casal já estão guardados no aparelho: dá para escrevê-los
    // antes de a animação chegar neles
    const { noiva, noivo } = state.config;
    if (noiva.trim() || noivo.trim()) {
      $("#abertura-nome").textContent = `${nomeNoiva()} & ${nomeNoivo()}`;
    }
    // tira o painel do caminho assim que ele termina de sumir
    const some = () => painel.classList.add("fim");
    painel.addEventListener("animationend", (e) => {
      if (e.animationName === "aberturaSai") some();
    });
    setTimeout(some, 1600); // rede de segurança
  })();

  preencherConfig();
  preencherConvite();
  renderTudo();
  renderSync();
  renderLogin();
  sincronizarAoAbrir();
  buscarMembros();

  // primeira visita: leva direto para a configuração
  const primeiraVez = !state.config.data && state.convidados.length === 0 && state.itens.length === 0;
  if (primeiraVez) irPara("config", "nenhum");

  /* ---------- service worker e atualização automática ---------- */

  $("#app-versao").textContent = "v" + VERSAO_APP;

  let registroSW = null;

  // O servidor respondeu que esta versão não grava mais (426): avisa e vai
  // atrás da nova. O que foi alterado fica guardado aqui e sobe depois.
  let avisouAtualizacao = false;
  function atualizacaoObrigatoria() {
    if (!avisouAtualizacao) {
      avisouAtualizacao = true;
      toast("Há uma versão nova do app; atualizando… 🔄");
    }
    if (registroSW) registroSW.update().catch(() => {});
  }

  if ("serviceWorker" in navigator) {
    // se já havia uma versão instalada, uma troca de controle significa
    // que chegou versão nova: recarrega para o app abrir atualizado
    const jaTinhaVersao = Boolean(navigator.serviceWorker.controller);
    let recarregando = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!jaTinhaVersao || recarregando) return;
      recarregando = true;
      location.reload();
    });

    window.addEventListener("load", async () => {
      try {
        // updateViaCache "none" garante que o próprio sw.js venha da rede
        registroSW = await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });
        registroSW.update();
        // procura de novo sempre que o app volta para a frente
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible" && registroSW) registroSW.update();
        });
        setInterval(() => registroSW && registroSW.update(), 30 * 60 * 1000);
      } catch {}
    });
  }

  $("#btn-atualizar").addEventListener("click", async () => {
    const btn = $("#btn-atualizar");
    if (!registroSW) {
      location.reload();
      return;
    }
    btn.disabled = true;
    toast("Procurando atualização…");
    try {
      await registroSW.update();
      setTimeout(() => {
        // se nada novo apareceu, é porque já está na última versão
        if (!registroSW.installing && !registroSW.waiting) {
          toast(`Você já está na versão mais recente (v${VERSAO_APP}) ✅`);
        }
        btn.disabled = false;
      }, 1500);
    } catch {
      toast("Não foi possível verificar agora");
      btn.disabled = false;
    }
  });
})();
