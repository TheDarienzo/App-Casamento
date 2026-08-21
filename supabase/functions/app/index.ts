// Edge Function "app" — serve o PWA Nosso Casamento e a API de sincronização.
//
// Rotas:
//   GET  /functions/v1/app/...   → arquivos estáticos do app (embutidos em assets.ts)
//   POST /functions/v1/app/api   → { op: "criar" | "estado" | "salvar", ... }
//
// Autenticação: o acesso aos dados exige o código do casal (uuid aleatório,
// impossível de adivinhar), que funciona como chave secreta compartilhada.
// A tabela `casamentos` tem RLS ligado sem policies — só esta função
// (service role) consegue acessá-la.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { ASSETS } from "./assets.ts";
import { gerarIcone } from "./icons.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ESTADO_MAX_BYTES = 512_000;

function json(dados: unknown, status = 200): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function tratarApi(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return json({ erro: "JSON inválido" }, 400);
  }

  const op = corpo.op;

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
      .select("id")
      .maybeSingle();
    if (error) return json({ erro: "falha ao salvar" }, 500);
    if (!data) return json({ erro: "código não encontrado" }, 404);
    return json({ ok: true });
  }

  return json({ erro: "operação desconhecida" }, 400);
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // caminho relativo à função, servida em /functions/v1/app
  let path = url.pathname.replace(/^\/functions\/v1\/app/, "");
  if (path === url.pathname) path = path.replace(/^\/app/, "");

  if (path === "/api") return tratarApi(req);

  if (req.method !== "GET") return new Response("Método não suportado", { status: 405 });

  // sem a barra final os caminhos relativos do HTML quebrariam
  if (path === "") {
    return new Response(null, { status: 301, headers: { Location: url.pathname + "/" } });
  }
  if (path === "/") path = "/index.html";

  // ícones PNG são gerados em memória (e ficam em cache na instância)
  if (path.startsWith("/icons/") && path.endsWith(".png")) {
    const icone = await gerarIcone(path.slice("/icons/".length));
    if (!icone) return new Response("Não encontrado", { status: 404 });
    return new Response(icone as BodyInit, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
    });
  }

  const asset = ASSETS[path];
  if (!asset) return new Response("Não encontrado", { status: 404 });

  const semCache = path === "/index.html" || path === "/sw.js";
  return new Response(asset.body, {
    headers: {
      "Content-Type": asset.type,
      "Cache-Control": semCache ? "no-cache" : "public, max-age=3600",
    },
  });
});
