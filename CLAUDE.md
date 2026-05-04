@AGENTS.md

# AutoZap — Contexto Técnico Permanente

## Stack
- Next.js App Router (versão atual do projeto — ver AGENTS.md)
- Supabase (auth + banco + storage para fotos/logos)
- Cloudflare R2 (vídeos — bucket `videos-estoque`)
- Upstash QStash (fila de jobs assíncronos)
- Gemini 2.5 Flash (roteiros e busca web)
- OpenAI TTS + Whisper (voiceover e timestamps)
- FFmpeg (dois binários — ver seção abaixo)

## Modelos Gemini — regras obrigatórias
- **Modelo principal:** `gemini-2.5-flash` com `{ apiVersion: "v1beta" }`
- **`gemini-2.0-flash-lite` está DESCONTINUADO** — retorna 404. Nunca usar.
- `systemInstruction` deve ser passado no `getGenerativeModel(...)`, **nunca** no `startChat(...)` — a API rejeita com 400.
- Histórico do `startChat` deve começar sempre com role `"user"` — nunca `"model"`. Filtrar mensagens iniciais do assistente antes de montar o histórico.

## Regra crítica de storage
| Tipo de arquivo | Onde vai | Como acessar |
|-----------------|----------|--------------|
| Fotos de veículos | Supabase Storage | URL direta do Supabase |
| Logos de garagens | Supabase Storage — bucket `configuracoes`, path `logos/{user_id}.png` | `supabaseAdmin.storage.from("configuracoes").download(path)` |
| Vídeos brutos e marketing | Cloudflare R2 — bucket `videos-estoque` | `toVideoUrl()` em `lib/r2-url.ts` → proxy `/api/r2/[...path]` |
| Músicas de fundo | Cloudflare R2 — `musicas/animado.mp3`, `elegante.mp3`, `emocional.mp3` | `preset:animado` → `${R2_PUBLIC_URL}/musicas/animado.mp3` |

**NUNCA enviar vídeos para o Supabase Storage.**

## Pipeline de vídeo de marketing (`lib/marketing-pipeline.ts`)
Dois binários FFmpeg com responsabilidades distintas:
- **`ffmpeg-static`** (FFmpeg 7.0.2) — pass 1: xfade, logo overlay, áudio, codec intermediário `mpeg4 -q:v 4`
- **`@ffmpeg-installer/ffmpeg`** (build 2018) — pass 2: legendas via `drawtext` (tem libfreetype, sem xfade)

O intermediário **deve ser `mpeg4`**, não `libx264` — o binário 2018 não consegue decodificar H.264 gerado pelo FFmpeg 7.0.2 (incompatibilidade de NAL units).

Paths de tmp são por job: `/tmp/ffmpeg_{veiculoId}`, `/tmp/ffmpeg_caps_{veiculoId}`, `Montserrat-Black-{veiculoId}.ttf` — limpos no `finally`.

## Multi-tenancy e segurança de API
- `requireAuth()` — só verifica sessão válida
- `requireVehicleOwner(veiculoId)` — verifica que o veículo pertence ao user autenticado
- `requireLeadOwner(leadId)` — idem para leads
- **Vendedores** têm `user_metadata.role === "vendedor"` e `user_metadata.owner_user_id` no Supabase Auth. O `effectiveUserId` para vendedor é o `owner_user_id`, não o `user.id` próprio. Isso já está implementado nos helpers acima.
- Rotas que aceitam `veiculoId` devem usar `requireVehicleOwner`, nunca apenas `requireAuth`.
- `supabaseAdmin` ignora RLS — toda validação de posse deve ser feita manualmente nas API routes.

## Regras de segurança — padrões obrigatórios

### Webhooks externos (Meta, PagarMe, QStash)
- **NUNCA fail-open.** Se a env var do secret não estiver configurada, retornar 401 — nunca pular a verificação.
- Usar `timingSafeEqual` (crypto) para comparação de HMAC — nunca `===` direto (timing attack).
- Meta `signed_request`: verificar HMAC-SHA256 no campo encodedPayload antes de decodificar o JSON.

### Registro de usuários
- Novos usuários criados via `POST /api/auth/register` recebem `user_metadata.aprovado: false`.
- Acesso pleno só após aprovação manual pelo admin via `POST /api/admin/aprovar`.

### Upload de arquivos
- `POST /api/upload` aceita apenas tipos de vídeo: `video/mp4`, `video/webm`, `video/quicktime`, `video/x-msvideo`, `video/mpeg`.
- **Nunca** aceitar `text/html` ou outros tipos não-vídeo — CDN público serviria como XSS.

### Fetch de URLs externas (SSRF)
- Antes de fazer `fetch(videoUrl)` ou qualquer URL fornecida pelo cliente, validar que o hostname está na allowlist: `R2_PUBLIC_URL` e `NEXT_PUBLIC_SUPABASE_URL`.
- Rejeitar qualquer URL não-`https:` ou com hostname fora da allowlist.

### HTML em conteúdo dinâmico (dangerouslySetInnerHTML)
- Sempre escapar `&`, `<`, `>`, `"`, `'` **antes** de aplicar substituições de markdown/links.
- Padrão: `text.replace(/&/g,"&amp;").replace(/</g,"&lt;")...` e depois as substituições seguras.

## Variáveis de ambiente importantes
- `R2_PUBLIC_URL` — URL pública do R2 (ex: `https://pub-xxx.r2.dev`) — server-side only
- `NEXT_PUBLIC_R2_PUBLIC_URL` — **NÃO usar para resolver URLs de mídia** — aponta para o domínio da app, não para o R2
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — credenciais R2
- `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` — Upstash

## Worker de vídeo (`app/api/marketing/worker/route.ts`)
- `maxDuration = 300` (5 min — limite do plano Hobby da Vercel)
- Idempotente: pula se veículo já está `pronto`
- `iniciar` route bloqueia double-click checando status `processando` antes de publicar no QStash

## Proxy R2 (`app/api/r2/[...path]/route.ts`)
Proxy Node.js (sem `edge` runtime) com suporte a Range requests para seek de vídeo.
`toVideoUrl()` em `lib/r2-url.ts` reescreve URLs `pub-xxx.r2.dev` → `/api/r2/<key>`.

## Agente de Chat WhatsApp (`lib/process-whatsapp.ts`)

### Arquitetura geral do processamento (em ordem)
1. Transcrição de áudio (Whisper via Gemini)
2. Comandos especiais (`!status`, `!reset`, agenda do gerente)
3. Upsert do lead + salva mensagem do usuário
4. Stand-by: se `em_atendimento_humano = true`, IA ignora
5. Config da garagem (nome, endereço, vitrine, tom)
6. Carrega `veiculoPrincipal` do banco via `lead.veiculo_id`
7. `hybridVehicleSearch` — busca textual + semântica, detecta troca de carro
8. Atualiza `veiculo_id` do lead via **heurística** (modelo explícito na mensagem)
9. `buildStockContext` — monta contexto separando "VEÍCULO EM FOCO" de "ALTERNATIVAS"
10. Carrega histórico **inteligente**: 2 primeiras msgs (saudação + nome) + 13 mais recentes, sem duplicatas (Redis → Supabase fallback)
11. Interceptores: pós-venda → stand-by automático
12. Envio de foto (se pedido) — early return sem chamar Gemini
13. Envio de vídeo (se pedido) — early return sem chamar Gemini
14. **`injectHistoryCorrection`** — injeta correção sintética antes do Gemini (ver abaixo)
15. Gemini gera JSON: `{ resposta, veiculo_id_foco, temperatura, resumo, nome_cliente_extraido, precisa_instrucao }`
16. Aplica `veiculo_id_foco` com validação no banco (ver abaixo)
17. Salva resposta + invalida cache + auto-agenda + transbordo QUENTE
18. Envia resposta ao cliente

### Rastreamento do carro em foco — duas camadas

**Camada 1 — Heurística (passo 8):** `hybridVehicleSearch` detecta `clientePediuCarroDiferente` quando o modelo aparece explicitamente na mensagem. Rápida e confiável para trocas explícitas.

**Camada 2 — Gemini (passo 16):** O JSON de resposta inclui `veiculo_id_foco` com o ID do carro em negociação. Cobre linguagem indireta ("mas vi um prata", "e aquele?") que a heurística não pega.

Validação obrigatória antes de aplicar o `veiculo_id_foco`:
```typescript
// Valida UUID format + existência no banco do tenant + status DISPONIVEL
.eq("id", veiculoIdFoco)
.eq("user_id", tenantUserId)      // ← impede cross-tenant
.eq("status_venda", "DISPONIVEL") // ← impede carro vendido
```
Se inválido → log `⚠️ veiculo_id_foco inválido ou de outro tenant rejeitado` e mantém o anterior.

### `injectHistoryCorrection` — quebra de loop de preço

Função pura chamada antes do `chatRequest`. Detecta loop de "vou verificar o preço/km" no histórico do agente e injeta uma mensagem `role: "model"` corretiva — **apenas para aquela call, não salva no banco**.

Só ativa se:
1. Alguma mensagem do agente no histórico contém padrão de loop (ex: "vou verificar o preço")
2. **E** o contexto atual contém o dado (preço ou km extraído por regex do `buildStockContext`)

Log quando ativa: `🔧 [Loop detector] Injetando correção de histórico. Dados confirmados: preço(s): R$ X`

### Resposta JSON obrigatória do Gemini
```json
{
  "resposta": "texto enviado ao cliente",
  "veiculo_id_foco": "UUID do carro em negociação ou null",
  "temperatura": "FRIO" | "MORNO" | "QUENTE",
  "resumo": "intenção do cliente em uma frase",
  "nome_cliente_extraido": "nome ou null",
  "precisa_instrucao": "dúvida para o gerente ou null"
}
```
- `systemInstruction` é passado diretamente no `generateContent` (não no `startChat`) — exigência da API Gemini.
- Histórico nunca começa com `role: "model"` — mensagens iniciais do assistente são filtradas.

