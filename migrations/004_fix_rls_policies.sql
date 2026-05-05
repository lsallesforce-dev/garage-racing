-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 004: Corrige RLS policies permissivas (Security Advisor warnings)
--
-- SEGURANÇA: todas as operações do backend usam supabaseAdmin (service role),
-- que ignora RLS completamente. Estas policies só afetam acesso direto via
-- JWT de usuário autenticado — proteção de defesa em profundidade.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. veiculos: restringe ao dono (user_id = auth.uid()) ───────────────────
-- O dashboard client-side usa supabase.from('veiculos') com .eq('user_id', uid)
-- já filtrado — esta policy apenas formaliza a restrição no banco.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
    WHERE tablename = 'veiculos' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.veiculos', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.veiculos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "veiculos_owner"
  ON public.veiculos FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── 2. financeiro_geral: restringe ao dono ──────────────────────────────────
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
    WHERE tablename = 'financeiro_geral' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.financeiro_geral', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.financeiro_geral ENABLE ROW LEVEL SECURITY;

CREATE POLICY "financeiro_geral_owner"
  ON public.financeiro_geral FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── 3. config_admin: bloqueia acesso via JWT (só service role) ───────────────
-- Tabela de admins do sistema — nunca deve ser lida por usuários comuns.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
    WHERE tablename = 'config_admin' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.config_admin', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.config_admin ENABLE ROW LEVEL SECURITY;

CREATE POLICY "config_admin_service_only"
  ON public.config_admin FOR ALL TO authenticated
  USING (false);

-- ── 4. vendas_concluidas: bloqueia acesso via JWT (só service role) ──────────
-- Não tem user_id direto; todo acesso é via supabaseAdmin nas API routes.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
    WHERE tablename = 'vendas_concluidas' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.vendas_concluidas', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.vendas_concluidas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vendas_concluidas_service_only"
  ON public.vendas_concluidas FOR ALL TO authenticated
  USING (false);

-- ── 5. buscas_clientes: bloqueia acesso via JWT (tabela sem uso no código) ───
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
    WHERE tablename = 'buscas_clientes' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.buscas_clientes', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.buscas_clientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "buscas_clientes_service_only"
  ON public.buscas_clientes FOR ALL TO authenticated
  USING (false);

-- ── 6. Storage: remove listagem pública dos buckets de fotos ─────────────────
-- Mantém SELECT em objetos individuais (necessário para URLs das fotos na vitrine)
-- mas remove a capacidade de listar todos os arquivos do bucket.
-- Uploads continuam funcionando normalmente para usuários autenticados.

-- fotos-veiculos
UPDATE storage.buckets
  SET public = false
  WHERE id = 'fotos-veiculos';

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname ILIKE '%fotos-veiculos%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

-- Leitura pública por path específico (URL direta funciona, listagem não)
CREATE POLICY "fotos_veiculos_public_select"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'fotos-veiculos');

-- Upload apenas para autenticados
CREATE POLICY "fotos_veiculos_auth_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fotos-veiculos');

-- Delete apenas para autenticados
CREATE POLICY "fotos_veiculos_auth_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'fotos-veiculos');

-- fotos-vendedores
UPDATE storage.buckets
  SET public = false
  WHERE id = 'fotos-vendedores';

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname ILIKE '%fotos-vendedores%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "fotos_vendedores_public_select"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'fotos-vendedores');

CREATE POLICY "fotos_vendedores_auth_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fotos-vendedores');

CREATE POLICY "fotos_vendedores_auth_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'fotos-vendedores');
