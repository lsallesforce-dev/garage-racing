// app/api/cron/cobranca-vencimento/route.ts
//
// Cron diário (9h BRT): avisa o financeiro da revenda — via WhatsApp, pela Avisa
// do PRÓPRIO tenant — que a assinatura está perto de vencer, com link de renovação.
// Régua de marcos: 7, 3, 1, 0 dias e vencido (-1). Idempotente por `cobranca_ultimo_marco`.
// Só processa tenants com `cobranca_automatica = true` (opt-in) e plano ativo.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage } from "@/lib/avisa";
import { calcularDescontoIndicacao } from "@/lib/indicacao";

export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.autozap.digital";

// Preço mensal por plano (R$) — espelha VALORES de lib/pagarme (em reais, p/ exibição).
const PRECO_MENSAL: Record<string, number> = { starter: 1150, pro: 1500, premium: 2135 };

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Diferença em DIAS DE CALENDÁRIO no fuso de Brasília (-03), sem libs de timezone.
// Evita o off-by-one de comparar instantes de 24h quando o vencimento é "fim do dia".
function diasAteBrt(venceISO: string): number {
  const OFFSET = 3 * 3_600_000; // BRT = UTC-3
  const soData = (ms: number) => {
    const d = new Date(ms - OFFSET);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  return Math.round((soData(new Date(venceISO).getTime()) - soData(Date.now())) / 86_400_000);
}

// Data (YYYY-MM-DD) do vencimento no fuso de Brasília — usada como chave da conta a receber.
function ymdBrt(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 3_600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Mapeia dias-até-vencer → marco da régua (7,3,1,0,-1). null = ainda fora da janela.
function marcoDe(dias: number): number | null {
  if (dias < 0)  return -1; // vencido
  if (dias === 0) return 0; // vence hoje
  if (dias <= 1) return 1;
  if (dias <= 3) return 3;
  if (dias <= 7) return 7;
  return null;              // ainda longe
}

function corpoMensagem(nome: string, plano: string, dias: number, venceISO: string, link: string): string {
  const preco = PRECO_MENSAL[plano] ?? PRECO_MENSAL.starter;
  const planoNome = plano.charAt(0).toUpperCase() + plano.slice(1);
  const dataBR = new Date(venceISO).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const quando =
    dias < 0    ? `*venceu* em ${dataBR}` :
    dias === 0  ? `vence *hoje* (${dataBR})` :
    dias === 1  ? `vence *amanhã* (${dataBR})` :
                  `vence em *${dias} dias* (${dataBR})`;

  return (
    `💳 *AutoZap — Renovação de assinatura*\n\n` +
    `Olá! A assinatura *${planoNome}* da ${nome} ${quando}.\n\n` +
    `Pra manter o atendimento automático no ar, é só renovar aqui 👇\n` +
    `${link}\n\n` +
    `Valor do plano: *${fmtBRL(preco)}/mês*.\n` +
    `Qualquer dúvida, é só chamar. 🚗`
  );
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: tenants, error } = await supabaseAdmin
    .from("config_garage")
    .select(
      "user_id, nome_empresa, nome_fantasia, plano, plano_vence_em, whatsapp, whatsapp_financeiro, avisa_base_url, avisa_token, cobranca_ultimo_marco"
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
        const preco = PRECO_MENSAL[t.plano] ?? PRECO_MENSAL.starter;
        // Abate créditos de indicação disponíveis (5% das indicações pagas)
        const desconto = await calcularDescontoIndicacao(t.user_id, preco);
        const valor = Math.round((preco - desconto) * 100) / 100;
        await supabaseAdmin.from("pagamentos").insert({
          user_id: t.user_id,
          valor,
          plano: t.plano,
          metodo: "mensalidade",
          status: "pendente",
          vencimento: venceYmd,
          notas: desconto > 0 ? "auto:mensalidade (credito indicacao)" : "auto:mensalidade",
          desconto_indicacao: desconto,
        });
        resultados.push({ tenant: t.nome_empresa, status: "conta_gerada", vencimento: venceYmd, valor, desconto });
      }
    }

    const dias = diasAteBrt(t.plano_vence_em);
    const marco = marcoDe(dias);

    // Fora da janela (renovou ou ainda longe): zera o controle p/ o próximo ciclo.
    if (marco === null) {
      if (t.cobranca_ultimo_marco !== null) {
        await supabaseAdmin
          .from("config_garage")
          .update({ cobranca_ultimo_marco: null })
          .eq("user_id", t.user_id);
      }
      continue;
    }

    // Idempotência: só dispara ao ENTRAR num marco mais próximo do que o último enviado.
    if (t.cobranca_ultimo_marco !== null && marco >= t.cobranca_ultimo_marco) {
      resultados.push({ tenant: t.nome_empresa, dias, marco, status: "ja_avisado" });
      continue;
    }

    const destino = t.whatsapp_financeiro || t.whatsapp;
    if (!destino || !t.avisa_base_url || !t.avisa_token) {
      resultados.push({ tenant: t.nome_empresa, dias, marco, status: "sem_canal" });
      continue;
    }

    const nome = t.nome_fantasia || t.nome_empresa || "sua revenda";
    const link = `${SITE}/assinar?plano=${t.plano ?? "starter"}&renovacao=1`;
    const corpo = corpoMensagem(nome, t.plano ?? "starter", dias, t.plano_vence_em, link);

    const enviou = await sendAvisaMessage(
      destino,
      corpo,
      { baseUrl: t.avisa_base_url, token: t.avisa_token },
      { typing: false }
    );

    if (enviou) {
      await supabaseAdmin
        .from("config_garage")
        .update({ cobranca_ultimo_marco: marco, cobranca_ultimo_aviso_em: new Date().toISOString() })
        .eq("user_id", t.user_id);
    }

    resultados.push({
      tenant: t.nome_empresa,
      dias,
      marco,
      destino,
      status: enviou ? "enviado" : "falha_envio",
    });
  }

  console.log(`💳 [cobranca-vencimento] ${JSON.stringify(resultados)}`);
  return NextResponse.json({ ok: true, processados: resultados });
}
