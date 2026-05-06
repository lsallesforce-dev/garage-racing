-- migrations/006_meta_ads.sql
-- Tabelas para integração Meta Lead Ads (Facebook + Instagram)

-- Páginas Facebook conectadas por tenant
CREATE TABLE IF NOT EXISTS meta_paginas (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id             text NOT NULL,
  page_name           text,
  page_access_token   text NOT NULL,
  ad_account_id       text,           -- ex: "act_123456789"
  instagram_actor_id  text,           -- linked Instagram account ID
  created_at          timestamptz DEFAULT now(),
  UNIQUE(user_id, page_id)
);

ALTER TABLE meta_paginas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant acessa suas páginas" ON meta_paginas
  FOR ALL USING (user_id = auth.uid());

-- Campanhas Lead Ads por veículo
CREATE TABLE IF NOT EXISTS meta_campanhas (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  veiculo_id      uuid REFERENCES veiculos(id) ON DELETE SET NULL,
  pagina_id       uuid REFERENCES meta_paginas(id) ON DELETE SET NULL,
  campaign_id     text,
  adset_id        text,
  ad_id           text,
  leadform_id     text,
  status          text DEFAULT 'ativo',   -- ativo | pausado | encerrado | erro
  placement       text DEFAULT 'facebook,instagram',
  orcamento_diario  numeric NOT NULL,     -- R$/dia
  duracao_dias      integer NOT NULL,
  raio_km           integer DEFAULT 30,
  idade_min         integer DEFAULT 25,
  idade_max         integer DEFAULT 55,
  gasto_total       numeric DEFAULT 0,
  leads_gerados     integer DEFAULT 0,
  erro_msg          text,
  created_at        timestamptz DEFAULT now(),
  encerra_em        timestamptz
);

ALTER TABLE meta_campanhas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant acessa suas campanhas" ON meta_campanhas
  FOR ALL USING (user_id = auth.uid());

-- Índices
CREATE INDEX IF NOT EXISTS idx_meta_campanhas_veiculo   ON meta_campanhas(veiculo_id);
CREATE INDEX IF NOT EXISTS idx_meta_campanhas_user      ON meta_campanhas(user_id, status);
CREATE INDEX IF NOT EXISTS idx_meta_campanhas_leadform  ON meta_campanhas(leadform_id);
CREATE INDEX IF NOT EXISTS idx_meta_paginas_user        ON meta_paginas(user_id);
CREATE INDEX IF NOT EXISTS idx_meta_paginas_page_id     ON meta_paginas(page_id);

-- Coluna impressoes para armazenar métrica ao vivo
ALTER TABLE meta_campanhas ADD COLUMN IF NOT EXISTS impressoes bigint DEFAULT 0;

-- Função incrementar_leads_campanha (chamada pelo webhook leadgen)
CREATE OR REPLACE FUNCTION incrementar_leads_campanha(p_form_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE meta_campanhas
  SET leads_gerados = leads_gerados + 1
  WHERE leadform_id = p_form_id;
END;
$$;
