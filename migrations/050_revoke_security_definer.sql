-- migrations/050_revoke_security_definer.sql
-- APLICADA EM PRODUÇÃO 17/08 — versionada aqui pra não repetir o caso do RLS,
-- que estava certo no banco e ausente no Git.
--
-- Advisor de segurança do Supabase apontou 4 warnings nestas duas funções:
-- "Public / Signed-In Users Can Execute SECURITY DEFINER Function".
--
-- Por que era grave (a primeira, principalmente):
--   leads_handoff_parado é SECURITY DEFINER — ignora RLS — e recebe o tenant
--   como PARÂMETRO. Executável por `anon` significa que qualquer um com a chave
--   pública (que vai no bundle do browser) podia passar QUALQUER user_id e ler
--   os leads daquele tenant. É exatamente o furo que o RLS existe pra fechar.
--
--   voz_consumo_add é do mesmo tipo, menor impacto: dava pra inflar a cota de
--   voz de qualquer tenant.
--
-- Nenhuma das duas é chamada do browser — só com supabaseAdmin (service role):
--   leads_handoff_parado → app/api/cron/alertas-operacionais/route.ts
--   voz_consumo_add      → lib/process-whatsapp.ts
--
-- ⚠️ NÃO revogar leads_sem_atendimento_ids: essa é chamada do CLIENTE em
-- app/(main)/chat/page.tsx com a chave anon (filtro "Sem Atendimento"). Ela não
-- aparece no advisor porque não é SECURITY DEFINER — depende do RLS, como deve.

REVOKE EXECUTE ON FUNCTION public.leads_handoff_parado(uuid, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.leads_handoff_parado(uuid, integer, integer, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.voz_consumo_add(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.voz_consumo_add(uuid, integer) TO service_role;

-- Sobram 2 warnings, ambos avaliados e deixados de propósito:
--   · Extension in Public (vector) — mover o pgvector de schema quebraria
--     match_veiculos e a busca semântica; risco prático ~zero.
--   · Leaked Password Protection — era N/A no plano Free. Se a org virou Pro,
--     passa a ser um toggle em Authentication → Policies. Conferir.
