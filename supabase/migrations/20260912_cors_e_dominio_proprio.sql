-- Trava o CORS da API nos endereços conhecidos.
--
-- Enquanto `origens_permitidas` estava vazia, a função respondia
-- "Access-Control-Allow-Origin: *" — qualquer site podia chamar a API pelo
-- navegador de quem estivesse logado. A lista abaixo fecha isso.
--
-- Endereços:
--   casamento.darienzoxd.workers.dev   endereço atual (Cloudflare Workers)
--   casamento.rayanestore.com.br       domínio próprio (ver DOMINIO.md)
--   casameto.rayanestore.com.br        grafia alternativa, liberada por segurança
--
-- Endereço novo do app entra aqui ANTES de publicar: fora da lista, a
-- página abre mas não sincroniza. `configuracao.origens_vistas` mostra de
-- onde a API andou sendo chamada, inclusive chamadas barradas.

insert into configuracao (chave, valor)
values (
  'origens_permitidas',
  'https://casamento.darienzoxd.workers.dev,' ||
  'https://casamento.rayanestore.com.br,' ||
  'https://casameto.rayanestore.com.br'
)
on conflict (chave) do nothing;
