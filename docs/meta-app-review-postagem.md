# App Review — postar no Facebook e no Instagram pelo AutoZap

App: **AutoZap Digital** (`1371434341765309`). Preparado em 12/09/2026.

## Estado atual (já feito no painel)

Casos de uso adicionados:

- **Gerenciar tudo na sua Página** (API de Páginas)
- **Gerenciar mensagens e conteúdo no Instagram** (API do Instagram)

Permissões já em "Pronto para teste" (dentro da análise, ainda não enviadas):

| Permissão | Para quê |
|---|---|
| `pages_manage_posts` | publicar foto/carrossel na Página do Facebook do lojista |
| `instagram_basic` | ler a conta do Instagram vinculada à Página (id, username) |
| `instagram_content_publish` | publicar foto/carrossel/reel no Instagram |

⚠️ **Duas famílias de permissão do Instagram — não confundir.** `instagram_business_*` é da API
com **Login do Instagram**; `instagram_basic`/`instagram_content_publish` é da API com **Login do
Facebook**, que é a que o AutoZap usa (o token sai do OAuth da Página, em `/api/meta/connect`).
Cheguei a marcar `instagram_business_content_publish` por engano e removi — permissão sobrando na
submissão é motivo de recusa, porque não aparece no vídeo.

## Ordem obrigatória (não dá pra inverter)

A Meta exige **screencast do recurso funcionando**. Em Modo de Desenvolvimento as permissões já
funcionam para admin/testador do app, então:

1. Codar o botão "Postar agora" (Feed/Story/Reel × Facebook/Instagram) no Kit de Postagem.
2. Adicionar os escopos novos em `/api/meta/connect` e reconectar a APROVE (token antigo NÃO
   ganha escopo novo).
3. Testar publicando de verdade na página e no @aprove_multimarcas.
4. Gravar o vídeo.
5. Enviar a análise.

## O que o vídeo precisa mostrar (roteiro)

Sem cortes, com a tela do app visível o tempo todo:

1. Login no AutoZap (painel do lojista).
2. Configurações → "Conectar com o Facebook" → tela de consentimento da Meta com as permissões
   aparecendo → autorizar.
3. Estoque → um carro → Kit de Postagem (mostrar as artes já geradas e a legenda).
4. Clicar em "Postar agora", escolher Facebook + Instagram, confirmar.
5. Abrir a Página no Facebook e o perfil no Instagram mostrando o post publicado.

## Justificativa (texto para colar na submissão, em inglês)

### pages_manage_posts

> AutoZap is a SaaS used by car dealerships in Brazil to manage their inventory and marketing.
> For each vehicle, the dealer generates a post kit (images plus caption) inside AutoZap. This
> permission lets the dealer publish that kit to their own Facebook Page directly from AutoZap,
> with one click, instead of downloading the images and uploading them by hand on a phone.
> The app only publishes to Pages the logged-in dealer owns and explicitly selected, and only
> when the dealer clicks "Post now". AutoZap never posts on its own.

### instagram_basic

> AutoZap needs to identify the Instagram Business account connected to the dealer's Facebook
> Page, so the dealer can pick where the post goes and see the account name confirmed in the UI
> before publishing. We only read the account id, username and profile picture.

### instagram_content_publish

> Same flow as the Facebook Page: the dealer generates a vehicle post kit inside AutoZap and
> clicks "Post now" to publish it to their own Instagram Business account as a feed photo,
> carousel or reel. Publishing is always triggered manually by the dealer, for accounts they
> own and connected themselves through Facebook Login.

## Detalhes técnicos da implementação (para codar)

**Facebook (foto única):** `POST /{page-id}/photos` com `url` + `caption`, token da Página.
**Facebook (carrossel):** subir cada foto com `published=false` → juntar os ids em
`POST /{page-id}/feed` com `attached_media`.

**Instagram (foto):** `POST /{ig-user-id}/media` com `image_url` + `caption` → `POST
/{ig-user-id}/media_publish` com o `creation_id`.
**Instagram (carrossel):** um container por imagem com `is_carousel_item=true` → container
`media_type=CAROUSEL` com `children` → publish. De 2 a 10 imagens.
**Instagram (reel):** `media_type=REELS` + `video_url` (o vídeo do kit, servido pelo R2).

Limites da Meta: Instagram aceita **50 publicações por 24h** por conta; imagem precisa ser JPEG
em URL pública (as do kit no Storage do Supabase servem) e a arte do kit já sai em 1080x1350,
proporção que o Instagram aceita.

---

# Rodada 2 — apagar o post quando o carro vende (`instagram_manage_contents`)

Levantado em **17/09/2026**, direto da API do App Review (MCP devtools), não do painel.

## Estado real hoje — o que a API respondeu

| Permissão | Status | No rascunho? |
|---|---|---|
| `pages_manage_posts` | **não aprovada** | sim |
| `instagram_basic` | **não aprovada** | sim |
| `instagram_content_publish` | **não aprovada** | sim |
| `instagram_manage_contents` | **nem pedida ainda** | não |

Ou seja: **postar no Face/Insta funciona hoje só porque a conta da APROVE tem cargo no app**
(admin/testador). Para um tenant novo, sem cargo, não funcionaria. As 3 permissões da rodada 1
seguem com os 4 passos em aberto: `use_case`, `screencast`, `api_precheck`, `data_use_checkup`.

⚠️ **Bloqueio para enviar agora:** a API responde
`can_submit: false — "Cannot submit to App Review while a previous submission is in review."`
Já passaram (aprovadas): Marketing API Access Tier, `whatsapp_business_messaging` +
`whatsapp_business_management`. Confirmar no painel qual submissão ainda está em análise antes
de tentar enviar — provavelmente a de WhatsApp de 16/08.

## A boa notícia: não precisa esperar a aprovação pra funcionar na APROVE

Permissão não aprovada **já funciona para quem tem cargo no app**. Então, para a APROVE, o
apagar do Instagram passa a funcionar assim que:

1. `instagram_manage_contents` for adicionada ao caso de uso no painel do app;
2. o Lucas reconectar o Facebook em Configurações (**escopo novo não entra em token já emitido**);
3. pronto — a venda passa a apagar o post do Instagram também.

O escopo já está no `/api/meta/connect` (commit desta rodada). Sem o passo 1, a Meta ignora o
escopo e o resto do login continua normal — não quebra nada.

## Justificativa para colar na submissão (inglês)

### instagram_manage_contents

> AutoZap is a SaaS used by car dealerships in Brazil. When a dealer marks a vehicle as SOLD in
> AutoZap, the app takes down the marketing content for that vehicle so buyers stop contacting
> the dealer about a car that no longer exists: it pauses the paid campaigns, removes the
> classified listing, deletes the Facebook Page post, and — with this permission — deletes the
> Instagram post that AutoZap itself published for that vehicle. AutoZap only deletes media it
> created through the API for that vehicle (the media id is stored when publishing), only on the
> dealer's own Instagram Business account, and only when the dealer marks the car as sold. It
> never deletes content published by anyone else.

## Roteiro do vídeo (rodada 2 — mostra publicar E apagar)

Sem cortes, tela do app visível o tempo todo:

1. Login no AutoZap.
2. Configurações → "Conectar com o Facebook" → tela de consentimento **mostrando as permissões**
   → autorizar.
3. Marketing → Kits de Postagem → um carro com kit pronto → **Postar no Face + Insta**.
4. Mostrar o aviso "● No ar — Facebook · agora | Instagram · agora" que aparece embaixo do botão.
5. Abrir os dois links: post no Facebook e post no Instagram publicados.
6. Voltar ao AutoZap → Estoque → **marcar o carro como Vendido**.
7. Recarregar a Página do Facebook e o perfil do Instagram: os dois posts **sumiram**.

O passo 6-7 é o que justifica a permissão nova — é o único trecho que a rodada 1 não tinha.

## Onde isso está no código

| O quê | Arquivo |
|---|---|
| Escopos do OAuth | `app/api/meta/connect/route.ts` |
| Publicar / apagar (Graph) | `lib/meta-organico.ts` — `postarNoFacebook`, `postarNoInstagram`, `apagarPost` |
| Rota de publicar | `app/api/marketing/postar/route.ts` |
| Apagar na venda | `app/api/veiculo/vender/route.ts` — passo 2d, `removerPostsDoVeiculo()` |
| Onde ficam os ids | `veiculos.marketing_posts` (migration 061) |
