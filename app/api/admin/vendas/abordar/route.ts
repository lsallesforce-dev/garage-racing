// app/api/admin/vendas/abordar/route.ts
// =============================================================================
// AutoZap — Envio MANUAL da abertura de prospecção (botão da lista, aba Vendas)
// =============================================================================
// Faz o que o cron faz num contato só, quando o Lucas clica: monta a abertura do
// dia, manda pela instância Avisa da AutoZap, grava as bolhas no histórico e
// marca o prospect como abordado.
//
// Existe por causa da lista RESERVADA. São 400 contatos congelados que ele não
// quer soltar na fila automática enquanto a abordagem não provar conversão —
// mas quer poder escolher um e abordar na mão. Sem esta rota, usar um contato
// reservado exigia mudar o status dele pra 'novo' e esperar o cron, o que solta
// ele na campanha inteira.
//
// O que esta rota IGNORA de propósito (é ação manual, não campanha):
//   janela de horário, dias da semana, cota diária, intervalo entre envios.
// O que ela RESPEITA: opt_out, ter telefone, e não abordar duas vezes.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";
import { sendAvisaMessage } from "@/lib/avisa";
import { montarAbertura } from "@/lib/prospeccao-abertura";
import { bolhasParaLinhas } from "@/lib/prospeccao-historico";
import { bumpStats } from "@/lib/prospeccao-stats";
import type { Prospect } from "@/lib/prospeccao-types";

// Mesma pausa do cron entre as bolhas da abertura. Fixa de propósito: rege o
// ritmo DENTRO de uma abertura, não o intervalo entre prospects.
const PAUSA_ENTRE_BOLHAS_MS = 5000;

// 3 bolhas × 5s + latência da Avisa cabe folgado; o default da plataforma não.
export const maxDuration = 60;

function credenciais(): { baseUrl: string; token: string } | null {
  const baseUrl = process.env.AUTOZAP_AVISA_BASE_URL;
  const token = process.env.AUTOZAP_AVISA_TOKEN;
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

// Espelha normalizePhone do webhook: o wa_id é a chave que liga a resposta dele
// de volta ao prospect. Sem gravar isso, a resposta chega e não acha ninguém.
function normalizarWaId(phone: string | null): string | null {
  if (!phone) return null;
  let cleaned = phone.split(":")[0].replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = cleaned.slice(1);
  if (cleaned.length === 10 || cleaned.length === 11) cleaned = "55" + cleaned;
  return cleaned.length >= 8 ? cleaned : null;
}

// POST { prospect_id } (header x-admin-secret) → { ok, bolhas, status }
export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  let body: { prospect_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const prospectId = body.prospect_id?.trim();
  if (!prospectId) {
    return NextResponse.json({ error: "prospect_id é obrigatório" }, { status: 400 });
  }

  const { data } = await supabaseAdmin
    .from("prospects")
    .select("*")
    .eq("id", prospectId)
    .maybeSingle();

  const prospect = data as Prospect | null;
  if (!prospect) {
    return NextResponse.json({ error: "Prospect não encontrado" }, { status: 404 });
  }

  if (prospect.opt_out) {
    return NextResponse.json({ error: "Esse contato pediu para não ser mais abordado." }, { status: 409 });
  }

  const alvoTel = prospect.wa_id || prospect.telefone;
  if (!alvoTel) {
    return NextResponse.json({ error: "Esse contato não tem telefone." }, { status: 409 });
  }

  // Trava anti-duplicata: se já existe QUALQUER mensagem, ele já foi abordado.
  // Olha o histórico e não o status porque status muda por vários caminhos
  // (rodada nova, sem_resposta) e o histórico é o fato.
  const { count: jaFalamos } = await supabaseAdmin
    .from("prospect_mensagens")
    .select("*", { count: "exact", head: true })
    .eq("prospect_id", prospectId);

  if ((jaFalamos ?? 0) > 0) {
    return NextResponse.json(
      { error: "Esse contato já foi abordado — abra a conversa no Inbox." },
      { status: 409 },
    );
  }

  const creds = credenciais();
  if (!creds) {
    return NextResponse.json(
      { error: "Instância Avisa não configurada (AUTOZAP_AVISA_*)." },
      { status: 503 },
    );
  }

  // Mesma abertura da campanha, incluindo a variante de domingo — o que sai na
  // mão é exatamente o que sairia no automático.
  const bolhas = await montarAbertura(prospect);
  if (bolhas.length === 0) {
    return NextResponse.json({ error: "Nenhum template de abertura configurado." }, { status: 409 });
  }

  const erroEnvio: { message?: string } = {};
  let enviouTudo = true;
  try {
    for (let i = 0; i < bolhas.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, PAUSA_ENTRE_BOLHAS_MS));
      // typing só na 1ª: nas seguintes a pausa percebida tem que ser os 5s
      // limpos, sem somar o delay variável do "digitando...".
      const ok = await sendAvisaMessage(alvoTel, bolhas[i], creds, { typing: i === 0 }, erroEnvio);
      if (!ok) { enviouTudo = false; break; }
    }
  } catch (err) {
    console.error("❌ [vendas/abordar] Erro inesperado no envio:", err);
    enviouTudo = false;
  }

  const nowIso = new Date().toISOString();

  if (!enviouTudo) {
    const motivo = erroEnvio.message ?? "";
    // Mesma distinção do cron: número ruim é culpa do contato e sai da base;
    // chip recusando (463) é culpa nossa e o contato continua intacto.
    if (/could not validate the provided number/i.test(motivo)) {
      await supabaseAdmin
        .from("prospects")
        .update({
          status: "perdido",
          notas: [prospect.notas, `Número ${alvoTel} recusado pela Avisa (sem WhatsApp) em ${nowIso.slice(0, 10)}.`]
            .filter(Boolean)
            .join(" • "),
          updated_at: nowIso,
        })
        .eq("id", prospectId);
      return NextResponse.json(
        { error: "Esse número não tem WhatsApp — tirei o contato da base." },
        { status: 409 },
      );
    }

    await bumpStats({ bloqueios: 1 }).catch(() => {});
    console.error(`❌ [vendas/abordar] Envio recusado para ${prospect.nome_empresa}: ${motivo}`);
    return NextResponse.json(
      { error: `O chip recusou o envio${motivo ? `: ${motivo}` : "."}` },
      { status: 502 },
    );
  }

  await Promise.all([
    supabaseAdmin.from("prospect_mensagens").insert(bolhasParaLinhas(prospectId, bolhas)),
    supabaseAdmin
      .from("prospects")
      .update({
        status: "enviado",
        rodada: (prospect.rodada ?? 0) + 1,
        enviado_em: nowIso,
        ultima_msg_at: nowIso,
        // Nulo de propósito, igual ao cron: nesta campanha silêncio é fim, não
        // agendamento de nova cutucada.
        proximo_contato_at: null,
        wa_id: prospect.wa_id ?? normalizarWaId(prospect.telefone ?? null),
        updated_at: nowIso,
      })
      .eq("id", prospectId),
    bumpStats({ enviadas: 1, novas_conversas: 1 }).catch(() => {}),
  ]);

  console.log(`📨 [vendas/abordar] Abertura manual enviada para ${prospect.nome_empresa} (${alvoTel}).`);
  return NextResponse.json({ ok: true, bolhas: bolhas.length, status: "enviado" });
}
