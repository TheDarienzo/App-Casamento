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
    config: { noiva: "", noivo: "", data: "", local: "", foto: "" },
    convidados: [],   // { id, nome, lado: "noiva"|"noivo", acompanhantes, confirmado }
    itens: [],        // { id, descricao, valor (centavos), resolvido }
    padrinhos: [],    // { id, padrinho, madrinha }
    fornecedores: [], // { id, nome, categoria, contato }
    presentes: [],    // { id, nome, valor (centavos), link, status: "falta"|"comprado"|"ganho" }
  });

  let state = carregar();
  let filtroConvidados = "todos";
  let filtroChecklist = "todos";
  let filtroPresentes = "todos";

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

  const escapeAttr = (texto) => escapeHtml(texto).replace(/"/g, "&quot;");

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
    } else {
      mono.textContent = iniciaisCasal();
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

    // presentes
    const pres = state.presentes;
    const presTemos = pres.filter((p) => p.status !== "falta").length;
    $("#resumo-presentes-frac").textContent = `${presTemos}/${pres.length}`;
    $("#presentes-progress").style.width = pres.length ? (presTemos / pres.length) * 100 + "%" : "0%";
    $("#stat-presentes").textContent = pres.length;
    $("#stat-presentes-sub").textContent = pres.length
      ? `${presTemos} já ${presTemos === 1 ? "conquistado" : "conquistados"}`
      : "nenhum ainda";

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

  /* ---------- presentes ---------- */

  const ROTULO_STATUS = { falta: "Falta", comprado: "Comprado", ganho: "Ganho" };
  const PROXIMO_STATUS = { falta: "comprado", comprado: "ganho", ganho: "falta" };

  function renderPresentes() {
    const lista = $("#lista-presentes");
    const presentes = state.presentes;

    const filtrados = presentes.filter((p) => {
      if (filtroPresentes === "faltam") return p.status === "falta";
      if (filtroPresentes === "comprado") return p.status === "comprado";
      if (filtroPresentes === "ganho") return p.status === "ganho";
      return true;
    });

    lista.innerHTML = filtrados
      .map((p) => {
        const pego = p.status !== "falta";
        const link = p.link
          ? `<a class="link-contato" href="${escapeAttr(p.link)}" target="_blank" rel="noopener">ver loja ↗</a>`
          : "";
        const valor = p.valor ? `<span>${brl(p.valor)}</span>` : "";
        const meta = valor || link ? `<div class="item-meta">${valor}${link}</div>` : "";
        return `<li class="list-item ${pego ? "pego" : ""}" data-id="${p.id}">
          <button class="present-status st-${p.status}" data-acao="status" aria-label="Mudar situação" title="Toque para mudar">${ROTULO_STATUS[p.status]}</button>
          <div class="item-main">
            <div class="item-title">${escapeHtml(p.nome)}</div>
            ${meta}
          </div>
          <button class="btn-remove" data-acao="remover" aria-label="Remover">${iconeLixeira}</button>
        </li>`;
      })
      .join("");

    $("#presentes-empty").classList.toggle("is-visible", presentes.length === 0);

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
    if (btn.dataset.acao === "status") {
      p.status = PROXIMO_STATUS[p.status] || "falta";
      if (p.status === "comprado") toast("Marcado como comprado 🛒");
      else if (p.status === "ganho") toast("Que presente! 🎁💛");
    } else if (btn.dataset.acao === "remover") {
      if (!confirm(`Remover "${p.nome}" da lista?`)) return;
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
  function lerFotoReduzida(arquivo, cb) {
    const leitor = new FileReader();
    leitor.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 400;
        const escala = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * escala));
        const h = Math.max(1, Math.round(img.height * escala));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        try {
          cb(canvas.toDataURL("image/jpeg", 0.82));
        } catch {
          cb(null);
        }
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
  let syncPendente = false;   // um envio falhou; há mudanças locais não salvas
  let envioPendente = false;  // há um envio agendado (debounce) esperando
  let ultimoAtualizadoEm = null; // carimbo da última versão vista da nuvem

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
    envioPendente = true;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(enviarAgora, 1200);
  }

  async function enviarAgora() {
    if (!casal) return;
    clearTimeout(syncTimer);
    envioPendente = false;
    try {
      const r = await api({ op: "salvar", casal, estado: state });
      // guarda o carimbo da nossa própria escrita para o polling não
      // reaplicar os mesmos dados como se fossem novidade
      if (r && r.atualizado_em) ultimoAtualizadoEm = r.atualizado_em;
      syncPendente = false;
    } catch {
      syncPendente = true;
    }
    renderSync();
  }

  // Verifica a nuvem periodicamente e aplica se o OUTRO celular mudou algo.
  // Não sobrescreve enquanto há edição local pendente nem enquanto o
  // usuário está digitando num campo.
  async function puxarSeMudou() {
    if (!casal || envioPendente || syncPendente) return;
    if (document.visibilityState !== "visible") return;
    const ativo = document.activeElement;
    if (ativo && /^(INPUT|TEXTAREA|SELECT)$/.test(ativo.tagName)) return;
    try {
      const r = await api({ op: "estado", casal });
      if (!r || !r.atualizado_em || r.atualizado_em === ultimoAtualizadoEm) return;
      // reconfirma que nada começou a ser editado durante a busca
      if (envioPendente || syncPendente) return;
      ultimoAtualizadoEm = r.atualizado_em;
      const nuvem = r.estado || {};
      state = { ...estadoInicial(), ...nuvem, config: { ...estadoInicial().config, ...(nuvem.config || {}) } };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
      preencherConfig();
      renderTudo();
      toast("Atualizado ✨");
    } catch {}
  }

  setInterval(puxarSeMudou, 7000);

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
    $("#conta-codigo").value = casal || "";
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
  async function entrarComCasal(codigo) {
    guardarCasal(codigo);
    try {
      const r = await api({ op: "estado", casal: codigo });
      ultimoAtualizadoEm = r.atualizado_em || ultimoAtualizadoEm;
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

  $("#form-criar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const usuario = $("#criar-usuario").value.trim();
    const senha = $("#criar-senha").value;
    const senha2 = $("#criar-senha2").value;
    const codigo = $("#criar-codigo").value.trim();
    const erro = $("#criar-erro");
    erro.textContent = "";
    if (usuario.length < 3) { erro.textContent = "O usuário precisa ter ao menos 3 letras."; return; }
    if (senha.length < 4) { erro.textContent = "A senha precisa ter ao menos 4 caracteres."; return; }
    if (senha !== senha2) { erro.textContent = "As senhas não são iguais."; return; }
    const btn = $("#btn-criar");
    btn.disabled = true;
    try {
      const corpo = { op: "criar_conta", usuario, senha };
      if (codigo) corpo.casal = codigo;
      const r = await api(corpo);
      usuarioLogado = usuario.toLowerCase();
      try { localStorage.setItem(LOGIN_KEY, usuarioLogado); } catch {}
      await entrarComCasal(r.casal);
      renderLogin();
      $("#form-criar").reset();
      $("#form-login").reset();
      toast("Conta criada! Bem-vindos 💛");
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
    guardarCasal("");
    ultimoAtualizadoEm = null;
    renderLogin();
    // volta a tela de login para a aba "Entrar"
    const abaEntrar = document.querySelector('.login-tab[data-aba="entrar"]');
    if (abaEntrar) abaEntrar.click();
    irPara("dashboard");
    toast("Você saiu da conta");
  }

  $("#btn-sair-conta").addEventListener("click", fazerLogout);
  $("#btn-logout").addEventListener("click", fazerLogout);

  async function baixarDaNuvem() {
    if (!casal) return;
    try {
      const r = await api({ op: "estado", casal });
      ultimoAtualizadoEm = r.atualizado_em || ultimoAtualizadoEm;
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
    if (!casal) return;
    if (document.visibilityState === "hidden") {
      // envia imediatamente o que estiver pendente ao sair do app
      if (envioPendente || syncPendente) {
        clearTimeout(syncTimer);
        try {
          navigator.sendBeacon(
            API_URL,
            new Blob([JSON.stringify({ op: "salvar", casal, estado: state })], { type: "text/plain;charset=UTF-8" })
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
