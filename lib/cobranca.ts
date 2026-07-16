// lib/cobranca.ts
// Lógica compartilhada da cobrança automática v2 — usada pelo cron
// (app/api/cron/cobranca-vencimento) e pelo envio manual do admin
// (app/api/admin/enviar-cobranca).
//
// Remetente AutoZap-first: a mensagem de cobrança sai pela Avisa do tenant AutoZap
// (a própria empresa), com fallback pro chip do próprio tenant cobrado — assim a
// cobrança chega mesmo pra tenant Meta-only, e não "gasta" o chip do cliente.
// Link tokenizado: /assinar?t=<cobranca_token>&renovacao=1 resolve o tenant sem
// login e aplica o desconto negociado server-side (migration 029).

import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage } from "@/lib/avisa";
import { calcularDescontoIndicacao } from "@/lib/indicacao";
import { logEventoAdmin } from "@/lib/admin-eventos";

export const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.autozap.digital";

// Preço mensal por plano (R$) — espelha VALORES de lib/pagarme (em reais, p/ exibição).
export const PRECO_MENSAL: Record<string, number> = { starter: 1150, pro: 1500, premium: 2135 };

export const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Tenant AutoZap (a própria empresa) — remetente padrão das cobranças.
const AUTOZAP_SENDER_ID = () =>
  process.env.AUTOZAP_COBRANCA_SENDER_ID ?? "9e80d6e1-7ad9-4578-a848-1dd61fc36c9a";

// Campos de config_garage que a cobrança precisa (select do cron e do envio manual).
export interface TenantCobranca {
  user_id: string;
  nome_empresa: string | null;
  nome_fantasia: string | null;
  plano: string | null;
  plano_vence_em: string | null;
  whatsapp: string | null;
  whatsapp_financeiro: string | null;
  avisa_base_url: string | null;
  avisa_token: string | null;
  plano_desconto: number | null;
  cobranca_token: string | null;
}

// ── Datas (BRT, sem libs de timezone) ─────────────────────────────────────────

// Diferença em DIAS DE CALENDÁRIO no fuso de Brasília (-03), sem libs de timezone.
// Evita o off-by-one de comparar instantes de 24h quando o vencimento é "fim do dia".
export function diasAteBrt(venceISO: string): number {
  const OFFSET = 3 * 3_600_000; // BRT = UTC-3
  const soData = (ms: number) => {
    const d = new Date(ms - OFFSET);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  return Math.round((soData(new Date(venceISO).getTime()) - soData(Date.now())) / 86_400_000);
}

// Data (YYYY-MM-DD) do vencimento no fuso de Brasília — usada como chave da conta a receber.
export function ymdBrt(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 3_600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Mapeia dias-até-vencer → marco da régua (2, 0, -1). null = ainda fora da janela.
// v2: régua enxuta — "vence em X dias" (≤2), "vence hoje" (0) e "vencido" (-1).
export function marcoDe(dias: number): number | null {
  if (dias < 0) return -1;  // vencido
  if (dias === 0) return 0; // vence hoje
  if (dias <= 2) return 2;  // vence em 1-2 dias
  return null;              // ainda longe
}

// ── Valor real da cobrança ────────────────────────────────────────────────────

// Valor mensal REAL do tenant: preço de tabela − desconto negociado − créditos de
// indicação, com piso de R$1 (mínimo do gateway) — mesmo cálculo do checkout.
export async function calcularValorCobranca(
  userId: string,
  plano: string | null,
  planoDesconto: number | null | undefined,
): Promise<{ preco: number; descontoNegociado: number; descontoIndicacao: number; valor: number }> {
  const preco = PRECO_MENSAL[plano ?? ""] ?? PRECO_MENSAL.starter;
  const descontoNegociado = Math.max(0, Number(planoDesconto) || 0);
  const baseNeg = Math.max(1, preco - descontoNegociado);
  // Créditos de indicação abatem o líquido do desconto negociado, respeitando o piso.
  let descontoIndicacao = await calcularDescontoIndicacao(userId, baseNeg);
  descontoIndicacao = Math.min(descontoIndicacao, Math.max(0, baseNeg - 1));
  descontoIndicacao = Math.round(descontoIndicacao * 100) / 100;
  const valor = Math.round((baseNeg - descontoIndicacao) * 100) / 100;
  return { preco, descontoNegociado, descontoIndicacao, valor };
}

// ── Remetente ─────────────────────────────────────────────────────────────────

// Credenciais Avisa do tenant AutoZap (remetente padrão das cobranças).
// null = sem credenciais → o caller usa o fallback (chip do próprio tenant).
export async function resolverRemetente(): Promise<{ baseUrl: string; token: string } | null> {
  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("avisa_base_url, avisa_token")
    .eq("user_id", AUTOZAP_SENDER_ID())
    .order("created_at", { ascending: false })
    .limit(1);
  const row = data?.[0];
  if (!row?.avisa_base_url || !row?.avisa_token) return null;
  return { baseUrl: row.avisa_base_url, token: row.avisa_token };
}

// ── Mensagem ──────────────────────────────────────────────────────────────────

export function montarMensagemCobranca(params: {
  nome: string;
  plano: string;
  dias: number;
  venceISO: string;
  valor: number; // R$ já líquido (desconto negociado + indicação, piso R$1)
  link: string;  // link tokenizado /assinar?t=...&renovacao=1
}): string {
  const { nome, plano, dias, venceISO, valor, link } = params;
  const planoNome = plano.charAt(0).toUpperCase() + plano.slice(1);
  const dataBR = new Date(venceISO).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

  // Marco -1: vencido — tom de regularização
  if (dias < 0) {
    return (
      `💳 *AutoZap — Assinatura vencida*\n\n` +
      `Olá! A assinatura *${planoNome}* da ${nome} *venceu* em ${dataBR}.\n\n` +
      `Pra evitar a suspensão do atendimento automático, regularize por aqui 👇\n` +
      `${link}\n\n` +
      `Valor da renovação: *${fmtBRL(valor)}/mês*.\n` +
      `Se o pagamento já foi feito, desconsidere esta mensagem. 🚗`
    );
  }

  // Marco 0: vence hoje — ênfase no link de pagamento
  if (dias === 0) {
    return (
      `💳 *AutoZap — Sua assinatura vence HOJE*\n\n` +
      `Olá! A assinatura *${planoNome}* da ${nome} vence *hoje* (${dataBR}).\n\n` +
      `⚡ Renove agora em 1 minuto — é só abrir o link e pagar:\n` +
      `👉 ${link}\n\n` +
      `Valor da renovação: *${fmtBRL(valor)}/mês*.\n` +
      `Renovando hoje, o atendimento automático segue no ar sem interrupção. 🚗`
    );
  }

  // Marco 2: vence em 1-2 dias
  const quando = dias === 1 ? `vence *amanhã* (${dataBR})` : `vence em *${dias} dias* (${dataBR})`;
  return (
    `💳 *AutoZap — Renovação de assinatura*\n\n` +
    `Olá! A assinatura *${planoNome}* da ${nome} ${quando}.\n\n` +
    `Pra manter o atendimento automático no ar, é só renovar aqui 👇\n` +
    `${link}\n\n` +
    `Valor da renovação: *${fmtBRL(valor)}/mês*.\n` +
    `Qualquer dúvida, é só chamar. 🚗`
  );
}

// ── Envio ─────────────────────────────────────────────────────────────────────

export type MotivoFalhaCobranca = "sem_destino" | "sem_canal" | "sem_vencimento" | "falha_envio";

/**
 * Envia a mensagem de cobrança pro financeiro do tenant.
 * - Remetente AutoZap-first (resolverRemetente), fallback = chip do próprio tenant.
 * - Destino = whatsapp_financeiro || whatsapp.
 * - Loga evento (default `aviso_cobranca`; o envio manual passa `cobranca_manual`).
 * NÃO mexe em cobranca_ultimo_marco — isso é responsabilidade do cron.
 */
export async function enviarCobranca(
  t: TenantCobranca,
  dias: number,
  opts?: { tipoEvento?: string },
): Promise<{ ok: boolean; destino: string | null; motivo?: MotivoFalhaCobranca }> {
  if (!t.plano_vence_em) return { ok: false, destino: null, motivo: "sem_vencimento" };

  const destino = t.whatsapp_financeiro || t.whatsapp;
  if (!destino) return { ok: false, destino: null, motivo: "sem_destino" };

  const remetenteAutoZap = await resolverRemetente();
  const credsTenant =
    t.avisa_base_url && t.avisa_token
      ? { baseUrl: t.avisa_base_url, token: t.avisa_token }
      : null;
  const creds = remetenteAutoZap ?? credsTenant;
  if (!creds) return { ok: false, destino, motivo: "sem_canal" };

  const { valor } = await calcularValorCobranca(t.user_id, t.plano, t.plano_desconto);
  // Link tokenizado (capability) — fallback pro link antigo se o token não veio no select.
  const link = t.cobranca_token
    ? `${SITE}/assinar?t=${t.cobranca_token}&renovacao=1`
    : `${SITE}/assinar?plano=${t.plano ?? "starter"}&renovacao=1`;
  const nome = t.nome_fantasia || t.nome_empresa || "sua revenda";
  const corpo = montarMensagemCobranca({
    nome,
    plano: t.plano ?? "starter",
    dias,
    venceISO: t.plano_vence_em,
    valor,
    link,
  });

  const enviou = await sendAvisaMessage(destino, corpo, creds, { typing: false });

  if (enviou) {
    const tipoEvento = opts?.tipoEvento ?? "aviso_cobranca";
    const quando =
      dias < 0 ? `${-dias} dia(s) em atraso` : dias === 0 ? "vence hoje" : `vence em ${dias} dia(s)`;
    const descricao =
      tipoEvento === "cobranca_manual"
        ? `Cobrança manual enviada (${quando})`
        : `Aviso de cobrança enviado (${quando})`;
    await logEventoAdmin(t.user_id, tipoEvento, descricao, {
      dias,
      destino,
      valor,
      remetente: remetenteAutoZap ? "autozap" : "tenant",
    });
  }

  return enviou ? { ok: true, destino } : { ok: false, destino, motivo: "falha_envio" };
}
