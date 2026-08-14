-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 043: separa o SEGREDO do webhook do LOCALIZADOR público
--
-- PROBLEMA: `webhook_token` tem dois papéis incompatíveis.
--   1) credencial única do POST /api/webhook/avisa/{token} e do
--      /api/webhook/chamada/{token}
--   2) localizador público — /vitrine/[tenant] resolve por ele, e até 14/08 o
--      sidebar usava o token como URL da vitrine quando o tenant não tinha
--      `vitrine_slug` (corrigido no commit e7a2531)
-- Ou seja: o link que a loja manda pro cliente ERA a senha do webhook. Quem o
-- tivesse conseguia injetar mensagem forjada no pipeline do tenant.
--
-- Esta migration só CRIA a coluna nova e preenche. Ela é inerte sozinha:
-- nenhum código lê `webhook_secret` ainda. A troca é feita em 3 passos, nesta
-- ordem, porque inverter derruba o agente (ver
-- autozap-migration-nao-aplicada-webhook-mudo: coluna nova no SELECT sem a
-- migration aplicada = webhook responde 200 sem gravar nada).
--
--   PASSO 1 (esta migration) — aplicar no Supabase. Nada muda em produção.
--   PASSO 2 — código: webhook resolve por `webhook_secret` e, se não achar,
--             cai no `webhook_token` legado com console.warn. Deploy sem
--             downtime; tudo continua funcionando pelo caminho legado.
--   PASSO 3 — por tenant, trocar a URL no painel da Avisa para
--             /api/webhook/avisa/{webhook_secret} e conferir que o warn de
--             legado sumiu. Quando nenhum tenant cair mais no legado, remover
--             o fallback e parar de aceitar `webhook_token` como credencial.
--
-- Depois do passo 3 o `webhook_token` vira só localizador — pode continuar
-- resolvendo a vitrine de links antigos sem risco nenhum.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.config_garage
  ADD COLUMN IF NOT EXISTS webhook_secret uuid NOT NULL DEFAULT gen_random_uuid();

-- Único: o lookup do webhook é por este valor, dois tenants iguais seria
-- entrega cruzada de mensagem.
CREATE UNIQUE INDEX IF NOT EXISTS config_garage_webhook_secret_key
  ON public.config_garage (webhook_secret);

-- Conferência (rodar depois): toda linha tem segredo próprio?
--   select count(*), count(distinct webhook_secret) from public.config_garage;
