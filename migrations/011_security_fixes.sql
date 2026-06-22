-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 011: Captura do estado REAL de RLS + correções de segurança
--
-- CONTEXTO: as policies de RLS de produção foram aplicadas historicamente direto
-- no painel do Supabase e NÃO estavam versionadas. A migration 004 só cobria um
-- subconjunto e descrevia RLS como "defesa em profundidade" — mas o frontend
-- (lib/supabase.ts, anon key) lê/escreve config_garage, leads, mensagens, etc.
-- DIRETO do browser, então para essas tabelas RLS é a ÚNICA barreira.
--
-- Esta migration documenta e recria, de forma IDEMPOTENTE, o estado real das
-- policies (verificado em 2026-06-22 via pg_policies) para que um rebuild a
-- partir de migrations/ produza um banco SEGURO. Rodar contra o banco atual é
-- essencialmente no-op (drop-if-exists + create).
--
-- Os fixes 0 e 6 abaixo foram aplicados ao vivo em 2026-06-22
-- (Supabase migration "011_security_fixes"); reproduzidos aqui para versionar.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. FIX: fecha creditos_indicacao (estava com RLS DESLIGADO — advisor ERROR) ──
-- Só o backend (lib/indicacao.ts + api/indicacao/*) acessa via service role, que
-- ignora RLS. Sem policy = deny-all para authenticated/anon. Evita fraude de
-- inserção de créditos que abatem a própria fatura.
ALTER TABLE public.creditos_indicacao ENABLE ROW LEVEL SECURITY;

-- ── 1. Tabelas TENANT-OWNER (user_id = auth.uid(), comando ALL) ──────────────
DO $$
DECLARE
  t record;
  spec text[][] := ARRAY[
    ['agenda',            'users manage own agenda'],
    ['clientes',          'users_own_clientes'],
    ['config_garage',     'tenant_owner'],
    ['contratos',         'users_own_contratos'],
    ['despesas_veiculo',  'tenant_owner'],
    ['receitas_veiculo',  'tenant_owner'],
    ['fechamentos_mes',   'owner'],
    ['financeiro_geral',  'financeiro_geral_owner'],
    ['leads_conversas',   'leads_conversas_own'],
    ['meta_campanhas',    'Tenant acessa suas campanhas'],
    ['meta_paginas',      'Tenant acessa suas páginas']
  ];
BEGIN
  FOR i IN 1 .. array_length(spec, 1) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', spec[i][1]);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec[i][2], spec[i][1]);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR ALL TO authenticated
        USING (user_id = (SELECT auth.uid()))
        WITH CHECK (user_id = (SELECT auth.uid()))
    $f$, spec[i][2], spec[i][1]);
  END LOOP;
END $$;

-- ── 2. Tabelas SERVICE-ONLY (USING false — só service role passa) ────────────
DO $$
DECLARE
  spec text[][] := ARRAY[
    ['admin_audit_log',   'admin_audit_log_service_only'],
    ['buscas_clientes',   'buscas_clientes_service_only'],
    ['config_admin',      'config_admin_service_only'],
    ['erros_webhook',     'erros_webhook_service_only'],
    ['knowledge_chunks',  'knowledge_chunks_service_only'],
    ['pagamentos',        'pagamentos_service_only'],
    ['vendas_concluidas', 'vendas_concluidas_service_only']
  ];
BEGIN
  FOR i IN 1 .. array_length(spec, 1) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', spec[i][1]);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec[i][2], spec[i][1]);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (false)',
      spec[i][2], spec[i][1]
    );
  END LOOP;
END $$;

-- ── 3. veiculos: dono OU vendedor (owner_user_id do JWT app_metadata) ────────
ALTER TABLE public.veiculos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "veiculos_owner" ON public.veiculos;
CREATE POLICY "veiculos_owner" ON public.veiculos FOR ALL TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR user_id = ((((SELECT auth.jwt()) -> 'app_metadata') ->> 'owner_user_id'))::uuid
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR user_id = ((((SELECT auth.jwt()) -> 'app_metadata') ->> 'owner_user_id'))::uuid
  );

-- ── 4. leads: dono (ALL) + vendedor da garagem pode LER ──────────────────────
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_owner" ON public.leads;
CREATE POLICY "tenant_owner" ON public.leads FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Vendedor pode ver leads da garagem" ON public.leads;
CREATE POLICY "Vendedor pode ver leads da garagem" ON public.leads FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM public.vendedores v
      WHERE v.auth_user_id = ((SELECT auth.uid()))::text
        AND v.user_id = leads.user_id
    )
  );

-- ── 5. mensagens: escopo via join em leads (dono) + vendedor da garagem (LER) ─
ALTER TABLE public.mensagens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_owner" ON public.mensagens;
CREATE POLICY "tenant_owner" ON public.mensagens FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = mensagens.lead_id AND l.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = mensagens.lead_id AND l.user_id = (SELECT auth.uid())
  ));
DROP POLICY IF EXISTS "Vendedor pode ver mensagens da garagem" ON public.mensagens;
CREATE POLICY "Vendedor pode ver mensagens da garagem" ON public.mensagens FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = mensagens.lead_id
      AND (
        l.user_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.vendedores v
          WHERE v.auth_user_id = ((SELECT auth.uid()))::text AND v.user_id = l.user_id
        )
      )
  ));

-- ── 6. vendedores: dono (ALL) + o próprio vendedor pode ver seu perfil ───────
ALTER TABLE public.vendedores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_owner" ON public.vendedores;
CREATE POLICY "tenant_owner" ON public.vendedores FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Vendedor pode ver proprio perfil" ON public.vendedores;
CREATE POLICY "Vendedor pode ver proprio perfil" ON public.vendedores FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR auth_user_id = ((SELECT auth.uid()))::text
  );

-- ── 7. Tabelas com RLS LIGADO e SEM policy (deny-all proposital, locked) ─────
-- Acessadas só via service role; o frontend nunca lê direto. Mantém trancadas.
ALTER TABLE public.anuncios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospects         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospeccao_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospeccao_stats  ENABLE ROW LEVEL SECURITY;

-- ── 8. Hardening de search_path nas funções (advisor: function_search_path_mutable) ──
ALTER FUNCTION public.increment_prospeccao_stat(p_dia date, p_campo text, p_inc integer)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.leads_sem_atendimento_ids(p_user_id uuid)
  SET search_path = public, pg_temp;
