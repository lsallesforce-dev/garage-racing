-- 052_meta_pixel_vitrine.sql
--
-- Pixel da Meta na vitrine do tenant.
--
-- Motivo: o anúncio de catálogo (Automotive Inventory Ads) manda a pessoa pro
-- SITE, não pro WhatsApp. Sem pixel a Meta não enxerga nada depois do clique —
-- não sabe quem olhou qual carro, não persegue quem visitou e sumiu, e só
-- consegue otimizar por clique. Os anúncios de UM carro nunca precisaram
-- disso porque medem a conversa dentro do próprio WhatsApp.
--
-- Por tenant, não global: cada lojista anuncia na conta de anúncios dele, e o
-- pixel pertence a essa conta. Vazio = vitrine sem pixel, comportamento de hoje.

alter table config_garage
  add column if not exists meta_pixel_id text;

comment on column config_garage.meta_pixel_id is
  'ID do pixel da Meta disparado na vitrine (PageView, ViewContent com content_type=vehicle, Lead no clique do WhatsApp). Alimenta o retargeting do anúncio de catálogo.';

-- APROVE Multimarcas — pixel "AutoZap - Vitrine APROVE", criado 03/09/2026 na
-- conta de anúncios 1013848217972542.
update config_garage
   set meta_pixel_id = '944347678038612'
 where user_id = '223ad043-59a1-416f-aa78-83c74187f9f7';
