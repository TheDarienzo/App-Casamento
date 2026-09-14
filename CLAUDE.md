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

## Sincronização entre celulares — regras que não podem quebrar

Cada aparelho guarda, além do estado, a **base**: a última resposta do
servidor (`nosso-casamento-base`). O envio é sempre a **diferença** entre o
estado e a base — só os cadastros que este aparelho mudou.

- **Nunca mandar o estado inteiro.** Sem base, busca primeiro
  (`sincronizarAoAbrir`) e põe por cima só o que mudou aqui. Foi um envio
  "de tudo" ao abrir o app que apagou alterações da Rayane: o servidor grava
  linha por linha e a cópia velha de um celular passou por cima.
- **Base e tela andam juntas.** Só `adotarNuvem()` atualiza a base, e ela
  troca o estado no mesmo ato. Se a base avançar e a tela não, o envio
  seguinte leva como "alteração daqui" tudo o que o outro celular mudou.
- Toda chamada leva `versao`. O servidor recusa gravação (426) de versão
  abaixo de `configuracao.versao_minima_gravacao`; leitura continua. Ao
  mudar o formato do envio, subir esse mínimo junto com a versão.
- Tempo real: depois de cada gravação (e de cada confirmação de convidado)
  a Edge Function manda um aviso vazio pelo Realtime, canal
  `casal-<hash>`; o app busca pela API ao receber. O ciclo de 7 s continua
  como rede de segurança. A CSP precisa liberar `wss://…supabase.co`.
- Teste de referência: `teste-abertura.mjs` (cópia velha ao abrir, resposta
  durante edição, edição sem conexão) — os três cenários têm de passar.

## Aplicativo

- Português do Brasil em tudo: interface, nomes de variáveis e comentários.
- Valores em centavos (`bigint`), exibidos com `brl()`.
- Sem dependências novas e sem etapa de build.
- Desempenho: nada de filtro SVG, `backdrop-filter` ou
  `background-attachment: fixed` em tempo de execução. Animação só com
  `transform` e `opacity`. Já custou lentidão uma vez: o navegador
  recalculava os filtros a cada redesenho.
- Visual: marfim, verde-oliva, dourado e rosa-chá, cantos arredondados e
  sombras suaves — Fraunces nos títulos e números, Karla no texto. Nada de
  textura de aquarela nem fonte manuscrita (testado e rejeitado).

## Página do convite (`convite/`)

Página pública que os convidados abrem. Fica no mesmo endereço, em
`/convite/`, e é a **única parte do sistema que responde sem sessão**.

- Só as operações `convite_*` da API são públicas, com limite de acessos
  por origem. Nenhuma delas devolve telefone, lista inteira ou o código do
  casal — a página é identificada por um apelido público (`convite.slug`).
- Cada família tem um `convidados.codigo` curto: o link pessoal
  (`/convite/#codigo`) abre a página já com o nome dela. Quem receber o
  link encaminhado acha o próprio nome pela busca.
- O convite só aparece com `convite.publicado = true`.
- O service worker do app não intercepta `/convite`.

## Publicação

`node scripts/subir-versao.mjs`, gerar o zip com `index.html`,
`manifest.webmanifest`, `sw.js`, `_headers`, `css/`, `js/`, `icons/` e
`convite/`, e
subir no Cloudflare em *New deployment → Upload assets*. O `_headers`
precisa ficar na raiz do upload. Detalhes em `PUBLICAR.md`.

A API só responde aos endereços listados em
`configuracao.origens_permitidas`. **Endereço novo do app (domínio
próprio, teste, o que for) entra nessa lista antes de publicar** — senão
a página abre e nada salva. Passo a passo do domínio em `DOMINIO.md`.
