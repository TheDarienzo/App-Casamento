# 🚀 Como publicar o app (2 minutos, sem código)

O backend já está no ar no Supabase — você só precisa hospedar os arquivos
desta pasta em qualquer serviço de páginas estáticas. Passo a passo no
Cloudflare Pages (grátis):

1. Entre em [dash.cloudflare.com](https://dash.cloudflare.com).
2. No menu, abra **Workers & Pages** → botão **Create** → aba **Pages** →
   **Upload assets** (upload direto, sem Git).
3. Dê um nome ao projeto (ex.: `nosso-casamento`) — ele define a URL:
   `nosso-casamento-abc.pages.dev`.
4. **Arraste todos os arquivos desta pasta** (importante: o `index.html`
   precisa ficar na raiz do upload, então arraste o conteúdo da pasta, não o
   zip) e clique em **Deploy site**.
5. Abra a URL gerada no celular e use **Adicionar à tela inicial /
   Instalar app** — pronto, é um aplicativo com ícone, tela cheia e
   funciona offline.


## Publicando uma atualização

1. Rode `node scripts/subir-versao.mjs` (sobe o número da versão em
   `sw.js` e `js/app.js` — é o que faz os celulares perceberem a novidade).
2. Reenvie os arquivos no Cloudflare (**New deployment → Upload assets**).
3. Pronto: **ao abrir o app**, cada celular já busca a versão nova. Se ela
   existir, o app se atualiza sozinho na hora. Em **Configurações → Versão
   do app** dá para conferir qual está rodando e forçar a busca.

## Os dois celulares vendo as mesmas listas

Cada pessoa tem seu login. Para compartilharem o mesmo casamento, o par
deve **criar a conta colando o código do casal** (que aparece em
**Configurações → Conta**). Se as contas acabarem separadas, use
**Configurações → Conta → "Juntar minha conta à do meu par"**: as listas
dos dois são somadas, sem perder nada.

## Onde está cada coisa

- **Página do app**: estes arquivos (HTML/CSS/JS) — hospede onde quiser.
- **Backend**: projeto Supabase `App-Casamento`, Edge Function `app`
  (API de sincronização) + tabela `casamentos`.
- O endereço da API está fixado em `js/app.js` (constante `API_URL`).

> Por que não servir a página direto do Supabase? Por política da
> plataforma, Edge Functions reescrevem `text/html` para `text/plain` —
> elas são só para APIs. A página precisa de um host de estáticos.
