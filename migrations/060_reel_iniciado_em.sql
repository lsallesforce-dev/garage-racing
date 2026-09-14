-- 060 — Quando o render do reel começou.
--
-- Por quê: marketing_reel_status = 'processando' era trava sem prazo. Se o
-- worker Railway reinicia no meio do render (todo push em master redeploya
-- ele), o processo morre sem gravar 'erro' e a rota recusava gerar de novo
-- ("already_processing") — o carro ficava girando pra sempre. Strada da
-- APROVE, 14/09: três pushes seguidos mataram o render.
--
-- Com o horário de início, GET/POST tratam 'processando' antigo como erro.
-- Já aplicada em produção.
alter table veiculos add column if not exists marketing_reel_iniciado_em timestamptz;

-- Reverter:
-- alter table veiculos drop column if exists marketing_reel_iniciado_em;
