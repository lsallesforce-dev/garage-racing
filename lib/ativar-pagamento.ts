// lib/ativar-pagamento.ts
//
// Efeitos de um pagamento CONFIRMADO, independentes do gateway (Pagar.me legado,
// PagBank). Antes isso vivia só no webhook do Pagar.me.
//
// - assinatura: pagamento -> pago; config_garage.plano_ativo + plano_vence_em
//   (+30/365d a partir do MAIOR entre agora e o vencimento atual) e grava o PLANO
//   pago (antes o webhook nunca atualizava `plano` -> upgrade não valia);
//   baixa a mensalidade automática (auto:mensalidade) pendente do mesmo ciclo.
// - pacote de kits (plano = "kits5"): soma +5 kits na cota do mês, não mexe no plano.
// - log no admin_eventos, crédito de indicação e e-mail pro admin.

import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { gerarCreditoIndicacao, consumirCreditoIndicacao } from "@/lib/indicacao";
import { logEventoAdmin } from "@/lib/admin-eventos";
import { PLANOS_VISIVEIS } from "@/lib/planos";

const resend = new Resend(process.env.RESEND_API_KEY);

export const PACOTE_KITS = { id: "kits5", qtd: 5, valor: 49 } as const;

export interface PagamentoConfirmado {
  id: string;
  user_id: string;
  plano: string | null;
  notas: string | null;
  valor: number | null;
  metodo: string | null;
  status: string | null;
  desconto_indicacao: number | null;
}

export async function ativarPagamento(
  pagamento: PagamentoConfirmado,
  opts: { gateway: string; orderId: string },
): Promise<void> {
  const { orderId } = opts;
  const gatewayLabel = opts.gateway;

  if (pagamento.plano === PACOTE_KITS.id) {
    await supabaseAdmin
      .from("pagamentos")
      .update({ status: "pago", pago_em: new Date().toISOString() })
      .eq("id", pagamento.id);
    const { error } = await supabaseAdmin.rpc("kit_cota_extra_add", { p_user_id: pagamento.user_id, p_qtd: PACOTE_KITS.qtd });
    if (error) console.error("[ativarPagamento] kit_cota_extra_add:", error.message);
    await logEventoAdmin(
      pagamento.user_id,
      "pagamento_confirmado",
      `Pacote +${PACOTE_KITS.qtd} kits pago no ${gatewayLabel}`,
      { order_id: orderId, valor: pagamento.valor, plano: pagamento.plano },
    );
    return;
  }

  // Detecta se é plano anual (12x) pelo campo notas
  const isAnual = pagamento.notas?.includes("anual");

  // FIX +30d: pagar/renovar adiantado não pode roubar dias — estende a partir do
  // MAIOR entre agora e o vencimento atual (antes era sempre agora + 30/365d).
  // config_garage pode ter múltiplas linhas por user_id — pega a mais recente.
  const { data: cfgRows } = await supabaseAdmin
    .from("config_garage")
    .select("plano_vence_em")
    .eq("user_id", pagamento.user_id)
    .order("created_at", { ascending: false })
    .limit(1);
  const venceAtual = cfgRows?.[0]?.plano_vence_em;
  const baseVence = venceAtual && new Date(venceAtual) > new Date()
    ? new Date(venceAtual).getTime()
    : Date.now();

  const planoVenceEm = new Date(
    baseVence + (isAnual ? 365 : 30) * 86400000
  ).toISOString();

  // Atualiza pagamento → pago
  await supabaseAdmin
    .from("pagamentos")
    .update({ status: "pago", pago_em: new Date().toISOString() })
    .eq("id", pagamento.id);

  // Ativa plano do tenant
  await supabaseAdmin
    .from("config_garage")
    .update({
      plano_ativo: true,
      plano_vence_em: planoVenceEm,
      // Grava o plano pago (upgrade Starter -> Pro passa a valer). "teste" (R$1) não troca o plano.
      ...(pagamento.plano === "essencial" || PLANOS_VISIVEIS.some((p) => p.id === pagamento.plano) ? { plano: pagamento.plano } : {}),
    })
    .eq("user_id", pagamento.user_id);

  // Baixa a mensalidade automática (cron cobranca-vencimento) pendente do ciclo —
  // senão ela fica "pendente" pra sempre ao lado do pagamento do gateway.
  await supabaseAdmin
    .from("pagamentos")
    .update({ status: "pago", pago_em: new Date().toISOString(), notas: `auto:mensalidade (quitada via ${gatewayLabel} ${orderId})` })
    .eq("user_id", pagamento.user_id)
    .eq("status", "pendente")
    .like("notas", "auto:mensalidade%");

  // Timeline do tenant: pagamento confirmado no gateway
  await logEventoAdmin(
    pagamento.user_id,
    "pagamento_confirmado",
    `Pagamento confirmado no ${gatewayLabel} — ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(pagamento.valor ?? 0)} (${(pagamento.plano ?? "?")}${isAnual ? " anual" : ""})`,
    { order_id: orderId, valor: pagamento.valor, plano: pagamento.plano, metodo: pagamento.metodo, plano_vence_em: planoVenceEm }
  );

  // ── Indicação ──────────────────────────────────────────────────────────────
  // 1) gera 5% de crédito pro indicador deste pagador
  await gerarCreditoIndicacao({
    pagamentoId: pagamento.id,
    pagadorUserId: pagamento.user_id,
    valorPago: Number(pagamento.valor) || 0,
  }).catch(e => console.warn("[webhook] gerarCreditoIndicacao:", e));
  // 2) consome os créditos que abateram ESTA fatura (se teve desconto)
  await consumirCreditoIndicacao({
    pagamentoId: pagamento.id,
    beneficiarioUserId: pagamento.user_id,
    desconto: Number(pagamento.desconto_indicacao) || 0,
  }).catch(e => console.warn("[webhook] consumirCreditoIndicacao:", e));

  // Notifica admin por e-mail
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    const { data: garage } = await supabaseAdmin
      .from("config_garage")
      .select("nome_empresa")
      .eq("user_id", pagamento.user_id)
      .maybeSingle();
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(pagamento.user_id);

    const nomePlano  = (pagamento.plano ?? "pro").toUpperCase();
    const periodo    = isAnual ? "Anual" : "Mensal";
    const nomeCliente = garage?.nome_empresa ?? authUser?.user?.email ?? pagamento.user_id;
    const emailCliente = authUser?.user?.email ?? "—";
    const valorBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
      .format(pagamento.valor ?? 0);

    await resend.emails.send({
      from: process.env.RESEND_FROM ?? "AutoZap <autozap@autozap.digital>",
      to: adminEmail,
      subject: `💰 Pagamento recebido — ${nomeCliente} (${nomePlano} ${periodo})`,
      html: `
<!DOCTYPE html><html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#efefed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#efefed;padding:40px 20px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:20px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="background:#111827;padding:24px 32px;">
          <h1 style="margin:0;font-size:22px;font-weight:900;font-style:italic;color:#fff;">AUTO<span style="color:#dc2626;">ZAP</span></h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:20px 24px;margin-bottom:24px;">
            <p style="margin:0 0 4px;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:3px;color:#166534;">Pagamento Confirmado</p>
            <p style="margin:0;font-size:28px;font-weight:900;color:#15803d;">${valorBRL}</p>
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
            ${[
              ["Cliente",  nomeCliente],
              ["E-mail",   emailCliente],
              ["Plano",    `${nomePlano} — ${periodo}`],
              ["Método",   (pagamento.metodo ?? "—").toUpperCase()],
              ["Válido até", new Date(planoVenceEm).toLocaleDateString("pt-BR")],
              ["Order ID", orderId],
            ].map(([k, v]) => `
            <tr>
              <td style="padding:6px 0;color:#6b7280;font-weight:700;width:120px;">${k}</td>
              <td style="padding:6px 0;color:#111827;font-weight:600;">${v}</td>
            </tr>`).join("")}
          </table>
          <div style="margin-top:24px;text-align:center;">
            <a href="${process.env.NEXT_PUBLIC_SITE_URL ?? "https://autozap.digital"}/admin" style="display:inline-block;background:#111827;color:#fff;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:3px;padding:12px 28px;border-radius:12px;text-decoration:none;">
              Ver no Admin
            </a>
          </div>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #f3f4f6;text-align:center;">
          <p style="margin:0;font-size:10px;color:#9ca3af;font-weight:700;text-transform:uppercase;letter-spacing:2px;">AutoZap · autozap.digital</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
    }).catch(e => console.warn("[webhook] falha ao enviar e-mail:", e));
  }

}
