// Edge Function "app" — API de sincronização do PWA Nosso Casamento.
//
// O Supabase não serve páginas HTML (GET text/html vira text/plain, por
// política da plataforma), então o app é hospedado fora (Cloudflare Pages,
// GitHub Pages, …) e conversa com esta API:
//
//   POST .../functions/v1/app/api  → { op: "criar" | "estado" | "salvar", ... }
//
// Autenticação: o acesso aos dados exige o código do casal (uuid aleatório,
// impossível de adivinhar), que funciona como chave secreta compartilhada.
// A tabela `casamentos` tem RLS ligado sem policies — só esta função
// (service role) consegue acessá-la.

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ESTADO_MAX_BYTES = 512_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function json(dados: unknown, status = 200): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (req.method !== "POST") {
    return json({
      app: "Nosso Casamento",
      status: "ok",
      aviso: "Esta é a API de sincronização; o aplicativo fica no endereço publicado no Cloudflare/GitHub Pages.",
    });
  }

  let corpo: Record<string, unknown>;
  try {
    // o cliente envia como text/plain para evitar preflight; ainda é JSON
    corpo = JSON.parse(await req.text());
  } catch {
    return json({ erro: "JSON inválido" }, 400);
  }

  const op = corpo.op;

  if (op === "login") {
    const usuario = String(corpo.usuario ?? "").trim();
    const senha = String(corpo.senha ?? "");
    if (!usuario || !senha) return json({ erro: "informe usuário e senha" }, 400);
    const { data, error } = await supabase.rpc("login_usuario", {
      p_usuario: usuario,
      p_senha: senha,
    });
    if (error) return json({ erro: "falha no login" }, 500);
    if (!data) return json({ erro: "usuário ou senha incorretos" }, 401);
    return json({ casal: data });
  }

  if (op === "criar_conta") {
    const usuario = String(corpo.usuario ?? "").trim();
    const senha = String(corpo.senha ?? "");
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
      if (m.includes("senha_curta")) return json({ erro: "a senha precisa ter ao menos 4 caracteres" }, 400);
      if (m.includes("casal_invalido")) return json({ erro: "código do casal não encontrado" }, 404);
      return json({ erro: "falha ao criar conta" }, 500);
    }
    return json({ casal: data });
  }

  if (op === "criar") {
    const estado = typeof corpo.estado === "object" && corpo.estado !== null ? corpo.estado : {};
    const { data, error } = await supabase
      .from("casamentos")
      .insert({ estado })
      .select("id")
      .single();
    if (error || !data) return json({ erro: "falha ao criar" }, 500);
    return json({ casal: data.id });
  }

  const casal = String(corpo.casal ?? "");
  if (!UUID_RE.test(casal)) return json({ erro: "código não encontrado" }, 404);

  if (op === "estado") {
    const { data, error } = await supabase
      .from("casamentos")
      .select("estado, atualizado_em")
      .eq("id", casal)
      .maybeSingle();
    if (error) return json({ erro: "falha ao consultar" }, 500);
    if (!data) return json({ erro: "código não encontrado" }, 404);
    return json(data);
  }

  if (op === "salvar") {
    const estado = corpo.estado;
    if (typeof estado !== "object" || estado === null) return json({ erro: "estado inválido" }, 400);
    if (JSON.stringify(estado).length > ESTADO_MAX_BYTES) return json({ erro: "estado grande demais" }, 413);
    const { data, error } = await supabase
      .from("casamentos")
      .update({ estado, atualizado_em: new Date().toISOString() })
      .eq("id", casal)
      .select("id, atualizado_em")
      .maybeSingle();
    if (error) return json({ erro: "falha ao salvar" }, 500);
    if (!data) return json({ erro: "código não encontrado" }, 404);
    return json({ ok: true, atualizado_em: data.atualizado_em });
  }

  return json({ erro: "operação desconhecida" }, 400);
});
