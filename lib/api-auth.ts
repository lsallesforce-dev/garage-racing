// lib/api-auth.ts
// Helper para validar autenticação em API routes e verificar posse de recursos

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { rateLimit } from "@/lib/redis";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * true se a request tem uma sessão Supabase de ADMIN (app_metadata.is_admin)
 * com 2FA já validada na sessão (AAL2). Falha fechada em qualquer erro.
 * É o caminho que substitui a senha-mestra estática.
 */
async function isAdminSessionWith2FA(): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.app_metadata?.is_admin !== true) return false;
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return aal?.currentLevel === "aal2";
  } catch {
    return false;
  }
}

/**
 * Valida o ADMIN_SECRET de forma segura.
 * - Retorna 401 se o secret não estiver configurado (evita fail-open com string vazia)
 * - Retorna 401 se o header não bater (comparação timing-safe)
 * - Conta apenas FALHAS para rate limit por IP — 10 falhas/min bloqueiam o IP por 1 min.
 *   Mantém defesa anti brute-force sem prejudicar o uso legítimo (que faz dezenas de
 *   chamadas seguidas ao trocar plano, estender trial, atualizar stats etc).
 */
export async function requireAdminSecret(req: NextRequest): Promise<NextResponse | null> {
  // ── Caminho novo (recomendado): sessão Supabase + is_admin + 2FA (AAL2) ──────
  // Admin logado com a própria conta e 2FA validada passa SEM precisar do secret.
  // Conta-por-pessoa, sessão que expira, sem string estática trafegando, rastro
  // individual. Para EXIGIR isso de todos, basta apagar ADMIN_SECRET no Vercel —
  // aí o fallback legado abaixo deixa de existir (retorna 401 fail-closed).
  if (await isAdminSessionWith2FA()) return null;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";

  // Bloqueia ANTES de validar — se o IP já estourou (10 falhas/min), barra de cara
  const blockCheck = await rateLimit(`admin:fail:${ip}`, 10, 60, { increment: false });
  if (!blockCheck.allowed) {
    return NextResponse.json({ error: "Muitas tentativas inválidas — aguarde 1 min" }, { status: 429 });
  }

  const configured = process.env.ADMIN_SECRET;
  if (!configured) {
    return NextResponse.json({ error: "Admin não configurado" }, { status: 401 });
  }
  const provided = req.headers.get("x-admin-secret");
  if (!provided) {
    await rateLimit(`admin:fail:${ip}`, 10, 60);
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // timingSafeEqual evita timing attacks ao comparar secrets
  const configuredBuf = Buffer.from(configured, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  const match =
    configuredBuf.length === providedBuf.length &&
    timingSafeEqual(configuredBuf, providedBuf);

  if (!match) {
    await rateLimit(`admin:fail:${ip}`, 10, 60);
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return null; // autorizado — não consome budget do rate limit
}

import type { User } from "@supabase/supabase-js";

/**
 * Retorna o user autenticado ou uma resposta 401.
 * Uso: const { user, error } = await requireAuth();
 */
export async function requireAuth() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { user: null, error: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  }
  return { user, error: null };
}

/**
 * Resolve o userId efetivo do tenant para um usuário autenticado.
 * Lê de app_metadata primeiro (imutável pelo usuário), com fallback para user_metadata.
 * Vendedores retornam o owner_user_id (tenant do dono), não o próprio id.
 */
export function getEffectiveUserId(user: User): string {
  const role = user.app_metadata?.role ?? user.user_metadata?.role;
  if (role !== "vendedor") return user.id;
  const ownerId = user.app_metadata?.owner_user_id ?? user.user_metadata?.owner_user_id;
  return ownerId ?? user.id;
}

/** Papel do usuário (dono por padrão). */
export function getUserRole(user: User): string {
  return user.app_metadata?.role ?? user.user_metadata?.role ?? "dono";
}

/** true se o usuário é vendedor (acesso restrito — não vê dados financeiros da loja). */
export function isVendedor(user: User): boolean {
  return getUserRole(user) === "vendedor";
}

/**
 * Exige usuário autenticado que NÃO seja vendedor (rotas financeiras do dono/gerente).
 * Vendedor recebe 403 — protege lucro, custo, margem e comissões da equipe.
 * Uso: const { user, error } = await requireOwner(); if (error) return error;
 */
export async function requireOwner() {
  const { user, error } = await requireAuth();
  if (error) return { user: null, error };
  if (isVendedor(user!)) {
    return {
      user: null,
      error: NextResponse.json({ error: "Acesso restrito ao administrador" }, { status: 403 }),
    };
  }
  return { user, error: null };
}

/**
 * Verifica se um veículo pertence ao user autenticado.
 * Retorna 401 sem auth, 403 se o veículo for de outro tenant.
 */
export async function requireVehicleOwner(veiculoId: string) {
  const { user, error } = await requireAuth();
  if (error) return { user: null, error };

  const { createClient } = await import("@supabase/supabase-js");
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data } = await supabaseAdmin
    .from("veiculos")
    .select("user_id")
    .eq("id", veiculoId)
    .single();

  if (!data) return { user: null, error: NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 }) };

  const effectiveUserId = getEffectiveUserId(user!);

  if (data.user_id !== effectiveUserId) {
    return { user: null, error: NextResponse.json({ error: "Acesso negado" }, { status: 403 }) };
  }

  return { user, error: null };
}

/**
 * Verifica se um lead pertence ao user autenticado.
 */
export async function requireLeadOwner(leadId: string) {
  const { user, error } = await requireAuth();
  if (error) return { user: null, error };

  const { createClient } = await import("@supabase/supabase-js");
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data } = await supabaseAdmin
    .from("leads")
    .select("user_id")
    .eq("id", leadId)
    .single();

  if (!data) return { user: null, error: NextResponse.json({ error: "Lead não encontrado" }, { status: 404 }) };

  const effectiveUserId = getEffectiveUserId(user!);

  if (data.user_id !== effectiveUserId) {
    return { user: null, error: NextResponse.json({ error: "Acesso negado" }, { status: 403 }) };
  }

  return { user, error: null };
}
