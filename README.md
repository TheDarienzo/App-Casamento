# 💍 Nosso Casamento — PWA de planejamento

Aplicativo web instalável (PWA) para o casal organizar os preparativos do casamento direto do celular — funciona offline e guarda tudo no próprio aparelho.

## Funcionalidades

- **Dashboard** — contagem regressiva ao vivo (dias, horas, minutos e segundos) até o grande dia, total de convidados, pendências com valor em aberto, progresso do checklist, orçamento (resolvido × pendente) e distribuição de convidados por lado do casal.
- **Lista de convidados** — cada convidado entra no lado da noiva ou do noivo (os botões usam os nomes do casal), com acompanhantes e confirmação de presença. Totais por lado, geral e de confirmados.
- **Checklist & custos** — tarefas com valor em R$, marcadas como resolvidas ou pendentes, com totais: geral, resolvido e pendente. Aceita valores como `3.500,00`, `2800` ou `450,90`.
- **Padrinhos & madrinhas** — lista de pares, com contagem de pares e pessoas.
- **Fornecedores** — nome, categoria e contato com link direto para o WhatsApp.
- **Configurações** — nomes do casal, data/hora e local do casamento, backup (exportar/importar JSON) e limpeza dos dados.

## Como usar

A página é estática (hospede em qualquer serviço de estáticos — veja o passo
a passo em `PUBLICAR.md`). A sincronização entre celulares usa uma Edge
Function no Supabase (projeto `App-Casamento`, função `app` + tabela
`casamentos`); sem ela o app continua funcionando, só que com os dados
apenas no aparelho.

### Publicar no GitHub Pages (recomendado)

1. No repositório, vá em **Settings → Pages**.
2. Em *Source*, escolha **Deploy from a branch**, selecione a branch principal e a pasta `/ (root)`.
3. Abra a URL gerada (`https://<usuario>.github.io/App-Casamento/`) no celular.
4. No Chrome/Safari, use **Adicionar à tela inicial** — o app instala como um aplicativo de verdade, com ícone e tela cheia.

> O PWA exige HTTPS (o GitHub Pages já fornece). Abrindo o `index.html` direto do disco o app funciona, mas sem instalação/offline.

### Rodar localmente

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

## Importante saber

- Os dados ficam no `localStorage` **do aparelho** — noiva e noivo em celulares diferentes têm listas separadas. Para sincronizar, usem **Exportar backup** em um aparelho e **Importar backup** no outro (ou evoluam o app para um backend, ver ideias abaixo).
- Exportem um backup de vez em quando: limpar os dados do navegador apaga tudo.

## Ideias para as próximas versões

- 🎁 **Lista de presentes** com link para lojas ou chave Pix por presente.
- 🪑 **Mapa de mesas** — arrastar convidados confirmados para as mesas da recepção.
- 📅 **Cronograma do grande dia** — linha do tempo hora a hora (making of, cerimônia, fotos, festa).
- 🎵 **Playlist** — músicas da cerimônia (entrada, alianças, saída) e pedidos para a festa.
- ✉️ **RSVP online** — página pública para o convidado confirmar presença sozinho (aí sim com um backend, ex.: Supabase ou Firebase, que também sincronizaria os dados entre os dois celulares).
- 🌙 **Lua de mel** — checklist de viagem, documentos e reservas.
- 📸 **Mural de inspirações** — fotos de referência de decoração, vestido, bolo.
- 🔔 **Lembretes** — notificações de tarefas com prazo chegando.
- 💌 **Convite digital** — página do casal com história, fotos e informações do evento para mandar no WhatsApp.

## Estrutura

```
index.html            # todas as telas (SPA)
css/styles.css        # tema: marfim, verde-oliva, dourado (Fraunces + Karla)
js/app.js             # estado, persistência em localStorage e renderização
sw.js                 # service worker (offline, cache-first)
manifest.webmanifest  # instalação como app
icons/                # ícones (anéis entrelaçados)
```
