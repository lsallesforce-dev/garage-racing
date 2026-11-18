-- 077: Cota mensal de Kits de Postagem + colunas de gateway em pagamentos (migração PagBank).
--
-- Modelo de planos (nov/2026): todas as features liberadas em todos os planos e no trial.
-- Diferencia pela cota de kits: Starter/trial = 5/mês, Pro/Premium = ilimitado (lib/planos.ts).
-- 1 kit = 1 VEÍCULO por mês (BRT). Regenerar o mesmo carro não consome cota (PK única).

ALTER TABLE config_garage ADD COLUMN IF NOT EXISTS kits_mes_override integer;
COMMENT ON COLUMN config_garage.kits_mes_override IS
  'Cota de kits/mês negociada (NULL = padrão do plano em lib/planos.ts). Usado p/ não travar cliente antigo.';

CREATE TABLE IF NOT EXISTS kit_consumo (
  user_id     uuid NOT NULL,
  competencia text NOT NULL,              -- 'YYYY-MM' (America/Sao_Paulo)
  veiculo_id  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, competencia, veiculo_id)
);

-- Kits extras comprados avulso (pacote +5) — somam na cota do mês da compra.
CREATE TABLE IF NOT EXISTS kit_cota_extra (
  user_id     uuid NOT NULL,
  competencia text NOT NULL,
  extra       integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, competencia)
);

ALTER TABLE kit_consumo    ENABLE ROW LEVEL SECURITY;
ALTER TABLE kit_cota_extra ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY kit_consumo_owner ON kit_consumo FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY kit_cota_extra_owner ON kit_cota_extra FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Registro atômico: lock por tenant evita 2 gerações concorrentes estourarem a cota.
-- p_limite NULL = ilimitado (registra mesmo assim, p/ métrica de uso).
CREATE OR REPLACE FUNCTION kit_consumo_registrar(p_user_id uuid, p_veiculo_id uuid, p_limite integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  comp   text := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM');
  usados integer;
  extra  integer;
  lim    integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('kit_cota:' || p_user_id::text));

  IF EXISTS (SELECT 1 FROM kit_consumo WHERE user_id = p_user_id AND competencia = comp AND veiculo_id = p_veiculo_id) THEN
    SELECT count(*) INTO usados FROM kit_consumo WHERE user_id = p_user_id AND competencia = comp;
    SELECT coalesce(max(e.extra), 0) INTO extra FROM kit_cota_extra e WHERE e.user_id = p_user_id AND e.competencia = comp;
    lim := CASE WHEN p_limite IS NULL THEN NULL ELSE p_limite + extra END;
    RETURN jsonb_build_object('ok', true, 'novo', false, 'usados', usados, 'limite', lim);
  END IF;

  SELECT count(*) INTO usados FROM kit_consumo WHERE user_id = p_user_id AND competencia = comp;
  SELECT coalesce(max(e.extra), 0) INTO extra FROM kit_cota_extra e WHERE e.user_id = p_user_id AND e.competencia = comp;
  lim := CASE WHEN p_limite IS NULL THEN NULL ELSE p_limite + extra END;

  IF lim IS NOT NULL AND usados >= lim THEN
    RETURN jsonb_build_object('ok', false, 'novo', false, 'usados', usados, 'limite', lim);
  END IF;

  INSERT INTO kit_consumo (user_id, competencia, veiculo_id) VALUES (p_user_id, comp, p_veiculo_id);
  RETURN jsonb_build_object('ok', true, 'novo', true, 'usados', usados + 1, 'limite', lim);
END $$;

CREATE OR REPLACE FUNCTION kit_cota_extra_add(p_user_id uuid, p_qtd integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE total integer;
BEGIN
  INSERT INTO kit_cota_extra (user_id, competencia, extra)
  VALUES (p_user_id, to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM'), p_qtd)
  ON CONFLICT (user_id, competencia) DO UPDATE
    SET extra = kit_cota_extra.extra + EXCLUDED.extra, updated_at = now()
  RETURNING extra INTO total;
  RETURN total;
END $$;

REVOKE EXECUTE ON FUNCTION kit_consumo_registrar(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION kit_cota_extra_add(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION kit_consumo_registrar(uuid, uuid, integer) TO service_role;
GRANT  EXECUTE ON FUNCTION kit_cota_extra_add(uuid, integer) TO service_role;

-- Pagamentos: gateway explícito (antes o order id só vivia em notas 'pagarme:<id>:...').
ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS gateway text;
ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS gateway_order_id text;
CREATE INDEX IF NOT EXISTS pagamentos_gateway_order_idx ON pagamentos (gateway, gateway_order_id);
