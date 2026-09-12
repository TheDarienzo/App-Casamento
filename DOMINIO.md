# 🌐 Usar o endereço próprio (rayanestore.com.br)

Hoje o app e o convite ficam em
`https://casamento.darienzoxd.workers.dev`. A ideia é passar os dois para
um subdomínio de `rayanestore.com.br` — o convite é o link que vai
impresso e no WhatsApp, então vale ter um endereço bonito.

> **Atenção à grafia.** A palavra é **casamento** (com "n"):
> `casamento.rayanestore.com.br`. No pedido veio escrito "casameto", sem o
> "n". Como o link vai para os convidados e depois é chato de trocar,
> confira antes de criar. Os dois já estão liberados no servidor, então
> qualquer um dos dois funciona — mas escolha um só.

## O que muda no código

**Nada.** O app não tem nenhum endereço fixo dentro dele:

- os arquivos são carregados por caminho relativo (`css/`, `js/`, `convite/`);
- o `manifest.webmanifest` usa `start_url: "./"`;
- o link pessoal de cada convidado é montado na hora a partir do endereço
  aberto no navegador (`enderecoConvite()` em `js/app.js`), então passa a
  sair com o domínio novo sozinho;
- a CSP em `_headers` usa `'self'`, que vale para qualquer domínio.

Só o endereço da API (Supabase) é fixo, e ele não muda.

## Passo 1 — colocar rayanestore.com.br no Cloudflare

Para ligar um domínio a um Worker, o domínio precisa estar **ativo na
mesma conta do Cloudflare** (a `darienzoxd`). No plano gratuito isso só
existe de um jeito: apontar os servidores de nome (nameservers) do
registro.br para o Cloudflare.

1. Em [dash.cloudflare.com](https://dash.cloudflare.com), conta
   `darienzoxd` → **Add a domain** → digite `rayanestore.com.br` →
   escolha o plano **Free**.
2. O Cloudflare lê a zona atual e copia os registros DNS que encontrar.
   **Confira essa lista antes de seguir**, item por item — principalmente:
   - os registros **MX** (e-mail do domínio). Se faltarem, o e-mail para
     em silêncio quando a troca acontecer;
   - o registro da loja em si (`rayanestore.com.br` e `www`), para o site
     atual continuar abrindo;
   - registros **TXT** de verificação (Google, Meta, SPF, DKIM).

   O que faltar, adicione na mão antes do passo 3.
3. O Cloudflare mostra dois servidores de nome (algo como
   `xxx.ns.cloudflare.com`). No **registro.br**, entre no domínio →
   **Alterar servidores DNS** → troque os que estão lá por esses dois →
   salve.
4. Espere a propagação. Costuma levar de alguns minutos a algumas horas
   (o registro.br anuncia até 24 h). O Cloudflare manda e-mail quando a
   zona fica **Active**.

> Se a loja `rayanestore.com.br` estiver em uma plataforma que exige os
> DNS dela (Shopify, Nuvemshop, Wix e afins), dá para manter tudo: os
> registros da loja continuam existindo na zona do Cloudflare, só passam a
> ser servidos por ele. O que não dá é ter as duas zonas ativas ao mesmo
> tempo.

## Passo 2 — ligar o subdomínio no Worker

Com a zona ativa:

1. **Workers & Pages** → Worker **casamento** → **Settings** →
   **Domains & Routes** → **Add** → **Custom Domain**.
2. Digite `casamento.rayanestore.com.br` → **Add Custom Domain**.
3. O Cloudflare cria o registro DNS e emite o certificado HTTPS sozinho —
   leva uns minutos. Quando sair de "Initializing", abra o endereço.

Não crie um CNAME na mão para esse nome: o Custom Domain se recusa a subir
em cima de um CNAME que já exista.

## Passo 3 — conferir

1. Abra `https://casamento.rayanestore.com.br` e faça login. Se a lista
   carregar e uma alteração salvar, o CORS está certo.
2. Abra `https://casamento.rayanestore.com.br/convite/` — é o endereço que
   vai para os convidados.
3. Em **Configurações → Convite**, o endereço mostrado já aparece com o
   domínio novo, e os links pessoais compartilhados pelo WhatsApp também.
4. Reinstale o app na tela inicial pelo endereço novo (o antigo continua
   funcionando, mas são dois atalhos diferentes para o navegador).

O endereço `casamento.darienzoxd.workers.dev` continua no ar e continua
liberado — serve de reserva enquanto o domínio não propaga.

## O que já foi feito deste lado

A trava de CORS da API (item que estava pendente desde a revisão de
segurança) foi ligada. A lista de endereços autorizados em
`configuracao.origens_permitidas` é:

```
https://casamento.darienzoxd.workers.dev
https://casamento.rayanestore.com.br
https://casameto.rayanestore.com.br
```

Qualquer outro site que tente chamar a API pelo navegador é barrado. Se um
dia o app for para um endereço novo, **acrescente-o nessa lista antes de
publicar**, senão ele abre mas não salva nada. Para ver de que endereço o
app andou chamando, olhe `configuracao.origens_vistas` — a API anota
sozinha, inclusive quando a chamada foi barrada.
