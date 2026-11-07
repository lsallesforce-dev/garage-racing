-- 075 — Perguntas da Júlia ao gerente esperando resposta (diálogo gerente × agente).
--
-- Todo aviso que OFERECE uma ação ("consulto nos bancos?", "posso mandar pro
-- cliente?", "quer que eu retome?") vira uma linha aqui. A resposta do gerente
-- (botão da Cloud API ou "1"/"sim" no Avisa) resolve a mais recente aberta pra
-- ele. A troca aberta→aceita é condicional (status = 'aberta'): clique duplo no
-- botão não executa duas vezes.

CREATE TABLE IF NOT EXISTS gerente_acoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  lead_id       uuid REFERENCES leads(id) ON DELETE CASCADE,
  destinatario  text NOT NULL,              -- WhatsApp (só dígitos, com 55) de quem recebeu a pergunta
  tipo          text NOT NULL,              -- simular_financiamento | enviar_simulacao_cliente | reabordar_lead
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  texto         text,                       -- pergunta como foi enviada
  status        text NOT NULL DEFAULT 'aberta', -- aberta | aceita | recusada | expirada | executada | falhou
  resultado     text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  expira_em     timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  resolvido_em  timestamptz
);

CREATE INDEX IF NOT EXISTS gerente_acoes_abertas_idx
  ON gerente_acoes (user_id, destinatario, criado_em DESC) WHERE status = 'aberta';
CREATE INDEX IF NOT EXISTS gerente_acoes_lead_idx ON gerente_acoes (lead_id);

ALTER TABLE gerente_acoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gerente_acoes_tenant_select ON gerente_acoes;
CREATE POLICY gerente_acoes_tenant_select ON gerente_acoes
  FOR SELECT USING (user_id = auth.uid());
