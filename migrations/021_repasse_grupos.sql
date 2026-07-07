-- migrations/021_repasse_grupos.sql
--
-- Repasse automático em MÚLTIPLOS grupos/comunidades (pedido Marcos Repasse:
-- 2 grupos). repasse_grupos (jsonb, array de {jid, nome}) vira a fonte da
-- verdade; repasse_grupo_jid/nome legados seguem SINCRONIZADOS com o primeiro
-- item do array (compat + rollback barato) — quem escreve é sempre a API.

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS repasse_grupos jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Migra o grupo já vinculado pro array (idempotente)
UPDATE config_garage
SET repasse_grupos = jsonb_build_array(
      jsonb_build_object('jid', repasse_grupo_jid, 'nome', repasse_grupo_nome)
    )
WHERE repasse_grupo_jid IS NOT NULL
  AND repasse_grupos = '[]'::jsonb;
