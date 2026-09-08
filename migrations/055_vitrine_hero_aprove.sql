-- 055: copy do banner do hero da vitrine premium (APROVE Multimarcas)
--
-- `vitrine_tema` ganha três chaves de TEXTO DE CAMPANHA:
--   headline   — título do banner; o que estiver entre *asteriscos* sai na cor
--                de destaque (cor_secundaria / --accent)
--   subtitulo  — linha de apoio (a chamada da campanha do mês)
--   cta_label  — rótulo do botão verde do banner
--
-- Fica no banco e não no código de propósito: trocar a campanha do mês é um
-- UPDATE, não um deploy. Sem essas chaves o banner cai no nome da loja — o
-- código nunca inventa copy de marketing.
--
-- A ARTE de fundo do banner é o `capa_url`, que a loja sobe em
-- Configurações → Vitrine. Sem capa, o banner usa o gradiente da marca.
--
-- cor_secundaria vira o VERDE-ÁGUA da referência: é ela que alimenta a var
-- --accent, usada nas palavras entre asteriscos da headline. Sem isso o destaque
-- sai roxo escuro (derivado da cor primária) e não aparece. Atenção: --accent
-- também é a 2ª cor do gradiente do bloco de preço na página do veículo — vai
-- ficar roxo → verde-água lá. Se não gostar, é só tirar essa chave.
--
-- Filtro por vitrine_slug (único por vitrine), não por user_id: config_garage
-- tem mais de uma linha por user_id e a APROVE tem dois tenants.

UPDATE config_garage
   SET vitrine_tema = COALESCE(vitrine_tema, '{}'::jsonb) || jsonb_build_object(
         'headline',  'A experiência *premium* que você *merece*.',
         'subtitulo', 'Mês do Cliente Aprove: Condições Exclusivas!',
         'cta_label', 'Conheça o estoque',
         'cor_secundaria', '#00d49b'
       )
 WHERE vitrine_slug = 'aprovemultimarcas';

-- Rollback:
-- UPDATE config_garage
--    SET vitrine_tema = vitrine_tema - 'headline' - 'subtitulo' - 'cta_label'
--  WHERE vitrine_slug = 'aprovemultimarcas';
