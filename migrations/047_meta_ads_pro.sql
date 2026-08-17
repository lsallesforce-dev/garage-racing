-- migrations/047_meta_ads_pro.sql
-- Campos novos do painel de anúncio Meta (objetivo, orçamento total, alcance
-- por estado, agendamento). Sem isso o painel continua funcionando: o insert
-- em app/api/meta/ads/criar tem fallback pro subset legado — mas as campanhas
-- ficam sem histórico do que foi configurado.

-- Objetivo: "leads" (formulário instantâneo) | "whatsapp" (click-to-WhatsApp)
ALTER TABLE meta_campanhas ADD COLUMN IF NOT EXISTS objetivo text DEFAULT 'leads';

-- Orçamento: diário (padrão) ou total no período (lifetime_budget na Meta)
ALTER TABLE meta_campanhas ADD COLUMN IF NOT EXISTS tipo_orcamento text DEFAULT 'diario';
ALTER TABLE meta_campanhas ADD COLUMN IF NOT EXISTS orcamento_total numeric;

-- Campanha contínua (sem end_time) — só existe com orçamento diário
ALTER TABLE meta_campanhas ADD COLUMN IF NOT EXISTS sem_data_fim boolean DEFAULT false;

-- Veiculação agendada para o futuro
ALTER TABLE meta_campanhas ADD COLUMN IF NOT EXISTS inicia_em timestamptz;

-- Snapshot do público escolhido (pra saber depois o que gerou qual CPL)
ALTER TABLE meta_campanhas ADD COLUMN IF NOT EXISTS regioes    jsonb DEFAULT '[]'::jsonb;
ALTER TABLE meta_campanhas ADD COLUMN IF NOT EXISTS cidades    jsonb DEFAULT '[]'::jsonb;
ALTER TABLE meta_campanhas ADD COLUMN IF NOT EXISTS interesses jsonb DEFAULT '[]'::jsonb;
ALTER TABLE meta_campanhas ADD COLUMN IF NOT EXISTS genero     text;
