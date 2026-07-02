// scripts/test-rls.ts
//
// Teste de vazamento de RLS — roda contra o banco REAL com as chaves de client
// (anon), nunca com service role. Detecta a regressão clássica: alguém cria uma
// policy permissiva no painel e abre dados cross-tenant sem perceber.
//
// Rodar:  npm run test:rls
// Sai com código 1 se QUALQUER tabela vazar linha — bom pra rodar antes de push.
//
// Fase 1 (sempre): client anon SEM sessão → toda tabela sensível deve devolver
//   zero linhas (auth.uid() = null e nenhuma policy concede nada pro role anon).
// Fase 2 (opcional): se TEST_RLS_EMAIL + TEST_RLS_PASSWORD estiverem no env
//   (conta de tenant demo), loga e prova que não enxerga linha de OUTRO tenant.

import { config } from "dotenv";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
config();

// Tabelas de tenant (têm user_id; policy = dono/vendedor da garagem)
const TENANT_TABLES = [
  "config_garage", "leads", "mensagens", "clientes", "vendedores", "veiculos",
  "agenda", "contratos", "despesas_veiculo", "receitas_veiculo",
  "financeiro_geral", "leads_conversas", "meta_campanhas", "meta_paginas",
  "fechamentos_mes",
];

// Tabelas server-only (policy explícita USING (false) — migration 016 e afins):
// client NUNCA lê, nem logado. Todo acesso é service role via rotas de API.
const SERVICE_TABLES = [
  "pagamentos", "admin_audit_log", "vendas_concluidas", "buscas_clientes",
  "config_admin", "erros_webhook", "knowledge_chunks", "anuncios",
  "creditos_indicacao", "prospects", "prospect_mensagens",
  "prospeccao_config", "prospeccao_stats",
];

let vazamentos = 0;
let avisos = 0;

async function esperaZero(client: SupabaseClient, tabela: string, contexto: string, filtroNeqUser?: string) {
  let query = client.from(tabela).select("*").limit(3);
  if (filtroNeqUser) query = client.from(tabela).select("user_id").neq("user_id", filtroNeqUser).limit(3);
  const { data, error } = await query;

  if (error) {
    // Erro de permissão/relation = acesso negado ou tabela renomeada — não é vazamento
    console.log(`  ⚠️  ${tabela} (${contexto}): erro "${error.message}" — conferir se a tabela ainda existe`);
    avisos++;
    return;
  }
  if ((data?.length ?? 0) > 0) {
    console.log(`  🚨 VAZOU ${tabela} (${contexto}): ${data!.length} linha(s) visíveis!`);
    vazamentos++;
  } else {
    console.log(`  ✅ ${tabela}`);
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY ausentes (.env.local)");
    process.exit(1);
  }

  // ── Fase 1: anon sem sessão ─────────────────────────────────────────────
  console.log("\n── Fase 1: client anon SEM sessão (tudo deve dar 0 linhas) ──");
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  for (const t of [...TENANT_TABLES, ...SERVICE_TABLES]) {
    await esperaZero(anon, t, "anon");
  }

  // ── Fase 2: autenticado, prova cross-tenant ─────────────────────────────
  const email = process.env.TEST_RLS_EMAIL;
  const senha = process.env.TEST_RLS_PASSWORD;
  if (email && senha) {
    console.log("\n── Fase 2: logado como tenant de teste (não pode ver OUTRO tenant) ──");
    const auth = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: login, error: loginErr } = await auth.auth.signInWithPassword({ email, password: senha });
    if (loginErr || !login.user) {
      console.error(`  Login de teste falhou: ${loginErr?.message}`);
      process.exit(1);
    }
    const meuUid = login.user.id;
    console.log(`  (logado como ${email}, uid ${meuUid.slice(0, 8)}…)`);
    for (const t of TENANT_TABLES) {
      await esperaZero(auth, t, "cross-tenant", meuUid);
    }
    for (const t of SERVICE_TABLES) {
      await esperaZero(auth, t, "authenticated"); // service-only: nem logado lê
    }
    await auth.auth.signOut();
  } else {
    console.log("\n(Fase 2 pulada — defina TEST_RLS_EMAIL/TEST_RLS_PASSWORD de uma conta demo para testar cross-tenant logado)");
  }

  console.log(`\nResultado: ${vazamentos === 0 ? "✅ nenhum vazamento" : `🚨 ${vazamentos} vazamento(s)`}${avisos ? ` · ${avisos} aviso(s)` : ""}`);
  process.exit(vazamentos === 0 ? 0 : 1);
}

main();
