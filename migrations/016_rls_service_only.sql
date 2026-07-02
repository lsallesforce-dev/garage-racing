-- 016: deny-all EXPLÍCITO nas tabelas server-only que estavam sem policy.
--
-- Estas 6 tabelas têm RLS ligado e ZERO policies — deny-all "por acidente".
-- O comportamento já era o correto (anon/authenticated não leem nada; todo
-- acesso é via service role nas rotas de API, que validam posse manualmente),
-- mas nada documentava a intenção e o advisor "rls_enabled_no_policy" acusava.
--
-- Padrão-casa: policy explícita USING (false) para authenticated, igual a
-- pagamentos_service_only / admin_audit_log_service_only / etc.
-- NÃO criar policy permissiva nessas tabelas "pra resolver o linter" —
-- isso ABRIRIA dados cross-tenant (prospects/prospect_mensagens são da
-- prospecção B2B do AutoZap, não de tenant).

CREATE POLICY "anuncios_service_only" ON public.anuncios
  FOR ALL TO authenticated USING (false);

CREATE POLICY "creditos_indicacao_service_only" ON public.creditos_indicacao
  FOR ALL TO authenticated USING (false);

CREATE POLICY "prospeccao_config_service_only" ON public.prospeccao_config
  FOR ALL TO authenticated USING (false);

CREATE POLICY "prospeccao_stats_service_only" ON public.prospeccao_stats
  FOR ALL TO authenticated USING (false);

CREATE POLICY "prospects_service_only" ON public.prospects
  FOR ALL TO authenticated USING (false);

CREATE POLICY "prospect_mensagens_service_only" ON public.prospect_mensagens
  FOR ALL TO authenticated USING (false);
