-- migrations/049_alertas_internos.sql
-- Histórico dos alertas internos (os que avisam o Lucas que algo quebrou).
--
-- Existe porque a falha do próprio canal de alerta era invisível: quando o
-- token da instância Avisa da AutoZap ficou inválido, todo alerta morreu com
-- HTTP 400 e um console.warn na Vercel — que expira e ninguém lê. Agora
-- "os alertas estão mudos" é uma linha no banco, com o erro exato.
--
-- Sem essa tabela o alerta continua saindo normalmente: lib/alerta-interno.ts
-- engole o erro da gravação de propósito, pra não derrubar o cron.

CREATE TABLE IF NOT EXISTS alertas_internos (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  origem     text NOT NULL,                    -- cron/rota que disparou
  assunto    text NOT NULL,
  corpo      text,
  entregue   boolean NOT NULL DEFAULT false,
  canais     jsonb  NOT NULL DEFAULT '[]'::jsonb,  -- ["whatsapp"] | ["email"] | []
  erro       text,
  created_at timestamptz DEFAULT now()
);

-- Só o service role escreve/lê: é dado interno da AutoZap, não de tenant.
-- RLS ligada sem policy = ninguém com chave anon enxerga.
ALTER TABLE alertas_internos ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_alertas_internos_created ON alertas_internos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alertas_internos_falha   ON alertas_internos(entregue, created_at DESC);
