// lib/canal-tenant.ts
// Envio pelo canal do tenant (Avisa OU Cloud API) fora do pipeline do agente:
// crons, polling da simulação, perguntas da Júlia ao gerente. Mesmas regras do
// process-whatsapp — entrada e saída no MESMO canal, Cloud API só manda texto
// livre dentro da janela de 24h, e nunca manda pro próprio número do agente.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage } from "@/lib/avisa";
import { sendMetaMessage, sendMetaAlertaTemplate, dentroJanela24h } from "@/lib/meta";
import { gerenteNaJanela, enfileirarAlertaGerente } from "@/lib/redis";

const soDigitos = (s: string) => String(s ?? "").replace(/\D/g, "");
export const normWa = (n: string | null | undefined) => (n ? soDigitos(n).replace(/^(?!55)/, "55") : null);

export type Canal = {
  cfg: any;
  useAvisa: boolean;
  avisa: { baseUrl: string; token: string };
  meta: { phoneNumberId: string; accessToken: string };
  loja: string;
  /** Destino dos assuntos de financiamento (whatsapp_financeiro, senão o gerente). */
  gerente: string | null;
  /** WhatsApp do gerente (config_garage.whatsapp). */
  gerentePrincipal: string | null;
  /** Número do próprio agente — mandar pra ele é auto-envio (descartado). */
  agente: string | null;
};

export async function carregarCanal(tenant: string): Promise<Canal | null> {
  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("nome_empresa, nome_fantasia, whatsapp, whatsapp_financeiro, whatsapp_agente, avisa_base_url, avisa_token, meta_phone_id, meta_access_token")
    .eq("user_id", tenant)
    .order("created_at", { ascending: false })
    .limit(1);
  const cfg = data?.[0];
  if (!cfg) return null;
  return {
    cfg,
    useAvisa: !!(cfg.avisa_base_url && cfg.avisa_token),
    avisa: { baseUrl: cfg.avisa_base_url ?? "", token: cfg.avisa_token ?? "" },
    meta: { phoneNumberId: cfg.meta_phone_id ?? "", accessToken: cfg.meta_access_token || process.env.META_ACCESS_TOKEN || "" },
    loja: cfg.nome_fantasia || cfg.nome_empresa || "loja",
    gerente: normWa(cfg.whatsapp_financeiro) || normWa(cfg.whatsapp),
    gerentePrincipal: normWa(cfg.whatsapp),
    agente: normWa(cfg.whatsapp_agente),
  };
}

export function ehAutoEnvio(c: Canal, to: string): boolean {
  return !!c.agente && normWa(to) === c.agente;
}

/** Texto livre pro cliente. Cloud API fora da janela de 24h → false (não manda). */
export async function enviarCliente(c: Canal, leadId: string, waId: string, texto: string): Promise<boolean> {
  if (c.useAvisa) return sendAvisaMessage(waId, texto, c.avisa);
  if (!(await dentroJanela24h(leadId))) return false;
  const r = await sendMetaMessage(waId, texto, c.meta).catch(() => null);
  return r != null;
}

/** Alerta pro gerente: Avisa direto; Cloud API na janela → texto, fora → template, senão fila. */
export async function enviarGerente(c: Canal, tenant: string, texto: string, clientePhone: string, destino?: string | null) {
  const to = destino ?? c.gerente;
  if (!to || ehAutoEnvio(c, to)) return;
  if (c.useAvisa) { await sendAvisaMessage(to, texto, c.avisa, { typing: false }); return; }
  let ok = false;
  if (await gerenteNaJanela(tenant)) ok = !!(await sendMetaMessage(to, texto, c.meta).catch(() => null));
  if (!ok) ok = await sendMetaAlertaTemplate(to, c.loja, texto, clientePhone, c.meta);
  if (!ok) await enfileirarAlertaGerente(tenant, texto, clientePhone);
}
