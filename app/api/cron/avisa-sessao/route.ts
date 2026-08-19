// app/api/cron/avisa-sessao/route.ts
//
// Monitor de sessão da Avisa. Roda a cada 20min (7h–21h BRT) e checa
// GET /instance/status de cada tenant com Avisa configurada. Sessão caída =
// agente MUDO (não recebe nem envia) e nada aparece em erros_webhook, porque
// nada chega — o modo de falha mais silencioso que existe no produto. Até aqui
// só era descoberto por acaso (APROVE ficou fora e ninguém viu).
//
// O fix da queda é humano: rescan do QR no celular da loja (WhatsApp Business →
// Aparelhos conectados). Por isso o cron só ALERTA, não tenta reconectar.
//
// Escopo: só tenants com assinatura ativa (assinaturaAtiva) — cliente que parou
// de pagar com sessão caída não é incêndio, e alertar sobre ele viraria ruído
// diário (o Marcos Repasse, expirado, está caído desde que venceu).
//
// Anti-spam: Redis marca o tenant como caído; realerta só a cada 6h (12h quando
// é token inválido, que é problema de configuração, não queda). Quando a sessão
// volta, manda um "voltou" e limpa a marca.
//
// Anti-falso-positivo: a Avisa às vezes responde HTTP 200 com "No session" para
// uma sessão viva (Carmatti, 19/08 12:40 BRT — cliente conversando no mesmo
// minuto do alerta). Por isso queda só vira alerta depois de DUAS leituras:
// re-check imediato dentro do mesmo tick e confirmação no tick seguinte.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAvisaInstanceStatus } from "@/lib/avisa";
import { alertaInterno } from "@/lib/alerta-interno";
import {
  avisaSessaoRegistrarQueda,
  avisaSessaoRegistrarVolta,
  avisaSessaoConfirmarSuspeita,
  avisaSessaoLimparSuspeita,
} from "@/lib/redis";
import { assinaturaAtiva } from "@/lib/assinatura";

export const maxDuration = 120;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Alerta vai pro WhatsApp do Lucas pela instância da AutoZap — nunca pela
// instância do tenant, que é justamente a que está fora do ar. Se essa
// instância também estiver fora (foi o que aconteceu), cai pra e-mail.
//
// A versão antiga retornava `true` mesmo quando a Avisa recusava: só tratava
// exceção, e token inválido responde HTTP 400 sem lançar. Este cron achava que
// tinha avisado das 21h de agente mudo do Carmatti.
async function alertar(corpo: string): Promise<boolean> {
  const { entregue } = await alertaInterno("avisa-sessao", "Sessão de WhatsApp caiu", corpo);
  return entregue;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: rows, error } = await supabaseAdmin
    .from("config_garage")
    .select("user_id, nome_empresa, avisa_base_url, avisa_token, plano_ativo, plano_vence_em, trial_ends_at, bloqueado")
    .not("avisa_token", "is", null)
    .not("avisa_base_url", "is", null);

  if (error) {
    console.error("❌ [avisa-sessao] erro ao listar tenants:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const resultado: { tenant: string; estado: string; detalhe: string; alertado: boolean }[] = [];
  const pulados: string[] = [];

  for (const t of rows ?? []) {
    const nome = t.nome_empresa || t.user_id.slice(0, 8);

    if (!assinaturaAtiva(t)) {
      pulados.push(nome);
      continue;
    }

    const creds = { baseUrl: t.avisa_base_url as string, token: t.avisa_token as string };
    let status = await getAvisaInstanceStatus(creds);

    // Re-check imediato: um "No session" isolado costuma ser hiccup da Avisa.
    if (status.estado === "sem_sessao") {
      await new Promise((r) => setTimeout(r, 4000));
      const segunda = await getAvisaInstanceStatus(creds);
      if (segunda.estado !== "sem_sessao") {
        console.log(`↩️ [avisa-sessao] ${nome}: "${status.detalhe}" não se repetiu (${segunda.estado}) — hiccup`);
        status = segunda;
      }
    }

    // "indisponivel" (rede/5xx da Avisa) NÃO alerta: é hiccup passageiro e o
    // próximo tick confirma. Só sessão caída e token morto viram alerta.
    if (status.estado === "conectado" || status.estado === "indisponivel") {
      let alertado = false;
      if (status.estado === "conectado") {
        await avisaSessaoLimparSuspeita(t.user_id);
      }
      if (status.estado === "conectado" && (await avisaSessaoRegistrarVolta(t.user_id))) {
        alertado = await alertar(
          `✅ *WhatsApp reconectado*\n\n` +
            `Loja: *${nome}*\n` +
            `Número: ${status.jid?.split(":")[0]?.split("@")[0] ?? "—"}\n\n` +
            `A sessão da Avisa voltou. O agente está recebendo e respondendo de novo.`
        );
      }
      resultado.push({ tenant: nome, estado: status.estado, detalhe: status.detalhe, alertado });
      continue;
    }

    // Token inválido é determinístico (a Avisa nega o token, não a sessão) e
    // alerta de primeira. Queda de sessão espera o tick seguinte confirmar.
    if (status.estado === "sem_sessao" && !(await avisaSessaoConfirmarSuspeita(t.user_id))) {
      console.warn(`⏳ [avisa-sessao] ${nome}: possível queda (${status.detalhe}) — aguardando confirmação no próximo tick`);
      resultado.push({ tenant: nome, estado: "suspeita", detalhe: status.detalhe, alertado: false });
      continue;
    }

    const ttl = status.estado === "token_invalido" ? 12 * 3600 : 6 * 3600;
    const devoAlertar = await avisaSessaoRegistrarQueda(t.user_id, ttl);

    let alertado = false;
    if (devoAlertar) {
      const corpo =
        status.estado === "token_invalido"
          ? `🔑 *Token da Avisa inválido*\n\n` +
            `Loja: *${nome}*\n` +
            `Resposta da Avisa: ${status.detalhe}\n\n` +
            `A conta da instância está inativa ou o token mudou. O agente está MUDO. ` +
            `Corrija o token em Configurações → WhatsApp.`
          : `🚨 *WhatsApp DESCONECTADO*\n\n` +
            `Loja: *${nome}*\n` +
            `Status da Avisa: ${status.detalhe}\n\n` +
            `O agente não recebe nem responde nada agora. ` +
            `Fix: gerar o QR novo na Avisa (GET /instance/qr) e pedir pra loja escanear ` +
            `no celular — WhatsApp Business → Aparelhos conectados.`;
      alertado = await alertar(corpo);
    }

    console.warn(`🚨 [avisa-sessao] ${nome}: ${status.estado} (${status.detalhe}) — alertado=${alertado}`);
    resultado.push({ tenant: nome, estado: status.estado, detalhe: status.detalhe, alertado });
  }

  return NextResponse.json({ ok: true, checados: resultado.length, pulados, resultado });
}
