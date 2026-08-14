// app/api/admin/vendas/repescagem/route.ts
// =============================================================================
// Repescagem manual dos lojistas que conversaram e esfriaram (ação do Lucas).
// =============================================================================
// NÃO é follow-up de campanha: quem nunca respondeu continua intocado, a regra
// de tiro único vale. Aqui é o oposto — o lojista que ENGAJOU, viu a demo e
// sumiu. A mensagem que ele recebe é a própria demonstração da repescagem que o
// AutoZap faria com os clientes dele. Ver lib/prospeccao-repescagem.ts.
//
// GET  → prévia (quem entraria, sem enviar nada)
// POST → envia, um por vez, espaçado
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";
import { sendAvisaMessage, autozapAvisaCreds } from "@/lib/avisa";
import { carregarPatioDemo } from "@/lib/process-prospeccao";
import { primeiroNome } from "@/lib/prospeccao-abertura";
import {
  HORAS_ATE_REPESCAGEM,
  carroDaConversa,
  montarRepescagem,
} from "@/lib/prospeccao-repescagem";
import type { Prospect, ProspectMensagem } from "@/lib/prospeccao-types";

// Envio espaçado ocupa a request; o teto da Vercel é o limite real.
export const maxDuration = 300;

// Teto por clique. Mesmo que 30 estejam elegíveis, 30 disparos seguidos é
// rajada — o padrão que queima chip. O que sobrar continua elegível no próximo.
const MAX_POR_CLIQUE = 10;
// Espaço entre um lojista e outro. Não é o intervalo do cron (40-60min): aqui
// são poucos contatos e uma ação consciente, mas seguidas no mesmo segundo
// seria burrice.
const PAUSA_ENTRE_PROSPECTS_MS = 20_000;
const PAUSA_ENTRE_BOLHAS_MS = 4_000;

/**
 * Quem está elegível: conversou de verdade (tem mensagem dele no histórico),
 * a última troca passou de HORAS_ATE_REPESCAGEM, não pediu pra sair e não está
 * com humano. `sem_resposta` ENTRA de propósito: é o status de quem encerrou
 * educado ("ok, obrigado") — exatamente o cara que a repescagem existe pra
 * reacender. Quem nunca respondeu não aparece aqui: sem mensagem dele, fora.
 */
async function elegiveis(): Promise<Prospect[]> {
  const limite = new Date(Date.now() - HORAS_ATE_REPESCAGEM * 3600_000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("prospects")
    .select("*")
    .in("status", ["respondeu", "quente", "sem_resposta", "handoff"])
    .eq("opt_out", false)
    .eq("em_atendimento_humano", false)
    .is("repescagem_em", null)
    .lt("ultima_msg_at", limite)
    .order("ultima_msg_at", { ascending: true });

  if (error) {
    console.error("❌ [vendas/repescagem] falha ao listar elegíveis:", error.message);
    return [];
  }

  // Filtro que o SQL não faz: precisa ter falado. `status` sozinho não garante
  // — um prospect pode ter virado sem_resposta sem nunca ter escrito nada.
  const ids = (data ?? []).map((p) => p.id);
  if (ids.length === 0) return [];

  const { data: falantes } = await supabaseAdmin
    .from("prospect_mensagens")
    .select("prospect_id")
    .in("prospect_id", ids)
    .eq("remetente", "prospect");

  const comFala = new Set((falantes ?? []).map((m) => m.prospect_id));
  return ((data ?? []) as Prospect[]).filter((p) => comFala.has(p.id));
}

export async function GET(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const lista = await elegiveis();
  return NextResponse.json({
    elegiveis: lista.length,
    horas: HORAS_ATE_REPESCAGEM,
    max_por_clique: MAX_POR_CLIQUE,
    prospects: lista.slice(0, MAX_POR_CLIQUE).map((p) => ({
      id: p.id,
      nome_empresa: p.nome_empresa,
      cidade: p.cidade,
      status: p.status,
      ultima_msg_at: p.ultima_msg_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const creds = autozapAvisaCreds();
  if (!creds) {
    return NextResponse.json(
      { error: "AUTOZAP_AVISA_* ausentes — instância da Mari não configurada." },
      { status: 400 },
    );
  }

  const lista = (await elegiveis()).slice(0, MAX_POR_CLIQUE);
  if (lista.length === 0) {
    return NextResponse.json({ ok: true, enviados: 0, falhas: 0, detalhe: [] });
  }

  const patio = await carregarPatioDemo();
  const detalhe: { prospect: string; ok: boolean; carro: string | null; erro?: string }[] = [];
  let enviados = 0;
  let falhas = 0;

  for (let i = 0; i < lista.length; i++) {
    const p = lista[i];
    if (i > 0) await new Promise((r) => setTimeout(r, PAUSA_ENTRE_PROSPECTS_MS));

    const alvo = p.wa_id || p.telefone;
    if (!alvo) {
      falhas++;
      detalhe.push({ prospect: p.nome_empresa, ok: false, carro: null, erro: "sem telefone" });
      continue;
    }

    const { data: msgs } = await supabaseAdmin
      .from("prospect_mensagens")
      .select("*")
      .eq("prospect_id", p.id)
      .order("created_at", { ascending: true });

    const carro = carroDaConversa((msgs ?? []) as ProspectMensagem[], patio);
    const bolhas = montarRepescagem(carro, primeiroNome(p.nome_empresa) || null);

    let ok = true;
    const erroRef: { message?: string } = {};
    for (let b = 0; b < bolhas.length; b++) {
      if (b > 0) await new Promise((r) => setTimeout(r, PAUSA_ENTRE_BOLHAS_MS));
      const enviou = await sendAvisaMessage(alvo, bolhas[b], creds, { typing: b === 0 }, erroRef);
      if (!enviou) { ok = false; break; }
    }

    if (ok) {
      enviados++;
      const agora = new Date().toISOString();
      await Promise.all([
        supabaseAdmin.from("prospect_mensagens").insert(
          bolhas.map((c) => ({ prospect_id: p.id, remetente: "agente", content: c })),
        ),
        // Volta pra "respondeu": a conversa está viva de novo e o webhook trata
        // a resposta dele normalmente. `repescagem_em` é o que impede repetir.
        supabaseAdmin
          .from("prospects")
          .update({ repescagem_em: agora, status: "respondeu", ultima_msg_at: agora, updated_at: agora })
          .eq("id", p.id),
      ]);
    } else {
      falhas++;
      // NÃO marca repescagem_em quando falhou: ele não recebeu nada, então
      // continua elegível pro próximo clique.
      console.error(`❌ [vendas/repescagem] ${p.nome_empresa}: ${erroRef.message ?? "envio recusado"}`);
    }

    detalhe.push({
      prospect: p.nome_empresa,
      ok,
      carro: carro ? carro.descricao : null,
      ...(ok ? {} : { erro: erroRef.message ?? "envio recusado" }),
    });
  }

  console.log(`🎣 [vendas/repescagem] ${enviados} enviada(s), ${falhas} falha(s).`);
  return NextResponse.json({ ok: true, enviados, falhas, detalhe });
}
