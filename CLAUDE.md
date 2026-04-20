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
