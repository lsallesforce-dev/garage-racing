// app/api/cron/cobranca-vencimento/route.ts
//
// Cron diário (9h BRT): avisa o financeiro da revenda — pelo chip do tenant AutoZap,
// com fallback pra Avisa do próprio tenant — que a assinatura está perto de vencer,
// com link de renovação TOKENIZADO (/assinar?t=<cobranca_token>&renovacao=1).
// Régua de marcos v2: 2, 0 dias e vencido (-1). Idempotente por `cobranca_ultimo_marco`.
// Só processa tenants com `cobranca_automatica = true` (opt-in) e plano ativo.
// Suspensão automática (opt-in `suspensao_automatica`): 5+ dias de atraso → plano_ativo=false.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logEventoAdmin } from "@/lib/admin-eventos";
import { alertaInterno } from "@/lib/alerta-interno";
import {
  diasAteBrt,
  ymdBrt,
  marcoDe,
  fmtBRL,
  calcularValorCobranca,
  enviarCobranca,
  resolverRemetente,
} from "@/lib/cobranca";

export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Alerta interno pro Lucas (AUTOZAP_ALERT_WHATSAPP) — mesmo padrão do
// healthcheck-agentes, mas preferindo as credenciais do remetente AutoZap
// (config_garage) com fallback pras envs AUTOZAP_AVISA_*.
async function alertarInterno(texto: string): Promise<boolean> {
  const alvo = process.env.AUTOZAP_ALERT_WHATSAPP;
  if (!alvo) {
    console.warn("⚠️ [cobranca-vencimento] AUTOZAP_ALERT_WHATSAPP ausente — alerta não enviado.");
    return false;
  }
  const creds =
    (await resolverRemetente()) ??
    (process.env.AUTOZAP_AVISA_BASE_URL && process.env.AUTOZAP_AVISA_TOKEN
      ? { baseUrl: process.env.AUTOZAP_AVISA_BASE_URL, token: process.env.AUTOZAP_AVISA_TOKEN }
      : null);
  // creds pode ser null: o alerta ainda sai por e-mail. Antes, sem remetente
  // Avisa, o cron simplesmente desistia de avisar.
  const { entregue } = await alertaInterno(
    "cobranca-vencimento", "Cobrança / vencimento", texto, { credsWhatsApp: creds },
  );
  return entregue;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: tenants, error } = await supabaseAdmin
    .from("config_garage")
    .select(
      "user_id, nome_empresa, nome_fantasia, plano, plano_vence_em, whatsapp, whatsapp_financeiro, avisa_base_url, avisa_token, plano_desconto, cobranca_token, cobranca_ultimo_marco, suspensao_automatica"
    )
    .eq("plano_ativo", true)
    .eq("cobranca_automatica", true);

  if (error) {
    console.error("❌ [cobranca-vencimento] erro ao carregar tenants:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const resultados: Array<Record<string, unknown>> = [];

  for (const t of tenants ?? []) {
    if (!t.plano_vence_em) continue;

    // ── Conta a receber automática ────────────────────────────────────────────
    // Garante 1 cobrança em aberto para o ciclo atual (vencimento = plano_vence_em).
    // Quando ela é paga e o plano_vence_em estende, a próxima é gerada sozinha.
    if (t.plano && t.plano !== "trial" && t.plano !== "demo") {
      const venceYmd = ymdBrt(t.plano_vence_em);
      const { data: jaTem } = await supabaseAdmin
        .from("pagamentos")
        .select("id")
        .eq("user_id", t.user_id)
        .eq("vencimento", venceYmd)
        .like("notas", "auto:%")
        .maybeSingle();
      if (!jaTem) {
        // Valor REAL: preço − desconto negociado (plano_desconto) − créditos de
        // indicação, piso R$1 — antes o desconto negociado era ignorado aqui (bug).
        const { valor, descontoNegociado, descontoIndicacao } = await calcularValorCobranca(
          t.user_id,
          t.plano,
          t.plano_desconto
        );
        await supabaseAdmin.from("pagamentos").insert({
          user_id: t.user_id,
          valor,
          plano: t.plano,
          metodo: "mensalidade",
          status: "pendente",
          vencimento: venceYmd,
          notas: descontoIndicacao > 0 ? "auto:mensalidade (credito indicacao)" : "auto:mensalidade",
          desconto_indicacao: descontoIndicacao,
        });
        await logEventoAdmin(
          t.user_id,
          "conta_gerada",
          `Conta a receber gerada — ${fmtBRL(valor)} (venc. ${venceYmd.split("-").reverse().join("/")})`,
          { vencimento: venceYmd, valor, desconto_negociado: descontoNegociado, desconto_indicacao: descontoIndicacao }
        );
        resultados.push({ tenant: t.nome_empresa, status: "conta_gerada", vencimento: venceYmd, valor, desconto: descontoIndicacao });
      }
    }

    const dias = diasAteBrt(t.plano_vence_em);
    const marco = marcoDe(dias);

    if (marco === null) {
      // Fora da janela (renovou ou ainda longe): zera o controle p/ o próximo ciclo.
      if (t.cobranca_ultimo_marco !== null) {
        await supabaseAdmin
          .from("config_garage")
          .update({ cobranca_ultimo_marco: null })
          .eq("user_id", t.user_id);
      }
    } else if (t.cobranca_ultimo_marco !== null && marco >= t.cobranca_ultimo_marco) {
      // Idempotência: só dispara ao ENTRAR num marco mais próximo do que o último enviado.
      resultados.push({ tenant: t.nome_empresa, dias, marco, status: "ja_avisado" });
    } else {
      const r = await enviarCobranca(t, dias);

      if (r.ok) {
        await supabaseAdmin
          .from("config_garage")
          .update({ cobranca_ultimo_marco: marco, cobranca_ultimo_aviso_em: new Date().toISOString() })
          .eq("user_id", t.user_id);
      }

      resultados.push({
        tenant: t.nome_empresa,
        dias,
        marco,
        destino: r.destino,
        status: r.ok ? "enviado" : (r.motivo ?? "falha_envio"),
      });
    }

    // ── Suspensão automática (opt-in) ─────────────────────────────────────────
    // 5+ dias de atraso → pausa a IA (plano_ativo=false). Só tenants que optaram
    // (`suspensao_automatica`); o select já garante plano_ativo=true aqui.
    if (t.suspensao_automatica === true && dias <= -5) {
      const { error: errSusp } = await supabaseAdmin
        .from("config_garage")
        .update({ plano_ativo: false })
        .eq("user_id", t.user_id);

      if (!errSusp) {
        const nome = t.nome_fantasia || t.nome_empresa || t.user_id;
        const dataBR = new Date(t.plano_vence_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
        await logEventoAdmin(
          t.user_id,
          "suspensao",
          `Plano suspenso automaticamente (${-dias} dias de atraso)`,
          { dias, plano: t.plano, plano_vence_em: t.plano_vence_em }
        );
        await alertarInterno(
          `⛔ *Suspensão automática — AutoZap*\n\n` +
            `O tenant *${nome}* foi suspenso (plano_ativo = false) por atraso de *${-dias} dias* ` +
            `no plano ${t.plano ?? "?"} (venceu em ${dataBR}).\n\n` +
            `Reativação: painel admin → Ativar.`
        );
        resultados.push({ tenant: t.nome_empresa, dias, status: "suspenso" });
      } else {
        console.error(`❌ [cobranca-vencimento] falha ao suspender ${t.nome_empresa}:`, errSusp.message);
        resultados.push({ tenant: t.nome_empresa, dias, status: "falha_suspensao" });
      }
    }
  }

  console.log(`💳 [cobranca-vencimento] ${JSON.stringify(resultados)}`);
  return NextResponse.json({ ok: true, processados: resultados });
}
