-- 038 — Intervalo ESPORÁDICO no repasse automático (pedido Marcos Repasse, 06/08)
--
-- Hoje o cron respeita um intervalo FIXO (repasse_intervalo_min): com 60min o
-- grupo recebe anúncio de hora em hora cravada, o que denuncia robô. O pedido é
-- variar — "1h, 25min, 1:30".
--
-- Como funciona: o intervalo configurado vira a MÉDIA. Depois de cada envio o
-- cron sorteia o próximo intervalo entre 0,5x e 1,5x da média e grava o horário
-- alvo em repasse_proximo_envio_em. Com média 60 → gaps de 30 a 90min.
-- (O cron roda a cada 10min, então o disparo cai no tick seguinte ao alvo.)

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS repasse_intervalo_variar BOOLEAN DEFAULT FALSE;

-- Horário-alvo do próximo envio, sorteado após o último. NULL = ainda não
-- sorteado (1º envio depois de ligar a flag cai na regra de intervalo fixo).
ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS repasse_proximo_envio_em TIMESTAMPTZ;

COMMENT ON COLUMN config_garage.repasse_intervalo_variar IS
  'Intervalo esporádico: repasse_intervalo_min vira média e cada gap é sorteado entre 0,5x e 1,5x dela.';
COMMENT ON COLUMN config_garage.repasse_proximo_envio_em IS
  'Alvo sorteado do próximo envio do repasse. Só usado com repasse_intervalo_variar=true.';
