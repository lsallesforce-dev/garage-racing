// lib/alerta-interno.ts
// Alerta interno do Lucas — o canal que avisa que ALGUMA COISA quebrou.
//
// Por que existe: cada cron tinha sua própria cópia de `alertar()`, todas
// dependendo da MESMA instância Avisa (AUTOZAP_AVISA_*). Quando o token dela
// ficou inválido, todo alerta passou a morrer com HTTP 400 e um console.warn
// que ninguém lê — foi assim que 21h de agente mudo do Carmatti passaram em
// branco. Pior: `alertar()` retornava `true` mesmo na falha, porque só tratava
// exceção, e token inválido responde 400 sem lançar. O sistema achava que
// tinha avisado.
//
// Três mudanças:
//   1. o retorno do envio é RESPEITADO (sendAvisaMessage devolve boolean)
//   2. falhando o WhatsApp, cai pra E-MAIL (Resend, já usado nos e-mails de
//      cadastro) — canal independente do Avisa, que é o ponto único de falha
//   3. toda tentativa fica gravada em `alertas_internos`, então "os alertas
//      estão mudos" vira uma linha no banco em vez de silêncio

import { Resend } from "resend";
import { sendAvisaMessage } from "@/lib/avisa";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type CanalAlerta = "whatsapp" | "email";

export type ResultadoAlerta = {
  /** Chegou por pelo menos um canal. */
  entregue: boolean;
  canais: CanalAlerta[];
  erros: string[];
};

/** E-mail de destino do alerta interno. */
function emailDestino(): string | null {
  return (
    process.env.AUTOZAP_ALERT_EMAIL?.trim() ||
    process.env.RESEND_TO?.trim() ||
    process.env.ADMIN_EMAIL?.trim() ||
    // Sem nenhuma env o alerta morria calado ("AUTOZAP_ALERT_EMAIL ausente",
    // 25/09 a 02/10). Caixa do operador como último recurso.
    "autozap@autozap.digital"
  );
}

type CredsAvisa = { baseUrl: string; token: string };

async function porWhatsApp(corpo: string, erros: string[], override?: CredsAvisa | null): Promise<boolean> {
  const alvo = process.env.AUTOZAP_ALERT_WHATSAPP;
  // A cobrança resolve o remetente pelo banco antes de cair no env — mantido
  // como override pra não perder esse caminho ao centralizar.
  const baseUrl = override?.baseUrl ?? process.env.AUTOZAP_AVISA_BASE_URL;
  const token = override?.token ?? process.env.AUTOZAP_AVISA_TOKEN;

  if (!alvo || !baseUrl || !token) {
    erros.push("whatsapp: AUTOZAP_ALERT_WHATSAPP/AUTOZAP_AVISA_* ausentes");
    return false;
  }

  try {
    const ref: { message?: string } = {};
    // sendAvisaMessage devolve false em 463/400/sem-resposta. O código antigo
    // ignorava esse retorno — é literalmente onde a surdez morava.
    const ok = await sendAvisaMessage(alvo, corpo, { baseUrl, token }, { typing: false }, ref);
    if (!ok) erros.push(`whatsapp: ${ref.message ?? "Avisa não confirmou o envio"}`);
    return ok;
  } catch (err: any) {
    erros.push(`whatsapp: ${err?.message?.slice(0, 160) ?? "erro desconhecido"}`);
    return false;
  }
}

async function porEmail(assunto: string, corpo: string, erros: string[], comoReserva = true): Promise<boolean> {
  const para = emailDestino();
  const apiKey = process.env.RESEND_API_KEY;

  if (!para)   { erros.push("email: AUTOZAP_ALERT_EMAIL ausente"); return false; }
  if (!apiKey) { erros.push("email: RESEND_API_KEY ausente");      return false; }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM ?? "AutoZap <autozap@autozap.digital>",
      to: para,
      subject: `[AutoZap] ${assunto}`,
      text: comoReserva
        ? `${corpo}\n\n—\nEste alerta chegou por e-mail porque o WhatsApp interno falhou.`
        : corpo,
    });
    if (error) { erros.push(`email: ${String((error as any).message ?? error).slice(0, 160)}`); return false; }
    return true;
  } catch (err: any) {
    erros.push(`email: ${err?.message?.slice(0, 160) ?? "erro desconhecido"}`);
    return false;
  }
}

/**
 * Manda um alerta interno e devolve por onde ele saiu.
 *
 * @param origem  qual cron/rota disparou — vai pro histórico (ex.: "avisa-sessao")
 * @param assunto linha curta, vira o subject do e-mail
 * @param corpo   texto completo (o mesmo que ia pro WhatsApp)
 */
export async function alertaInterno(
  origem: string,
  assunto: string,
  corpo: string,
  opts?: { credsWhatsApp?: CredsAvisa | null; tambemEmail?: boolean },
): Promise<ResultadoAlerta> {
  const erros: string[] = [];
  const canais: CanalAlerta[] = [];

  if (await porWhatsApp(corpo, erros, opts?.credsWhatsApp)) canais.push("whatsapp");

  // E-mail só como rede — não duplicar alerta quando o WhatsApp funcionou.
  // `tambemEmail` é pra aviso que o Lucas quer nos dois canais (cadastro novo).
  const whatsFalhou = canais.length === 0;
  if ((whatsFalhou || opts?.tambemEmail) && await porEmail(assunto, corpo, erros, whatsFalhou)) {
    canais.push("email");
  }

  const entregue = canais.length > 0;

  if (!entregue) {
    console.error(`🔇 [alerta-interno/${origem}] NENHUM canal entregou: ${erros.join(" | ")}`);
  } else if (erros.length) {
    console.warn(`⚠️ [alerta-interno/${origem}] entregue por ${canais.join(",")} após falha: ${erros.join(" | ")}`);
  }

  // Histórico: é o que permite responder "desde quando o alerta está mudo?"
  // sem depender de log da Vercel, que expira. Falhar aqui não pode derrubar o
  // cron — o alerta em si já foi (ou não) entregue.
  try {
    await supabaseAdmin.from("alertas_internos").insert({
      origem,
      assunto,
      corpo: corpo.slice(0, 4000),
      entregue,
      canais,
      erro: erros.length ? erros.join(" | ").slice(0, 1000) : null,
    });
  } catch (err: any) {
    console.warn(`⚠️ [alerta-interno/${origem}] não gravou histórico (migration 049 aplicada?): ${err?.message?.slice(0, 120)}`);
  }

  return { entregue, canais, erros };
}

/**
 * Aviso de cadastro novo, nos dois canais. Sem isso a conta ficava parada
 * esperando liberação sem ninguém saber (Conquista Veículos: 18 dias).
 */
export function alertaCadastroNovo(dados: {
  empresa?: string | null;
  responsavel?: string | null;
  email: string;
  whatsapp?: string | null;
  endereco?: string | null;
  origem: string;
  /** Padrão "Novo cadastro no AutoZap". */
  titulo?: string;
}): Promise<ResultadoAlerta> {
  const titulo = dados.titulo ?? "Novo cadastro no AutoZap";
  const contato = linkWhatsApp(dados.whatsapp);
  const linhas = [
    `🆕 *${titulo}*`,
    "",
    dados.empresa ? `Loja: ${dados.empresa}` : null,
    dados.responsavel ? `Nome: ${dados.responsavel}` : null,
    `E-mail: ${dados.email}`,
    dados.endereco ? `Endereço: ${dados.endereco}` : null,
    `Origem: ${dados.origem}`,
    contato ? "" : null,
    // Link cru: o WhatsApp e o cliente de e-mail tornam clicável sozinhos.
    contato ? `Clique para conversar com ${contato.exibicao}: ${contato.url}` : null,
    "",
    "Liberar em autozap.digital/admin",
  ].filter((l) => l !== null);
  return alertaInterno(
    "cadastro-novo",
    `${titulo}: ${dados.empresa || dados.responsavel || dados.email}`,
    linhas.join("\n"),
    { tambemEmail: true },
  );
}

/** "5531998730611" ou "(31) 99873-0611" → link wa.me + "31 99873-0611". */
function linkWhatsApp(numero?: string | null): { url: string; exibicao: string } | null {
  const digitos = String(numero ?? "").replace(/\D/g, "");
  if (digitos.length < 10 || digitos.length > 13) return null;
  const local = digitos.length >= 12 && digitos.startsWith("55") ? digitos.slice(2) : digitos;
  const ddd = local.slice(0, 2);
  const resto = local.slice(2);
  const exibicao = `${ddd} ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
  return { url: `https://wa.me/55${local}`, exibicao };
}

/**
 * Rede de segurança dos alertas ao gerente no canal Meta, quando nem o texto
 * livre (fora da janela de 24h) nem o template entregaram. Vai pro MESMO
 * destino dos alertas internos (AUTOZAP_ALERT_EMAIL / RESEND_TO — o operador
 * do AutoZap), com o nome da loja no assunto. Antes ia pro e-mail de login do
 * tenant, e o da APROVE (aprove@aprove.com.br) não existe: o alerta sumia.
 */
export async function alertaTenantPorEmail(
  tenantUserId: string,
  assunto: string,
  corpo: string,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const para = emailDestino();
  if (!apiKey || !para) {
    console.warn(`⚠️ [alerta-tenant] ${!apiKey ? "RESEND_API_KEY" : "AUTOZAP_ALERT_EMAIL/RESEND_TO"} ausente — alerta de ${tenantUserId} perdido`);
    return false;
  }
  try {
    const { data: cfg } = await supabaseAdmin
      .from("config_garage")
      .select("nome_fantasia, nome_empresa")
      .eq("user_id", tenantUserId)
      .order("created_at", { ascending: false })
      .limit(1);
    const loja = cfg?.[0]?.nome_fantasia || cfg?.[0]?.nome_empresa || tenantUserId;
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM ?? "AutoZap <autozap@autozap.digital>",
      to: para,
      subject: `[AutoZap · ${loja}] ${assunto}`,
      text: `${corpo}

—
Alerta pro gerente da ${loja} que NÃO chegou no WhatsApp dele (fora da janela de 24h e o template da Meta não entregou). Repasse pro gerente.`,
    });
    if (error) {
      console.warn(`⚠️ [alerta-tenant] Resend falhou: ${String((error as any).message ?? error).slice(0, 160)}`);
      return false;
    }
    console.log(`📧 [alerta-tenant] alerta de ${loja} enviado por e-mail pro operador`);
    return true;
  } catch (err: any) {
    console.warn(`⚠️ [alerta-tenant] ${err?.message?.slice(0, 160)}`);
    return false;
  }
}
