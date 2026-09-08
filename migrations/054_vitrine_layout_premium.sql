-- 054: layout premium da vitrine (por enquanto: só APROVE Multimarcas)
--
-- `vitrine_tema` é jsonb livre (migration 024) — não precisa de DDL. O que muda é
-- uma chave nova:
--   layout: "padrao" (ausente = default, VitrineClient) | "premium" (VitrinePremiumClient)
--
-- A flag mora no tema, e não num `if (tenant === "aprovemultimarcas")` no código,
-- pra ligar o layout em outro tenant ser uma linha de SQL.
--
-- `||` faz MERGE: preserva cor_primaria, cor_secundaria, logo_url, capa_url,
-- tagline e sobre que a loja já configurou.
--
-- config_garage tem mais de uma linha por user_id (o caso APROVE é citado na
-- própria 024) — por isso o filtro é vitrine_slug, que é único por vitrine, e
-- não user_id.

UPDATE config_garage
   SET vitrine_tema = COALESCE(vitrine_tema, '{}'::jsonb) || '{"layout":"premium"}'::jsonb
 WHERE vitrine_slug = 'aprovemultimarcas';

-- Rollback:
-- UPDATE config_garage SET vitrine_tema = vitrine_tema - 'layout'
--  WHERE vitrine_slug = 'aprovemultimarcas';
