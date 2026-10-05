-- migrations/065_instagram_canal.sql
-- Instagram como canal de atendimento (direct + comentários).
--
-- O lead do Instagram não tem telefone: a chave continua sendo (user_id, wa_id),
-- com wa_id = "ig:<IGSID>". `canal` existe pra os crons e as telas não tratarem
-- esse wa_id como número de WhatsApp.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS canal TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ig_username TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_user_canal ON leads(user_id, canal);

-- O webhook do Instagram chega com o ID da conta profissional (entry.id), que é
-- o mesmo valor já gravado em instagram_actor_id.
CREATE INDEX IF NOT EXISTS idx_meta_paginas_instagram ON meta_paginas(instagram_actor_id);

-- Tudo desligado por padrão: conectar o Facebook não liga a IA no Instagram.
ALTER TABLE config_garage ADD COLUMN IF NOT EXISTS ig_direct_ia BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE config_garage ADD COLUMN IF NOT EXISTS ig_comentarios_ia BOOLEAN NOT NULL DEFAULT false;

-- Um registro por comentário visto. A chave primária é o que impede responder
-- duas vezes: o mesmo comentário chega pelo webhook E pela varredura do cron.
CREATE TABLE IF NOT EXISTS ig_comentarios (
  comment_id     text PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_id       text,
  veiculo_id     uuid REFERENCES veiculos(id) ON DELETE SET NULL,
  autor_id       text,
  autor_username text,
  texto          text,
  acao           text NOT NULL DEFAULT 'ignorado',  -- respondido | ignorado | falhou
  detalhe        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ig_comentarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant le seus comentarios" ON ig_comentarios
  FOR SELECT USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_ig_comentarios_user ON ig_comentarios(user_id, created_at DESC);
