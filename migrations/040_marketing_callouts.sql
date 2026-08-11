-- 040_marketing_callouts.sql
-- Legendas (callouts) por take do reel, geradas da ficha do carro.
--
-- Coluna SEPARADA de marketing_reel_edit de propósito: aquela é *a edição do
-- vendedor*. Escrever legenda de IA lá tornaria "auto" indistinguível de "manual"
-- e sobrescreveria o que ele digitou. A precedência (manual > IA > rodízio de
-- opcionais > vazio) vive em resolverCallout(), em lib/reel-callouts.ts.
--
-- Shape:
-- {
--   "versao": 1,
--   "gerado_em": "2026-08-10T23:00:00.000Z",
--   "modelo": "gemini-2.5-flash",
--   "ficha_hash": "1a2b3c",          -- invalida quando opcionais/preço/km mudam
--   "takes": {
--     "multimidia":  { "callout": "CENTRAL MULTIMÍDIA", "subCallout": "com câmera de ré",
--                      "fonte": "ia", "base": "Central multimídia com câmera de ré" },
--     "bancos-take": { "callout": "BANCOS EM COURO", "subCallout": "", "fonte": "regra" }
--   }
-- }
--
-- `base` é a evidência literal da ficha que sustenta o callout — sem base
-- ancorada no corpus do veículo, a legenda é descartada antes de chegar aqui.

ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS marketing_callouts jsonb;

COMMENT ON COLUMN veiculos.marketing_callouts IS
  'Legendas por take do reel geradas da ficha (ver lib/reel-callouts-ia.ts). Não confundir com marketing_reel_edit, que é a edição manual do vendedor.';
