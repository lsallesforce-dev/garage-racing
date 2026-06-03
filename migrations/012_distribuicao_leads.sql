-- 012_distribuicao_leads.sql
-- Distribuição automática de leads entre vendedores (especialista + rodízio).
--
-- Modo por tenant (config_garage.distribuicao_modo):
--   'off'          → alertas vão só pro gerente
--   'especialista' → roteia pro vendedor_responsavel do carro; senão gerente (PADRÃO — preserva o comportamento que já existia)
--   'rodizio'      → fila sequencial entre vendedores ativos
--   'hibrido'      → especialista quando o carro tem; senão rodízio
--
-- O roteamento dispara quando o lead vira QUENTE e grava leads.vendedor_id.

ALTER TABLE config_garage ADD COLUMN IF NOT EXISTS distribuicao_modo text NOT NULL DEFAULT 'especialista';

-- Cursor do rodízio: último vendedor que recebeu um lead (pra pegar o próximo da fila)
ALTER TABLE config_garage ADD COLUMN IF NOT EXISTS rodizio_cursor_id uuid;

-- Um vendedor pode ser especialista de um carro mas ficar fora da fila geral do rodízio
ALTER TABLE vendedores ADD COLUMN IF NOT EXISTS participa_rodizio boolean NOT NULL DEFAULT true;

-- Acelera a listagem ordenada da fila de rodízio por tenant
CREATE INDEX IF NOT EXISTS idx_vendedores_fila ON vendedores(user_id, created_at);

-- Índice para o painel do vendedor (leads atribuídos a ele)
CREATE INDEX IF NOT EXISTS idx_leads_vendedor ON leads(vendedor_id) WHERE vendedor_id IS NOT NULL;

-- ── Rodízio sequencial atômico ──────────────────────────────────────────────
-- Avança o cursor do rodízio e devolve o próximo vendedor da fila, sob lock da
-- linha de config (FOR UPDATE) — assim 2 leads QUENTES simultâneos no mesmo
-- tenant nunca caem no mesmo vendedor. Ordem total estável por (created_at, id).
CREATE OR REPLACE FUNCTION proximo_vendedor_rodizio(p_tenant uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_config_id      uuid;
  v_cursor         uuid;
  v_cursor_created timestamptz;
  v_next           uuid;
BEGIN
  -- Trava a config do tenant (serializa concorrência)
  SELECT id, rodizio_cursor_id INTO v_config_id, v_cursor
  FROM config_garage
  WHERE user_id = p_tenant
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_config_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Posição atual do cursor (se ainda for um vendedor válido da fila)
  SELECT created_at INTO v_cursor_created
  FROM vendedores
  WHERE id = v_cursor AND user_id = p_tenant;

  -- Próximo da fila depois do cursor
  IF v_cursor_created IS NOT NULL THEN
    SELECT id INTO v_next
    FROM vendedores
    WHERE user_id = p_tenant AND participa_rodizio AND lower(status) = 'ativo' AND whatsapp IS NOT NULL
      AND (created_at, id) > (v_cursor_created, v_cursor)
    ORDER BY created_at, id
    LIMIT 1;
  END IF;

  -- Wrap-around (cursor era o último, nulo ou inválido) → primeiro da fila
  IF v_next IS NULL THEN
    SELECT id INTO v_next
    FROM vendedores
    WHERE user_id = p_tenant AND participa_rodizio AND lower(status) = 'ativo' AND whatsapp IS NOT NULL
    ORDER BY created_at, id
    LIMIT 1;
  END IF;

  IF v_next IS NOT NULL THEN
    UPDATE config_garage SET rodizio_cursor_id = v_next WHERE id = v_config_id;
  END IF;

  RETURN v_next;
END;
$$;
