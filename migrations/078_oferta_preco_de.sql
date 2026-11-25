-- 078: Campanha de ofertas ("Mês de ofertas" da APROVE, 25/11/2026).
--
-- veiculos.preco_de = preço ANTES da baixa, em REAIS (mesma unidade do preco_sugerido).
-- Maior que o preço atual + campanha ligada → capa/legenda do kit saem "DE X POR Y".
-- Preenchido sozinho pelo /api/veiculo/patch quando o preço baixa com a campanha ligada.
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS preco_de numeric;

-- Texto do selo da capa na campanha (ex.: 'MÊS DE OFERTAS'). NULL = campanha desligada:
-- capa volta a "DISPONÍVEL" e o preço simples, mesmo com preco_de preenchido.
ALTER TABLE config_garage ADD COLUMN IF NOT EXISTS marketing_oferta_selo text;

-- Liga a campanha na APROVE.
UPDATE config_garage SET marketing_oferta_selo = 'MÊS DE OFERTAS'
WHERE user_id = '223ad043-59a1-416f-aa78-83c74187f9f7';
