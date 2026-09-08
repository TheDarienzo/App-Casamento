/* ============================================================
   Convite — página pública para os convidados
   Conversa só com as operações "convite_*" da API, que respondem
   sem sessão. Nada aqui dá acesso ao aplicativo dos noivos.
   ============================================================ */

(() => {
  "use strict";

  const API_URL = "https://rgxkmntpdbvvqcwksrwl.supabase.co/functions/v1/app/api";
  // apelido público do casamento; o código do casal nunca aparece por aqui
  const APELIDO = "rayane-e-lucas";

  const $ = (s) => document.querySelector(s);

  let convite = null;   // dados da página
  let convidado = null; // família identificada
  let vaiComparecer = null;
  let pessoas = 1;

  async function api(corpo) {
    // text/plain evita o pedido de permissão prévia do navegador
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(corpo),
    });
    let dados = null;
    try { dados = await resp.json(); } catch {}
    if (!resp.ok) {
      const erro = new Error((dados && dados.erro) || "HTTP " + resp.status);
      erro.aviso = dados && dados.erro;
      erro.status = resp.status;
      throw erro;
    }
    return dados;
  }

  let avisoTimer;
  function aviso(texto) {
    const el = $("#aviso");
    el.textContent = texto;
    el.classList.add("mostra");
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(() => el.classList.remove("mostra"), 2600);
  }

  const escapar = (t) => {
    const d = document.createElement("div");
    d.textContent = t;
    return d.innerHTML;
  };

  /* ---------- data e contagem ---------- */

  const dataDoCasamento = () => (convite && convite.data ? new Date(convite.data) : null);

  function porExtenso(d) {
    return d.toLocaleDateString("pt-BR", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
  }

  function atualizarContagem() {
    const alvo = dataDoCasamento();
    if (!alvo || isNaN(alvo)) return;
    let resta = alvo - new Date();
    if (resta <= 0) {
      $("#contagem").hidden = true;
      return;
    }
    const dias = Math.floor(resta / 864e5);
    resta -= dias * 864e5;
    const horas = Math.floor(resta / 36e5);
    resta -= horas * 36e5;
    const min = Math.floor(resta / 6e4);
    $("#cd-dias").textContent = dias;
    $("#cd-horas").textContent = String(horas).padStart(2, "0");
    $("#cd-min").textContent = String(min).padStart(2, "0");
    $("#contagem").hidden = false;
  }

  // Arquivo de calendário gerado aqui mesmo, sem servidor: funciona no
  // iPhone e no Android, e entra na agenda com lembrete do próprio celular.
  function montarAgenda() {
    const alvo = dataDoCasamento();
    const botao = $("#btn-agenda");
    if (!alvo || isNaN(alvo)) {
      botao.hidden = true;
      return;
    }
    const carimbo = (d) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const fim = new Date(alvo.getTime() + 5 * 36e5);
    const titulo = `Casamento de ${convite.noiva} e ${convite.noivo}`;
    const onde = [convite.local, convite.endereco].filter(Boolean).join(" - ");
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Nosso Casamento//PT-BR",
      "BEGIN:VEVENT",
      "UID:" + APELIDO + "@nossocasamento",
      "DTSTAMP:" + carimbo(new Date()),
      "DTSTART:" + carimbo(alvo),
      "DTEND:" + carimbo(fim),
      "SUMMARY:" + titulo,
      onde ? "LOCATION:" + onde : "",
      "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY",
      "DESCRIPTION:" + titulo, "END:VALARM",
      "END:VEVENT", "END:VCALENDAR",
    ].filter(Boolean).join("\r\n");
    botao.href = "data:text/calendar;charset=utf-8," + encodeURIComponent(ics);
    botao.hidden = false;
  }

  /* ---------- montagem da página ---------- */

  function montar() {
    const nomes = [convite.noiva, convite.noivo].filter(Boolean).join(" & ");
    $("#capa-nomes").textContent = convite.titulo || nomes || "Nosso Casamento";
    $("#rodape-nomes").textContent = nomes;
    document.title = (nomes || "Nosso Casamento") + " — Convite";

    if (convite.foto) {
      $("#capa-img").src = convite.foto;
      $("#capa-img").alt = "Foto de " + nomes;
      $("#capa-foto").hidden = false;
    }

    const alvo = dataDoCasamento();
    if (alvo && !isNaN(alvo)) {
      const hora = alvo.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      $("#capa-data").textContent = `${porExtenso(alvo)}, às ${hora}`;
      atualizarContagem();
      setInterval(atualizarContagem, 30000);
    }
    $("#capa-mensagem").textContent = convite.mensagem || "";

    if (convite.prazo) {
      const [a, m, d] = convite.prazo.split("-");
      $("#rsvp-prazo").textContent = `Por favor, confirme até ${d}/${m}/${a}`;
      $("#rsvp-prazo").hidden = false;
    }

    // local
    if (convite.local || convite.endereco) {
      $("#local-nome").textContent = convite.local || "";
      $("#local-endereco").textContent = convite.endereco || "";
      if (convite.mapa) {
        $("#btn-mapa").href = convite.mapa;
        $("#btn-mapa").hidden = false;
      }
      $("#secao-local").hidden = false;
    }
    montarAgenda();

    // presentes
    if (convite.presentesLink || convite.pixChave || convite.presentesTexto) {
      $("#presentes-texto").textContent = convite.presentesTexto || "";
      if (convite.presentesLink) {
        $("#btn-presentes").href = convite.presentesLink;
        $("#btn-presentes").hidden = false;
      }
      if (convite.pixChave) {
        $("#pix-chave").textContent = convite.pixChave;
        $("#pix-nome").textContent = convite.pixNome ? "Em nome de " + convite.pixNome : "";
        $("#bloco-pix").hidden = false;
      }
      $("#secao-presentes").hidden = false;
    }

    // traje
    if (convite.traje) {
      $("#traje-texto").textContent = convite.traje;
      $("#secao-traje").hidden = false;
    }

    $("#carregando").hidden = true;
    $("#pagina").hidden = false;
    revelarSecoes();
  }

  // as seções sobem suavemente conforme entram na tela
  function revelarSecoes() {
    const alvos = document.querySelectorAll(".secao, .rodape");
    if (!("IntersectionObserver" in window)) {
      alvos.forEach((el) => el.classList.add("visivel"));
      return;
    }
    const observador = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (e.isIntersecting) {
          e.target.classList.add("visivel");
          observador.unobserve(e.target);
        }
      }
    }, { rootMargin: "0px 0px -60px 0px" });
    alvos.forEach((el) => observador.observe(el));
  }

  /* ---------- identificar o convidado ---------- */

  function mostrarPasso(qual) {
    $("#passo-busca").hidden = qual !== "busca";
    $("#passo-resposta").hidden = qual !== "resposta";
    $("#passo-pronto").hidden = qual !== "pronto";
  }

  function abrirResposta(dados) {
    convidado = dados;
    $("#convidado-nome").textContent = dados.nome;
    $("#convidado-vagas").textContent =
      dados.pessoas === 1
        ? "Seu convite é para 1 pessoa"
        : `Seu convite é para até ${dados.pessoas} pessoas`;

    // se já respondeu, começa com a resposta anterior preenchida
    vaiComparecer = dados.respondeu ? dados.confirmado : null;
    pessoas = dados.pessoasConfirmadas > 0 ? dados.pessoasConfirmadas : dados.pessoas;
    $("#recado").value = dados.recado || "";
    pintarEscolha();
    mostrarPasso("resposta");
  }

  function pintarEscolha() {
    $("#btn-vou").classList.toggle("escolhida", vaiComparecer === true);
    $("#btn-nao-vou").classList.toggle("escolhida", vaiComparecer === false);
    $("#detalhe-sim").hidden = vaiComparecer !== true;
    $("#pessoas").textContent = pessoas;
    $("#menos").disabled = pessoas <= 1;
    $("#mais").disabled = !convidado || pessoas >= convidado.pessoas;
    $("#btn-enviar").disabled = vaiComparecer === null;
  }

  async function buscar() {
    const termo = $("#busca").value.trim();
    const erro = $("#busca-erro");
    erro.textContent = "";
    $("#achados").innerHTML = "";
    if (termo.length < 3) {
      erro.textContent = "Digite ao menos 3 letras do seu nome.";
      return;
    }
    const btn = $("#btn-buscar");
    btn.disabled = true;
    try {
      const r = await api({ op: "convite_buscar", slug: APELIDO, termo });
      const achados = r.achados || [];
      if (!achados.length) {
        erro.textContent = "Não encontramos esse nome. Tente como está no convite, ou fale com os noivos.";
        return;
      }
      $("#achados").innerHTML = achados
        .map(
          (a) => `<li><button type="button" data-codigo="${escapar(a.codigo)}">
            <span class="nome">${escapar(a.nome)}</span>
            <span class="vagas">${a.pessoas === 1 ? "1 pessoa" : a.pessoas + " pessoas"}</span>
          </button></li>`
        )
        .join("");
    } catch (e) {
      erro.textContent = e.aviso || "Não foi possível buscar agora. Tente de novo.";
    } finally {
      btn.disabled = false;
    }
  }

  async function enviar() {
    if (vaiComparecer === null) return;
    const btn = $("#btn-enviar");
    const erro = $("#resposta-erro");
    erro.textContent = "";
    btn.disabled = true;
    try {
      await api({
        op: "convite_confirmar",
        codigo: convidado.codigo,
        vai: vaiComparecer,
        pessoas: vaiComparecer ? pessoas : 0,
        recado: $("#recado").value.trim(),
      });
      convidado.respondeu = true;
      convidado.confirmado = vaiComparecer;
      convidado.pessoasConfirmadas = vaiComparecer ? pessoas : 0;
      convidado.recado = $("#recado").value.trim();
      mostrarPronto();
    } catch (e) {
      erro.textContent = e.aviso || "Não foi possível enviar agora. Tente de novo.";
      btn.disabled = false;
    }
  }

  function mostrarPronto() {
    if (vaiComparecer) {
      $("#pronto-icone").textContent = "🎉";
      $("#pronto-titulo").textContent = "Presença confirmada!";
      $("#pronto-texto").textContent =
        pessoas === 1
          ? "Anotamos 1 pessoa. Estamos ansiosos para ver você!"
          : `Anotamos ${pessoas} pessoas. Estamos ansiosos para ver vocês!`;
    } else {
      $("#pronto-icone").textContent = "💛";
      $("#pronto-titulo").textContent = "Obrigado por avisar";
      $("#pronto-texto").textContent = "Vamos sentir sua falta. Obrigado pelo carinho!";
    }
    mostrarPasso("pronto");
  }

  /* ---------- eventos ---------- */

  $("#btn-buscar").addEventListener("click", buscar);
  $("#busca").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); buscar(); }
  });

  $("#achados").addEventListener("click", async (e) => {
    const botao = e.target.closest("[data-codigo]");
    if (!botao) return;
    try {
      const dados = await api({ op: "convite_convidado", codigo: botao.dataset.codigo });
      abrirResposta(dados);
    } catch {
      aviso("Não foi possível abrir agora");
    }
  });

  $("#btn-vou").addEventListener("click", () => {
    vaiComparecer = true;
    if (convidado && pessoas > convidado.pessoas) pessoas = convidado.pessoas;
    pintarEscolha();
  });
  $("#btn-nao-vou").addEventListener("click", () => {
    vaiComparecer = false;
    pintarEscolha();
  });
  $("#menos").addEventListener("click", () => {
    pessoas = Math.max(1, pessoas - 1);
    pintarEscolha();
  });
  $("#mais").addEventListener("click", () => {
    pessoas = Math.min(convidado ? convidado.pessoas : 1, pessoas + 1);
    pintarEscolha();
  });
  $("#btn-enviar").addEventListener("click", enviar);
  $("#btn-voltar").addEventListener("click", () => {
    convidado = null;
    vaiComparecer = null;
    $("#busca").value = "";
    $("#achados").innerHTML = "";
    mostrarPasso("busca");
  });
  $("#btn-mudar").addEventListener("click", () => {
    $("#btn-enviar").disabled = false;
    mostrarPasso("resposta");
  });

  $("#btn-copiar-pix").addEventListener("click", async () => {
    const chave = convite.pixChave || "";
    try {
      await navigator.clipboard.writeText(chave);
      aviso("Chave Pix copiada ✅");
    } catch {
      aviso("Copie a chave: " + chave);
    }
  });

  /* ---------- início ---------- */

  function semConvite(texto) {
    $("#carregando").hidden = true;
    $("#aviso-texto").textContent = texto;
    $("#aviso-vazio").hidden = false;
  }

  (async function iniciar() {
    try {
      convite = await api({ op: "convite_info", slug: APELIDO });
    } catch {
      semConvite("Não foi possível carregar agora. Tente de novo em instantes.");
      return;
    }
    if (!convite || !convite.publicado) {
      semConvite("Este convite ainda não foi publicado pelos noivos.");
      return;
    }
    montar();

    // link pessoal: o endereço traz o código da família
    const codigo = (location.hash || "").replace("#", "").trim();
    if (codigo) {
      try {
        const dados = await api({ op: "convite_convidado", codigo });
        abrirResposta(dados);
        if (dados.respondeu) {
          vaiComparecer = dados.confirmado;
          pessoas = dados.pessoasConfirmadas > 0 ? dados.pessoasConfirmadas : 1;
          mostrarPronto();
        }
        return;
      } catch {
        aviso("Não encontramos esse convite; procure pelo nome");
      }
    }
    mostrarPasso("busca");
  })();
})();
