// lib/api-auth.ts
// Helper para validar autenticação em API routes e verificar posse de recursos

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { rateLimit } from "@/lib/redis";

/**
 * Valida o ADMIN_SECRET de forma segura.
 * - Retorna 401 se o secret não estiver configurado (evita fail-open com string vazia)
 * - Retorna 401 se o header não bater (comparação timing-safe)
 * - Conta apenas FALHAS para rate limit por IP — 10 falhas/min bloqueiam o IP por 1 min.
 *   Mantém defesa anti brute-force sem prejudicar o uso legítimo (que faz dezenas de
 *   chamadas seguidas ao trocar plano, estender trial, atualizar stats etc).
 */
export async function requireAdminSecret(req: NextRequest): Promise<NextResponse | null> {
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

import { createSupabaseServerClient } from "@/lib/supabase-server";
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
