// Edge Function "app" — API de sincronização do PWA Nosso Casamento.
//
// O Supabase não serve páginas HTML (GET text/html vira text/plain, por
// política da plataforma), então o app é hospedado fora (Cloudflare Workers)
// e conversa com esta API:
//
//   POST .../functions/v1/app/api  → { op: "login" | "estado" | "salvar", ... }
//
// Os dados ficam em tabelas — convidados, checklist, padrinhos, fornecedores,
// presentes e notas — uma linha por cadastro. Ler e gravar é trabalho das
// funções ler_estado/salvar_estado, que rodam dentro do banco numa transação
// só: ou grava tudo, ou não grava nada.
//
// Autenticação: o aparelho manda um bilhete de sessão assinado pelo servidor
// (op "login" devolve), com 30 dias de validade e possibilidade de cancelar.
// Antes disso a chave era o código do casal guardado para sempre no
// aparelho; ele ainda é aceito até a data em configuracao.legado_ate, para
// ninguém ficar de fora enquanto atualiza o aplicativo.
//
// As tabelas têm RLS ligado sem policies — só esta função (service role)
// consegue acessá-las.

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ESTADO_MAX_BYTES = 512_000;

// ---------- configuração guardada no banco ----------

const cache = new Map<string, { valor: string; ate: number }>();

async function ajuste(chave: string, padrao = ""): Promise<string> {
  const guardado = cache.get(chave);
  if (guardado && guardado.ate > Date.now()) return guardado.valor;
  const { data } = await supabase
    .from("configuracao")
    .select("valor")
    .eq("chave", chave)
    .maybeSingle();
  const valor = data?.valor ?? padrao;
  cache.set(chave, { valor, ate: Date.now() + 60_000 });
  return valor;
}

// Enquanto a lista de endereços estiver vazia, responde a qualquer origem —
// assim o app não quebra antes de o endereço ser cadastrado.
async function cors(req: Request): Promise<Record<string, string>> {
  const permitidas = (await ajuste("origens_permitidas"))
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const origem = req.headers.get("origin") ?? "";
  const liberado = permitidas.length === 0
    ? "*"
    : permitidas.includes(origem)
    ? origem
    : permitidas[0];
  return {
    "Access-Control-Allow-Origin": liberado,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    ...(permitidas.length ? { Vary: "Origin" } : {}),
  };
}

// Anota de que endereço o app chama, para poder restringir o CORS a ele
// depois sem ninguém ter de descobrir a URL na mão. Guarda no máximo 5.
const origensAnotadas = new Set<string>();

async function anotarOrigem(req: Request): Promise<void> {
  const origem = req.headers.get("origin") ?? "";
  if (!origem.startsWith("https://") || origensAnotadas.has(origem)) return;
  origensAnotadas.add(origem);
  const vistas = (await ajuste("origens_vistas")).split(",").filter(Boolean);
  if (vistas.includes(origem)) return;
  const nova = [...vistas, origem].slice(-5).join(",");
  await supabase.from("configuracao").upsert({ chave: "origens_vistas", valor: nova });
  cache.delete("origens_vistas");
}

// ---------- identificação de quem chama ----------

// Guarda um resumo do endereço de rede, não o endereço em si: serve para
// contar tentativas sem manter registro de onde cada pessoa acessou.
async function origemResumida(req: Request): Promise<string> {
  const ip = (req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for") ??
    "").split(",")[0].trim();
  if (!ip) return "";
  const bytes = new TextEncoder().encode("nosso-casamento:" + ip);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function membros(casal: string): Promise<string[]> {
  const { data } = await supabase.rpc("membros_do_casal", { p_casal: casal });
  return Array.isArray(data) ? data : [];
}

type Sessao = { casal: string; usuario: string; token?: string };

// Aceita o bilhete assinado; e, durante a transição, o código do casal antigo.
async function sessao(corpo: Record<string, unknown>): Promise<Sessao | { erro: string; status: number }> {
  const token = String(corpo.token ?? "");
  if (token) {
    const { data, error } = await supabase.rpc("validar_token", { p_token: token });
    if (error) return { erro: "falha ao validar a sessão", status: 500 };
    const r = data as Record<string, string | boolean>;
    if (r?.erro) {
      return {
        erro: r.erro === "sessao_expirada"
          ? "sua sessão expirou; entre de novo"
          : "sessão inválida; entre de novo",
        status: 401,
      };
    }
    const saida: Sessao = { casal: String(r.casal), usuario: String(r.usuario) };
    if (r.renovar) {
      const { data: novo } = await supabase.rpc("emitir_token", {
        p_casal: saida.casal,
        p_usuario: saida.usuario,
      });
      if (novo) saida.token = String(novo);
    }
    return saida;
  }

  const casal = String(corpo.casal ?? "");
  if (UUID_RE.test(casal)) {
    const ate = await ajuste("legado_ate");
    if (ate && new Date(ate) > new Date()) {
      const { data } = await supabase
        .from("casamentos").select("id").eq("id", casal).maybeSingle();
      if (data) return { casal, usuario: "" };
    }
    return { erro: "entre de novo para continuar", status: 401 };
  }

  return { erro: "entre de novo para continuar", status: 401 };
}

// ---------- rotas ----------

Deno.serve(async (req: Request) => {
  const CORS = await cors(req);
  const json = (dados: unknown, status = 200) =>
    new Response(JSON.stringify(dados), {
      status,
      headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
    });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (req.method !== "POST") {
    return json({
      app: "Nosso Casamento",
      status: "ok",
      aviso: "Esta é a API de sincronização; o aplicativo fica no endereço publicado no Cloudflare.",
    });
  }

  let corpo: Record<string, unknown>;
  try {
    // o cliente envia como text/plain para evitar preflight; ainda é JSON
    const texto = await req.text();
    if (texto.length > ESTADO_MAX_BYTES + 4096) return json({ erro: "envio grande demais" }, 413);
    corpo = JSON.parse(texto);
  } catch {
    return json({ erro: "JSON inválido" }, 400);
  }

  // não atrasa a resposta: só registra de onde veio
  anotarOrigem(req).catch(() => {});

  const op = corpo.op;
  const usuario = String(corpo.usuario ?? "").trim();
  const senha = String(corpo.senha ?? "");

  if (op === "login") {
    if (!usuario || !senha) return json({ erro: "informe usuário e senha" }, 400);
    const { data, error } = await supabase.rpc("login_usuario", {
      p_usuario: usuario,
      p_senha: senha,
      p_origem: await origemResumida(req),
    });
    if (error) return json({ erro: "falha no login" }, 500);
    const r = data as Record<string, unknown>;
    if (r?.erro === "muitas_tentativas") {
      const min = Math.ceil(Number(r.espera ?? 0) / 60);
      return json(
        { erro: `muitas tentativas; espere ${min} minuto${min === 1 ? "" : "s"}`, espera: r.espera },
        429,
      );
    }
    if (r?.erro) return json({ erro: "usuário ou senha incorretos" }, 401);
    return json({ ...r, membros: await membros(String(r.casal)) });
  }

  if (op === "criar_conta") {
    const casalRaw = corpo.casal ? String(corpo.casal).trim() : null;
    if (!usuario || !senha) return json({ erro: "informe usuário e senha" }, 400);
    if (casalRaw && !UUID_RE.test(casalRaw)) return json({ erro: "código do casal inválido" }, 400);
    const { data, error } = await supabase.rpc("criar_conta", {
      p_usuario: usuario,
      p_senha: senha,
      p_casal: casalRaw,
    });
    if (error) {
      const m = error.message || "";
      if (m.includes("usuario_existe")) return json({ erro: "esse usuário já existe" }, 409);
      if (m.includes("usuario_curto")) return json({ erro: "o usuário precisa ter ao menos 3 letras" }, 400);
      if (m.includes("senha_curta")) return json({ erro: "a senha precisa ter ao menos 8 caracteres" }, 400);
      if (m.includes("casal_invalido")) return json({ erro: "código do casal não encontrado" }, 404);
      return json({ erro: "falha ao criar conta" }, 500);
    }
    // já entra logado
    const { data: entrada } = await supabase.rpc("login_usuario", {
      p_usuario: usuario,
      p_senha: senha,
      p_origem: await origemResumida(req),
    });
    return json({ casal: data, ...(entrada as Record<string, unknown>) });
  }

  if (op === "juntar") {
    const alvo = String(corpo.casal ?? "").trim();
    if (!usuario || !senha) return json({ erro: "informe usuário e senha" }, 400);
    if (!UUID_RE.test(alvo)) return json({ erro: "código do casal inválido" }, 400);
    const { data, error } = await supabase.rpc("juntar_ao_casal", {
      p_usuario: usuario,
      p_senha: senha,
      p_casal: alvo,
      p_origem: await origemResumida(req),
    });
    if (error) return json({ erro: "falha ao juntar as contas" }, 500);
    const r = data as Record<string, unknown>;
    if (r?.erro === "muitas_tentativas") return json({ erro: "muitas tentativas; espere alguns minutos" }, 429);
    if (r?.erro === "casal_invalido") return json({ erro: "código do casal não encontrado" }, 404);
    if (r?.erro) return json({ erro: "senha incorreta" }, 401);
    return json({ ...r, membros: await membros(String(r.casal)) });
  }

  if (op === "trocar_senha") {
    const nova = String(corpo.nova ?? "");
    if (!usuario || !senha || !nova) return json({ erro: "preencha todos os campos" }, 400);
    const { data, error } = await supabase.rpc("trocar_senha", {
      p_usuario: usuario,
      p_atual: senha,
      p_nova: nova,
      p_origem: await origemResumida(req),
    });
    if (error) return json({ erro: "falha ao trocar a senha" }, 500);
    const r = data as Record<string, unknown>;
    if (r?.erro === "senha_curta") return json({ erro: "a senha nova precisa ter ao menos 8 caracteres" }, 400);
    if (r?.erro === "muitas_tentativas") return json({ erro: "muitas tentativas; espere alguns minutos" }, 429);
    if (r?.erro) return json({ erro: "senha atual incorreta" }, 401);
    return json(r);
  }

  // daqui para baixo, tudo exige sessão
  const sess = await sessao(corpo);
  if ("erro" in sess) return json({ erro: sess.erro }, sess.status);
  const renovado = sess.token ? { token: sess.token } : {};

  if (op === "membros") {
    return json({ membros: await membros(sess.casal), ...renovado });
  }

  if (op === "sair_de_todos") {
    const { error } = await supabase.rpc("revogar_sessoes", { p_casal: sess.casal });
    if (error) return json({ erro: "falha ao desconectar" }, 500);
    return json({ ok: true });
  }

  if (op === "estado") {
    const { data, error } = await supabase.rpc("ler_estado", { p_casal: sess.casal });
    if (error) return json({ erro: "falha ao consultar" }, 500);
    if (!data) return json({ erro: "código não encontrado" }, 404);
    return json({ ...(data as Record<string, unknown>), ...renovado });
  }

  if (op === "salvar") {
    const estado = corpo.estado;
    if (typeof estado !== "object" || estado === null) return json({ erro: "estado inválido" }, 400);
    if (JSON.stringify(estado).length > ESTADO_MAX_BYTES) return json({ erro: "estado grande demais" }, 413);

    const { data, error } = await supabase.rpc("salvar_estado", {
      p_casal: sess.casal,
      p_estado: estado,
    });
    if (error) {
      if ((error.message || "").includes("casal_invalido")) return json({ erro: "código não encontrado" }, 404);
      return json({ erro: "falha ao salvar" }, 500);
    }
    return json({ ok: true, ...(data as Record<string, unknown>), ...renovado });
  }

  return json({ erro: "operação desconhecida" }, 400);
});
