# Nosso Casamento — regras do projeto

PWA de planejamento de casamento (Rayane & Lucas). HTML/CSS/JS puro, sem
framework e sem build. Página hospedada no Cloudflare Workers; dados no
Supabase (projeto `rgxkmntpdbvvqcwksrwl`, plano gratuito).

## Banco de dados — regra principal

**Todo dado do aplicativo mora em tabela, com coluna própria para cada
campo. Nunca guardar cadastro dentro de um documento JSON.**

- Tela nova → **tabela nova**.
- Campo novo numa tela que já existe → **coluna nova** na tabela dela.
- Não usar `jsonb` como depósito de registros. A coluna `casamentos.estado`
  existe só como cópia de segurança do formato antigo; nada novo entra nela.

Isso não é preferência de estilo: enquanto tudo ficava num JSON só, cada
salvamento reescrevia o conjunto inteiro, e um aparelho apagou o cadastro
do outro. Convidados e anotações foram perdidos de verdade, sem backup
(plano gratuito não tem restauração).

### Formato de cada tabela

Toda tabela de cadastro segue o mesmo desenho:

```sql
id            text primary key          -- o mesmo id que o app gera
casal_id      uuid not null references casamentos(id) on delete cascade
…                                        -- as colunas da tela
criado_em     timestamptz not null default now()
atualizado_em timestamptz not null default now()   -- trigger marcar_atualizacao
apagado_em    timestamptz                          -- soft delete
```

- **RLS ligado, sem policies.** Só a Edge Function (service role) acessa.
- **Exclusão é sempre soft delete** (`apagado_em`), nunca `delete`: o
  registro some da tela mas continua recuperável, e a exclusão se propaga
  entre os aparelhos.
- Índices: `(casal_id) where apagado_em is null` e `(casal_id, atualizado_em)`.

### Ao adicionar tabela ou coluna, atualizar junto

1. Migração em `supabase/migrations/` **e** aplicada no projeto (as duas
   coisas — o arquivo local sozinho não vale).
2. `ler_estado(uuid)` — monta o JSON que o app espera, lendo das tabelas.
3. `salvar_estado(uuid, jsonb)` — grava cada cadastro na sua linha.
4. `js/app.js` — o formato do estado e as telas.
5. Rodar `node scripts/subir-versao.mjs` antes de gerar o zip.

### Regras das funções de gravação

- `salvar_estado` **nunca apaga o que não veio no envio**. Só sai da tela o
  que está na lista `apagados`. Foi a falta dessa regra que causou a perda.
- Gravação é `insert … on conflict (id) do update … where tabela.casal_id =
  excluded.casal_id` — assim um casal não consegue escrever na linha de outro.
- Valor vindo do aparelho passa por `para_inteiro` / `para_booleano` /
  `para_data` / `para_tempo`: dado inválido vira padrão em vez de derrubar
  o salvamento.
- Toda função nova: `set search_path = public`, e `revoke execute … from
  anon, authenticated, public` + `grant execute … to service_role`. Sem
  isso qualquer um com a chave pública do projeto chama pelo `/rest/v1/rpc/`.

## Aplicativo

- Português do Brasil em tudo: interface, nomes de variáveis e comentários.
- Valores em centavos (`bigint`), exibidos com `brl()`.
- Sem dependências novas e sem etapa de build.
- Desempenho: nada de filtro SVG, `backdrop-filter` ou
  `background-attachment: fixed` em tempo de execução — texturas são
  assadas em WebP por `scripts/` e o CSS só desenha o bitmap.

## Publicação

`node scripts/subir-versao.mjs`, gerar o zip com `index.html`,
`manifest.webmanifest`, `sw.js`, `_headers`, `css/`, `js/`, `icons/`,
`img/*.webp`
(os `.svg` de origem ficam fora), e subir no Cloudflare em
*New deployment → Upload assets*. Detalhes em `PUBLICAR.md`.
