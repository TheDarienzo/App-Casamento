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

## Sincronizar os dois celulares

No app: **Configurações → Ativar sincronização**. Copie o código do casal e
mande para o outro celular; lá: **Configurações → colar o código →
Conectar**. Os dados ficam na nuvem (Supabase) e os dois veem as mesmas
listas.

## Onde está cada coisa

- **Página do app**: estes arquivos (HTML/CSS/JS) — hospede onde quiser.
- **Backend**: projeto Supabase `App-Casamento`, Edge Function `app`
  (API de sincronização) + tabela `casamentos`.
- O endereço da API está fixado em `js/app.js` (constante `API_URL`).

> Por que não servir a página direto do Supabase? Por política da
> plataforma, Edge Functions reescrevem `text/html` para `text/plain` —
> elas são só para APIs. A página precisa de um host de estáticos.
