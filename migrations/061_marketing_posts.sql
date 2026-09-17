-- 061 — guarda os posts ORGÂNICOS (Facebook/Instagram) publicados de cada carro.
--
-- Por que existe: até agora o botão "Postar no Face + Insta" publicava e
-- esquecia. Sem o id do post, duas coisas eram impossíveis:
--   1. dizer na tela que aquele carro JÁ foi postado (o aviso verde sumia em 6s
--      e, no refresh, o botão voltava a parecer nunca clicado);
--   2. tirar o post do ar quando o carro é vendido — o anúncio pago já era
--      pausado (lib/meta-campanhas.ts), mas o post orgânico ficava lá, com o
--      cliente mandando mensagem sobre carro que não existe mais.
--
-- Formato de cada item:
--   { "destino": "facebook" | "instagram",
--     "post_id": "...",              -- id na Meta, usado pra apagar
--     "permalink": "https://...",    -- pra abrir/apagar na mão quando precisar
--     "formato": "feed" | "story",
--     "em": "2026-09-17T13:20:09Z",
--     "removido_em": "..." | null }  -- preenchido quando sai do ar
--
-- Coluna (jsonb) e não tabela nova de propósito: a galeria do Kit lê `veiculos`
-- direto do client (RLS do tenant já cobre), e um carro tem poucos posts.
alter table veiculos
  add column if not exists marketing_posts jsonb not null default '[]'::jsonb;

comment on column veiculos.marketing_posts is
  'Posts orgânicos publicados (Face/Insta): destino, post_id, permalink, formato, em, removido_em.';
