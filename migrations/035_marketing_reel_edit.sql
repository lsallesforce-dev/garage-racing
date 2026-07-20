-- 035: edição manual do reel (estilo CapCut) por veículo.
-- marketing_reel_edit: { clips: [{ tag, segundos, callout }] }
--   segundos = duração do take na timeline; callout = legenda que aparece sobre o take.
-- Ausente = reel usa os defaults (2,2s por take + opcionais distribuídos).

ALTER TABLE veiculos
  ADD COLUMN IF NOT EXISTS marketing_reel_edit jsonb;
