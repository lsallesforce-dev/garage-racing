-- 037 — Agente rodando no celular PESSOAL do dono (pedido Marcos Repasse, 06/08)
--
-- Contexto: o Marcos quer o agente no número dele mesmo (5517996039192), com
-- tudo concentrado ali (agente + gerente + pós-venda). Isso quebra a premissa do
-- pipeline de que TODO contato que passa pelos filtros é lead e deve ser
-- atendido pela IA — no celular pessoal isso significa a IA respondendo família,
-- fornecedor e outro lojista.
--
-- Dado que definiu o desenho: 33 dos 38 leads dele têm origem='whatsapp'
-- (genérico, sem rastro). Filtrar só por origem rastreável deixaria ~87% dos
-- leads mudos — daí o classificador de 1º contato (ver lib/lead-gate.ts).

-- ── config_garage ────────────────────────────────────────────────────────────

-- Liga o modo "agente mora no celular do dono": conversa nova só é atendida
-- depois de classificada como lead (ou liberada na mão com !ia).
ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS ia_modo_lead_only BOOLEAN DEFAULT FALSE;

-- Controla o bloco "💬 Falar com Vendedor" (wa.me do agente) no anúncio de
-- repasse. Default TRUE = comportamento atual preservado pros demais tenants.
ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS repasse_cta_ativo BOOLEAN DEFAULT TRUE;

-- Quando o lead pede foto/vídeo, manda TODO o material de uma vez
-- (até 15 fotos + vídeo + ficha) em vez do teto padrão de 4 fotos.
ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS envio_material_completo BOOLEAN DEFAULT FALSE;

-- ── leads ────────────────────────────────────────────────────────────────────

-- NULL  = aguardando decisão (aparece no filtro AGUARDANDO_IA do painel)
-- TRUE  = lead liberado, a IA atende normalmente
-- FALSE = contato pessoal, a IA nunca mais tenta (marcado com !off ou no painel)
-- Só tem efeito quando config_garage.ia_modo_lead_only = true.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS ia_liberada BOOLEAN DEFAULT NULL;

-- Alimenta o filtro "Aguardando liberação" do chat: leads indecisos, mais
-- recentes primeiro. Parcial pra não pesar — a esmagadora maioria é NULL só
-- nos tenants sem lead-only, que nunca consultam esse filtro.
CREATE INDEX IF NOT EXISTS idx_leads_aguardando_ia
  ON leads (user_id, updated_at DESC)
  WHERE ia_liberada IS NULL;

COMMENT ON COLUMN config_garage.ia_modo_lead_only IS
  'Agente roda no celular pessoal do dono: só responde conversa classificada como lead (ver leads.ia_liberada).';
COMMENT ON COLUMN leads.ia_liberada IS
  'NULL=aguardando decisão, TRUE=lead liberado, FALSE=contato pessoal. Só vale com config_garage.ia_modo_lead_only.';
