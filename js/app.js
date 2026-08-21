/* ============================================================
   Nosso Casamento — lógica do app
   Dados salvos em localStorage (apenas neste aparelho).
   ============================================================ */

(() => {
  "use strict";

  const STORAGE_KEY = "nosso-casamento-v1";
  const CASAL_KEY = "nosso-casamento-casal";

  // API de sincronização (Edge Function no Supabase). O app pode estar
  // hospedado em qualquer lugar (Cloudflare Pages, GitHub Pages, …).
  const API_URL = "https://rgxkmntpdbvvqcwksrwl.supabase.co/functions/v1/app/api";

  const estadoInicial = () => ({
    config: { noiva: "", noivo: "", data: "", local: "" },
    convidados: [],   // { id, nome, lado: "noiva"|"noivo", acompanhantes, confirmado }
    itens: [],        // { id, descricao, valor (centavos), resolvido }
    padrinhos: [],    // { id, padrinho, madrinha }
    fornecedores: [], // { id, nome, categoria, contato }
  });

  let state = carregar();
  let filtroConvidados = "todos";
  let filtroChecklist = "todos";

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
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      toast("Não foi possível salvar os dados 😢");
    }
    agendarEnvio();
  }

  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

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
  const iconeCheck =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4 10-10"/></svg>';

  /* ---------- navegação ---------- */

  function irPara(view) {
    $$(".view").forEach((v) => v.classList.remove("is-active"));
    const alvo = $("#view-" + view);
    if (alvo) alvo.classList.add("is-active");
    $$(".nav-item").forEach((b) => b.classList.toggle("is-active", b.dataset.view === view));
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  $$(".nav-item").forEach((btn) => btn.addEventListener("click", () => irPara(btn.dataset.view)));
  $$("[data-goto]").forEach((btn) => btn.addEventListener("click", () => irPara(btn.dataset.goto)));
  $("#btn-config").addEventListener("click", () => irPara("config"));

  /* ---------- contagem regressiva ---------- */

  function atualizarContagem() {
    const cfg = state.config;
    const cartao = $(".countdown-card");
    if (!cfg.data) {
      ["dias", "horas", "min", "seg"].forEach((u) => ($("#cd-" + u).textContent = "--"));
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

    $("#cd-dias").textContent = String(dias);
    $("#cd-horas").textContent = String(horas).padStart(2, "0");
    $("#cd-min").textContent = String(min).padStart(2, "0");
    $("#cd-seg").textContent = String(seg).padStart(2, "0");
  }

  setInterval(atualizarContagem, 1000);

  /* ---------- cabeçalho ---------- */

  function renderHeader() {
    const { noiva, noivo, data } = state.config;
    const temNomes = noiva.trim() || noivo.trim();
    $("#header-couple").textContent = temNomes ? `${nomeNoiva()} & ${nomeNoivo()}` : "Nosso Casamento";
    $("#monogram").textContent = temNomes
      ? `${nomeNoiva()[0].toUpperCase()}&${nomeNoivo()[0].toUpperCase()}`
      : "N&N";
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

    const proximos = pendentes.slice(0, 4);
    $("#dash-pendentes").innerHTML = proximos.length
      ? proximos
          .map(
            (i) =>
              `<li><span>${escapeHtml(i.descricao)}</span>` +
              (i.valor ? `<span class="mini-valor">${brl(i.valor)}</span>` : "") +
              `</li>`
          )
          .join("")
      : `<li><span>Nenhuma pendência — aproveitem o momento 💛</span></li>`;

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

    const filtrados = conv.filter((c) => {
      if (filtroConvidados === "noiva") return c.lado === "noiva";
      if (filtroConvidados === "noivo") return c.lado === "noivo";
      if (filtroConvidados === "confirmados") return c.confirmado;
      return true;
    });

    lista.innerHTML = filtrados
      .map((c) => {
        const pessoas = totalPessoas(c);
        const badge =
          c.lado === "noiva"
            ? `<span class="badge badge-noiva">${escapeHtml(nomeNoiva())}</span>`
            : `<span class="badge badge-noivo">${escapeHtml(nomeNoivo())}</span>`;
        return `<li class="list-item ${c.confirmado ? "is-done" : ""}" data-id="${c.id}">
          <button class="check-toggle ${c.confirmado ? "is-on" : ""}" data-acao="confirmar" aria-label="Confirmar presença" title="Confirmar presença">${iconeCheck}</button>
          <div class="item-main">
            <div class="item-title">${escapeHtml(c.nome)}</div>
            <div class="item-meta">${badge}<span>${pessoas} pessoa${pessoas === 1 ? "" : "s"}${c.acompanhantes ? ` (+${c.acompanhantes} acomp.)` : ""}</span></div>
          </div>
          <button class="btn-remove" data-acao="remover" aria-label="Remover">${iconeLixeira}</button>
        </li>`;
      })
      .join("");

    $("#convidados-empty").classList.toggle("is-visible", conv.length === 0);

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
    if (btn.dataset.acao === "confirmar") {
      c.confirmado = !c.confirmado;
    } else if (btn.dataset.acao === "remover") {
      if (!confirm(`Remover ${c.nome} da lista?`)) return;
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

    const filtrados = itens.filter((i) => {
      if (filtroChecklist === "pendentes") return !i.resolvido;
      if (filtroChecklist === "resolvidos") return i.resolvido;
      return true;
    });

    lista.innerHTML = filtrados
      .map(
        (i) => `<li class="list-item ${i.resolvido ? "is-done" : ""}" data-id="${i.id}">
          <button class="check-toggle ${i.resolvido ? "is-on" : ""}" data-acao="resolver" aria-label="Marcar como resolvido" title="Marcar como resolvido">${iconeCheck}</button>
          <div class="item-main">
            <div class="item-title">${escapeHtml(i.descricao)}</div>
          </div>
          ${i.valor ? `<span class="item-valor">${brl(i.valor)}</span>` : ""}
          <button class="btn-remove" data-acao="remover" aria-label="Remover">${iconeLixeira}</button>
        </li>`
      )
      .join("");

    $("#checklist-empty").classList.toggle("is-visible", itens.length === 0);

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
    state.itens.push({ id: uid(), descricao: desc, valor, resolvido: false });
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
    if (btn.dataset.acao === "resolver") {
      item.resolvido = !item.resolvido;
      if (item.resolvido) toast("Resolvido! 🎉");
    } else if (btn.dataset.acao === "remover") {
      if (!confirm(`Remover "${item.descricao}"?`)) return;
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
    lista.innerHTML = state.padrinhos
      .map(
        (p, idx) => `<li class="pair-item" data-id="${p.id}">
          <span class="pair-num">${idx + 1}</span>
          <div class="pair-names">
            <span class="nome">${escapeHtml(p.padrinho)}</span>
            <span class="amp">&amp;</span>
            <span class="nome">${escapeHtml(p.madrinha)}</span>
          </div>
          <button class="btn-remove" data-acao="remover" aria-label="Remover par">${iconeLixeira}</button>
        </li>`
      )
      .join("");

    $("#padrinhos-empty").classList.toggle("is-visible", state.padrinhos.length === 0);

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
    if (!confirm(`Remover ${p.padrinho} & ${p.madrinha}?`)) return;
    state.padrinhos = state.padrinhos.filter((x) => x.id !== id);
    salvar();
    renderTudo();
  });

  /* ---------- fornecedores ---------- */

  function renderFornecedores() {
    const lista = $("#lista-fornecedores");
    lista.innerHTML = state.fornecedores
      .map((f) => {
        const tel = (f.contato || "").replace(/\D/g, "");
        const linkContato = tel
          ? `<a class="link-contato" href="https://wa.me/55${tel}" target="_blank" rel="noopener">WhatsApp: ${escapeHtml(f.contato)}</a>`
          : "";
        return `<li class="list-item" data-id="${f.id}">
          <div class="item-main">
            <div class="item-title">${escapeHtml(f.nome)}</div>
            <div class="item-meta"><span class="badge badge-cat">${escapeHtml(f.categoria)}</span>${linkContato}</div>
          </div>
          <button class="btn-remove" data-acao="remover" aria-label="Remover">${iconeLixeira}</button>
        </li>`;
      })
      .join("");

    $("#fornecedores-empty").classList.toggle("is-visible", state.fornecedores.length === 0);

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
    if (!confirm(`Remover ${f.nome}?`)) return;
    state.fornecedores = state.fornecedores.filter((x) => x.id !== id);
    salvar();
    renderTudo();
  });

  /* ---------- configurações ---------- */

  function preencherConfig() {
    $("#config-noiva").value = state.config.noiva;
    $("#config-noivo").value = state.config.noivo;
    $("#config-data").value = state.config.data;
    $("#config-local").value = state.config.local;
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
    state = estadoInicial();
    salvar();
    preencherConfig();
    renderTudo();
    toast("Dados apagados");
  });

  /* ---------- sincronização entre celulares (Supabase) ---------- */

  let casal = "";
  try { casal = localStorage.getItem(CASAL_KEY) || ""; } catch {}
  let syncTimer;
  let syncPendente = false;

  async function api(corpo) {
    // text/plain evita preflight de CORS; o servidor interpreta como JSON
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(corpo),
    });
    if (!resp.ok) {
      const erro = new Error("HTTP " + resp.status);
      erro.status = resp.status;
      throw erro;
    }
    return resp.json();
  }

  function agendarEnvio() {
    if (!casal) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(enviarAgora, 1200);
  }

  async function enviarAgora() {
    if (!casal) return;
    clearTimeout(syncTimer);
    try {
      await api({ op: "salvar", casal, estado: state });
      syncPendente = false;
    } catch {
      syncPendente = true;
    }
    renderSync();
  }

  function guardarCasal(codigo) {
    casal = codigo;
    try {
      if (codigo) localStorage.setItem(CASAL_KEY, codigo);
      else localStorage.removeItem(CASAL_KEY);
    } catch {}
    renderSync();
  }

  function renderSync() {
    $("#conta-usuario").textContent = usuarioLogado || "—";
    const status = $("#sync-status");
    if (!casal) {
      status.textContent = "";
    } else if (syncPendente) {
      status.textContent = "aguardando conexão";
      status.className = "sync-status is-erro";
    } else {
      status.textContent = "sincronizado ✓";
      status.className = "sync-status is-ok";
    }
  }

  /* ---------- login ---------- */

  const LOGIN_KEY = "nosso-casamento-usuario";
  let usuarioLogado = "";
  try { usuarioLogado = localStorage.getItem(LOGIN_KEY) || ""; } catch {}

  function renderLogin() {
    $("#login-screen").hidden = Boolean(usuarioLogado);
  }

  // Após o login, decide a direção da sincronização: se a nuvem já tem
  // dados, ela manda; se está vazia, sobe o que já existe neste aparelho.
  async function entrarComCasal(codigo) {
    guardarCasal(codigo);
    try {
      const r = await api({ op: "estado", casal: codigo });
      const nuvem = r.estado || {};
      const nuvemTemDados =
        (nuvem.convidados || []).length ||
        (nuvem.itens || []).length ||
        (nuvem.padrinhos || []).length ||
        (nuvem.fornecedores || []).length ||
        (nuvem.config && (nuvem.config.noiva || nuvem.config.noivo || nuvem.config.data));
      if (nuvemTemDados) {
        state = { ...estadoInicial(), ...nuvem, config: { ...estadoInicial().config, ...(nuvem.config || {}) } };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
        preencherConfig();
        renderTudo();
      } else {
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
      await entrarComCasal(r.casal);
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

  $("#btn-sair-conta").addEventListener("click", () => {
    if (!confirm("Sair da conta neste aparelho? Os dados continuam salvos na nuvem.")) return;
    usuarioLogado = "";
    try { localStorage.removeItem(LOGIN_KEY); } catch {}
    guardarCasal("");
    renderLogin();
    toast("Você saiu da conta");
  });

  async function baixarDaNuvem() {
    if (!casal) return;
    try {
      const r = await api({ op: "estado", casal });
      state = { ...estadoInicial(), ...r.estado, config: { ...estadoInicial().config, ...(r.estado.config || {}) } };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
      syncPendente = false;
      preencherConfig();
      renderTudo();
    } catch (e) {
      if (e.status === 404) {
        // registro apagado no servidor: mantém os dados locais e desconecta
        guardarCasal("");
        toast("A conta foi desconectada; entre novamente.");
      } else {
        syncPendente = true;
      }
    }
    renderSync();
  }

  window.addEventListener("online", enviarAgora);
  document.addEventListener("visibilitychange", () => {
    // envia imediatamente o que estiver pendente ao sair do app
    if (document.visibilityState === "hidden" && casal && (syncTimer || syncPendente)) {
      clearTimeout(syncTimer);
      try {
        navigator.sendBeacon(
          API_URL,
          new Blob([JSON.stringify({ op: "salvar", casal, estado: state })], { type: "text/plain;charset=UTF-8" })
        );
      } catch {}
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
    atualizarContagem();
  }

  preencherConfig();
  renderTudo();
  renderSync();
  renderLogin();
  baixarDaNuvem();

  // primeira visita: leva direto para a configuração
  const primeiraVez = !state.config.data && state.convidados.length === 0 && state.itens.length === 0;
  if (primeiraVez) irPara("config");

  /* ---------- service worker ---------- */

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
