-- migrations/020_transmissao.sql
--
-- Feature "Prospecção" do tenant (nome interno: TRANSMISSÃO — não confundir
-- com a prospecção B2B da Mari: prospeccao_config/prospects são OUTRA coisa).
-- Lista de transmissão pessoal: tenant cadastra contatos (nome+telefone) em
-- listas A/B/C e dispara o anúncio de um carro (texto de repasse SEM o
-- wa.me do agente) via cron anti-ban numa instância Avisa DEDICADA.
-- Pacote pago: gate por config_garage.transmissao_habilitada (1º: Marcos Repasse).

-- ── Contatos da lista ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transmissao_contatos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  nome       text NOT NULL,
  telefone   text NOT NULL,          -- só dígitos, com DDI 55 (normalizado na API)
  lista      char(1) NOT NULL CHECK (lista IN ('A','B','C')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, telefone)
);
CREATE INDEX IF NOT EXISTS idx_transmissao_contatos_user_lista
  ON transmissao_contatos (user_id, lista);

-- ── Campanhas (1 disparo = 1 carro → 1+ listas) ──────────────────────────────
CREATE TABLE IF NOT EXISTS transmissao_campanhas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  veiculo_id uuid NOT NULL,
  listas     text[] NOT NULL,        -- ex: {A,B}
  texto      text NOT NULL,          -- texto congelado no disparo (sem saudação)
  capa_url   text,
  status     text NOT NULL DEFAULT 'ativa'
             CHECK (status IN ('ativa','pausada','concluida','cancelada')),
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transmissao_campanhas_user_status
  ON transmissao_campanhas (user_id, status);

-- ── Fila de envios (estado por contato — retomada, progresso, idempotência) ──
CREATE TABLE IF NOT EXISTS transmissao_envios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  campanha_id uuid NOT NULL REFERENCES transmissao_campanhas(id) ON DELETE CASCADE,
  contato_id  uuid NOT NULL REFERENCES transmissao_contatos(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pendente'
              CHECK (status IN ('pendente','enviando','enviado','erro')),
  claimed_em  timestamptz,   -- quando o cron claimou (recuperação de presos: 'enviando' >15min volta pra fila)
  enviado_em  timestamptz,
  erro        text,
  UNIQUE (campanha_id, contato_id)
);
CREATE INDEX IF NOT EXISTS idx_transmissao_envios_campanha_status
  ON transmissao_envios (campanha_id, status);
CREATE INDEX IF NOT EXISTS idx_transmissao_envios_user_enviado
  ON transmissao_envios (user_id, enviado_em);

-- ── RLS: service-only (padrão-casa migration 016 — acesso só via rotas API
--    com supabaseAdmin + validação manual de posse) ─────────────────────────
ALTER TABLE transmissao_contatos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE transmissao_campanhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE transmissao_envios    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transmissao_contatos_service_only" ON public.transmissao_contatos
  FOR ALL TO authenticated USING (false);
CREATE POLICY "transmissao_campanhas_service_only" ON public.transmissao_campanhas
  FOR ALL TO authenticated USING (false);
CREATE POLICY "transmissao_envios_service_only" ON public.transmissao_envios
  FOR ALL TO authenticated USING (false);

-- ── Config por tenant ─────────────────────────────────────────────────────────
ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS transmissao_habilitada     boolean DEFAULT false,  -- flag do pacote (setada por admin/SQL, NÃO pela UI)
  ADD COLUMN IF NOT EXISTS transmissao_avisa_base_url text,                   -- instância Avisa DEDICADA (nunca a do agente)
  ADD COLUMN IF NOT EXISTS transmissao_avisa_token    text,
  ADD COLUMN IF NOT EXISTS transmissao_cap_dia        int     DEFAULT 150,    -- teto de envios/dia
  ADD COLUMN IF NOT EXISTS transmissao_janela_inicio  int     DEFAULT 8,      -- hora BRT inclusive
  ADD COLUMN IF NOT EXISTS transmissao_janela_fim     int     DEFAULT 18,     -- hora BRT exclusive
  ADD COLUMN IF NOT EXISTS transmissao_ativada_em     timestamptz;            -- 1º salvamento de credenciais (ramp-up de chip: <7 dias → cap 50)

-- Ativação do pacote pro Marcos Repasse (rodar junto):
-- UPDATE config_garage SET transmissao_habilitada = true
--   WHERE user_id = '369dd610-8325-4a6a-a656-f6c93bfca4fb';
