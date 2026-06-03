// lib/lead-routing.ts
// Roteamento de leads para vendedores — disparado quando o lead vira QUENTE.
//
// Regra de prioridade:
//   1. ESPECIALISTA — vendedor_responsavel do carro em foco (SEMPRE vence)
//   2. RODÍZIO      — próxima posição na fila sequencial (cursor atômico via RPC)
//   3. GERENTE      — fallback (retorna null → o caller usa o WhatsApp do gerente)
//
// Modos (config_garage.distribuicao_modo):
//   'off'          → nada (só gerente)
//   'especialista' → especialista do carro; senão gerente
//   'rodizio'      → fila sequencial (ignora especialista)
//   'hibrido'      → especialista quando o carro tem; senão rodízio  ← recomendado

import { supabaseAdmin } from "@/lib/supabase-admin";

export type OrigemVendedor = "especialista" | "rodizio";

export interface VendedorAlvo {
  id: string;
  nome: string | null;
  whatsapp: string | null;
  origem: OrigemVendedor;
}

const MODOS_COM_ESPECIALISTA = new Set(["especialista", "hibrido"]);
const MODOS_COM_RODIZIO = new Set(["rodizio", "hibrido"]);

function isAtivoComWhatsapp(v: any): boolean {
  return !!v && !!v.whatsapp && String(v.status ?? "").toLowerCase() === "ativo";
}

// Especialista do carro em foco (se houver e estiver ativo com WhatsApp)
async function especialistaDoVeiculo(veiculoId: string): Promise<VendedorAlvo | null> {
  const { data } = await supabaseAdmin
    .from("veiculos")
    .select("vendedor:vendedor_responsavel_id (id, nome, whatsapp, status)")
    .eq("id", veiculoId)
    .maybeSingle();
  const v: any = (data as any)?.vendedor;
  if (isAtivoComWhatsapp(v)) {
    return { id: v.id, nome: v.nome ?? null, whatsapp: v.whatsapp, origem: "especialista" };
  }
  return null;
}

// Próximo vendedor da fila — cursor avançado atomicamente no banco (FOR UPDATE)
async function proximoDoRodizio(tenantUserId: string): Promise<VendedorAlvo | null> {
  const { data: vendedorId, error } = await supabaseAdmin.rpc("proximo_vendedor_rodizio", {
    p_tenant: tenantUserId,
  });
  if (error || !vendedorId) return null;

  const { data: v } = await supabaseAdmin
    .from("vendedores")
    .select("id, nome, whatsapp")
    .eq("id", vendedorId as string)
    .maybeSingle();
  if (!v?.whatsapp) return null;
  return { id: v.id, nome: v.nome ?? null, whatsapp: v.whatsapp, origem: "rodizio" };
}

/**
 * Resolve para qual vendedor um lead QUENTE deve ir.
 * Retorna `null` quando deve cair no gerente (modo off, sem especialista e
 * sem vendedores no rodízio, etc).
 */
export async function resolverVendedor(params: {
  tenantUserId: string;
  distribuicaoModo?: string | null;
  veiculoId?: string | null;
}): Promise<VendedorAlvo | null> {
  const modo = (params.distribuicaoModo ?? "off").toLowerCase();
  if (modo === "off") return null;

  // 1) Especialista do carro em foco
  if (MODOS_COM_ESPECIALISTA.has(modo) && params.veiculoId) {
    const esp = await especialistaDoVeiculo(params.veiculoId);
    if (esp) return esp;
  }

  // 2) Rodízio sequencial
  if (MODOS_COM_RODIZIO.has(modo)) {
    const prox = await proximoDoRodizio(params.tenantUserId);
    if (prox) return prox;
  }

  // 3) Gerente (fallback)
  return null;
}
