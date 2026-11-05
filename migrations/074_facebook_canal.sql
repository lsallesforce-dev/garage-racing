-- 074 — Página do Facebook como canal de atendimento (Messenger + comentários).
--
-- Reaproveita o desenho do Instagram (migration 065):
--   - lead do Messenger: leads.wa_id = 'fb:<PSID>', leads.canal = 'facebook';
--   - comentário da Página: mesma tabela ig_comentarios, separado por `canal`;
--   - interruptores config_garage.ig_direct_ia / ig_comentarios_ia valem pras duas redes.

ALTER TABLE ig_comentarios
  ADD COLUMN IF NOT EXISTS canal text NOT NULL DEFAULT 'instagram';

CREATE INDEX IF NOT EXISTS ig_comentarios_user_canal_idx
  ON ig_comentarios (user_id, canal, created_at DESC);
