// lib/kit-cota.ts
//
// Cota mensal de Kits de Postagem (modelo nov/2026, ver lib/planos.ts):
// Starter/trial = 5 kits/mês, Pro/Premium/demo = ilimitado. 1 kit = 1 VEÍCULO no mês
// (BRT) — regenerar capa/legenda/carrossel/reel/piso do mesmo carro NÃO consome.
//
// Registro atômico na RPC kit_consumo_registrar (migration 077). Se a RPC falhar
// (migration ausente, erro de rede) → FAIL-OPEN: o kit gera normalmente. Cota é
// monetização, não segurança; travar o cliente por erro nosso é pior.
//
// Assinatura inativa (trial vencido / plano pausado / bloqueado) → bloqueia
// (fail-closed, mesmo critério da vitrine em lib/assinatura.ts).

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assinaturaAtiva } from "@/lib/assinatura";
import { kitsDoPlano } from "@/lib/planos";

export interface UsoKits {
  usados: number;
  limite: number | null; // null = ilimitado
  plano: string | null;
}

interface CfgCota {
  plano?: string | null;
  kits_mes_override?: number | null;
  plano_ativo?: boolean | null;
  plano_vence_em?: string | null;
  trial_ends_at?: string | null;
  bloqueado?: boolean | null;
}

export function competenciaBRT(d: Date = new Date()): string {
  // YYYY-MM no fuso America/Sao_Paulo (sem horário de verão: UTC-3).
  const brt = new Date(d.getTime() - 3 * 3600 * 1000);
  return brt.toISOString().slice(0, 7);
}

/** Plano "pago de fato" (trial válido sem plano ativo conta como trial). */
function planoEfetivo(cfg: CfgCota, agora = new Date()): string | null {
  const planoValido =
    cfg.plano_ativo === true && !!cfg.plano_vence_em && new Date(cfg.plano_vence_em) > agora;
  if (cfg.plano === "demo") return "demo";
  return planoValido ? cfg.plano ?? null : "trial";
}

export function limiteKits(cfg: CfgCota): number | null {
  if (cfg.kits_mes_override != null) return cfg.kits_mes_override;
  return kitsDoPlano(planoEfetivo(cfg));
}

async function carregarCfg(userId: string): Promise<CfgCota | null> {
  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("plano, kits_mes_override, plano_ativo, plano_vence_em, trial_ends_at, bloqueado")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (data?.[0]) return data[0] as CfgCota;
  // Migration 077 ausente (sem kits_mes_override) → tenta sem a coluna.
  const { data: d2 } = await supabaseAdmin
    .from("config_garage")
    .select("plano, plano_ativo, plano_vence_em, trial_ends_at, bloqueado")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  return (d2?.[0] as CfgCota) ?? null;
}

/** Uso do mês corrente (pra UI: contador "3/5 kits"). */
export async function usoKits(userId: string): Promise<UsoKits> {
  const cfg = await carregarCfg(userId);
  const base = cfg ? limiteKits(cfg) : null;
  const comp = competenciaBRT();
  const [{ count }, { data: extra }] = await Promise.all([
    supabaseAdmin.from("kit_consumo").select("veiculo_id", { count: "exact", head: true }).eq("user_id", userId).eq("competencia", comp),
    supabaseAdmin.from("kit_cota_extra").select("extra").eq("user_id", userId).eq("competencia", comp).maybeSingle(),
  ]);
  const limite = base === null ? null : base + (extra?.extra ?? 0);
  return { usados: count ?? 0, limite, plano: cfg ? planoEfetivo(cfg) : null };
}

/**
 * Gate das rotas de geração de kit. Retorna uma resposta de erro (403/402) ou null
 * se pode seguir. Chamar DEPOIS do requireVehicleOwner.
 */
export async function gateKit(veiculoId: string): Promise<NextResponse | null> {
  const { data: v } = await supabaseAdmin.from("veiculos").select("user_id").eq("id", veiculoId).single();
  if (!v?.user_id) return null; // requireVehicleOwner já tratou 404

  const cfg = await carregarCfg(v.user_id);
  if (cfg && !assinaturaAtiva(cfg)) {
    return NextResponse.json(
      { error: "Assinatura inativa — renove o plano para gerar kits.", codigo: "assinatura_inativa" },
      { status: 403 },
    );
  }

  const limite = cfg ? limiteKits(cfg) : null;
  const { data, error } = await supabaseAdmin.rpc("kit_consumo_registrar", {
    p_user_id: v.user_id,
    p_veiculo_id: veiculoId,
    p_limite: limite,
  });
  if (error) {
    console.warn("[kit-cota] RPC falhou, fail-open:", error.message);
    return null;
  }
  const r = data as { ok: boolean; usados: number; limite: number | null };
  if (r.ok) return null;

  return NextResponse.json(
    {
      error: `Você usou os ${r.limite} kits de postagem do mês. Faça upgrade pro Pro para kits ilimitados.`,
      codigo: "cota_kits",
      usados: r.usados,
      limite: r.limite,
      plano: cfg ? planoEfetivo(cfg) : null,
    },
    { status: 402 },
  );
}
