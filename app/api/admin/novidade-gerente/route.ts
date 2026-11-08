// app/api/admin/novidade-gerente/route.ts
//
// Anuncia ao gerente de cada loja o diálogo gerente × agente (lib/gerente-acoes,
// lib/gerente-assistente): o agente da loja manda, pelo número da loja, o que
// o gerente pode pedir e como responder às perguntas.
//
// POST { modo: "previa" }               → manda TODAS as versões só pro Lucas,
//                                         pelo canal interno (chip da Mari).
// POST { modo: "enviar", tenants: [...] } → manda pros gerentes dos tenants
//                                         listados (exige lista explícita).
// Sem `tenants` na prévia: lojas com plano_ativo.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";
import { alertaInterno } from "@/lib/alerta-interno";
import { carregarCanal, ehAutoEnvio } from "@/lib/canal-tenant";
import { sendAvisaMessage } from "@/lib/avisa";
import { sendMetaMessage, sendMetaReplyButtons, sendMetaTemplate } from "@/lib/meta";
import { gerenteNaJanela, enfileirarAlertaGerente } from "@/lib/redis";
import { bancosAtivos, financiamentoAutoLigado } from "@/lib/financiamento-simulacao";

export const maxDuration = 60;

function textoNovidade(p: { agente: string; loja: string; financiamento: boolean; cloudApi: boolean }): string {
  return (
    `Oi! Aqui é a ${p.agente}, a assistente da ${p.loja} 🤖\n\n` +
    `*Novidade:* agora você pode falar comigo por aqui, como sua assistente pessoal. É só mandar mensagem neste número:\n\n` +
    `🚗 *Carro* — "preço do Corolla 2022", "tem Hilux?"\n` +
    `📸 *Fotos* — "me manda as fotos do Compass" (chegam aqui, prontas pra encaminhar)\n` +
    `👤 *Cliente* — "como tá o João?" ou o telefone dele\n` +
    `📊 *Resumo* — "como foi hoje?"\n` +
    `🔁 *Retomar* — "chama o João de novo" e eu volto a falar com ele\n` +
    `📅 *Agenda* — "agenda visita amanhã 10h com o Pedro"\n\n` +
    `E nos meus avisos, agora eu pergunto antes de agir:\n` +
    (p.financiamento
      ? `💳 Cliente quer financiar → "Consulto nos bancos?" e, com o resultado, "Posso mandar pro cliente?". Nada vai pro cliente sem o seu ok.\n`
      : "") +
    `⏰ Cliente esperando resposta → "Quer que eu retome a conversa?"\n\n` +
    (p.cloudApi
      ? `Nas minhas perguntas é só tocar no botão. Esqueceu o que eu faço? Mande *ajuda*. 😉`
      : `Pra responder, mande *1* (sim) ou *2* (não).\nEsqueceu? Mande *ajuda* que eu mostro tudo de novo. 😉`)
  );
}

export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const body = await req.json().catch(() => ({}));
  const modo = body?.modo === "enviar" ? "enviar" : "previa";
  let tenants: string[] = Array.isArray(body?.tenants) ? body.tenants.map(String) : [];
  if (modo === "enviar" && !tenants.length) {
    return NextResponse.json({ error: "modo enviar exige a lista de tenants" }, { status: 400 });
  }
  if (!tenants.length) {
    const { data } = await supabaseAdmin.from("config_garage").select("user_id").eq("plano_ativo", true).not("user_id", "is", null);
    tenants = [...new Set((data ?? []).map((r: any) => String(r.user_id)))];
  }

  const resultado: any[] = [];
  for (const tenant of tenants) {
    const canal = await carregarCanal(tenant);
    if (!canal) { resultado.push({ tenant, status: "sem config" }); continue; }
    const { data: cfg } = await supabaseAdmin.from("config_garage").select("nome_agente")
      .eq("user_id", tenant).order("created_at", { ascending: false }).limit(1);
    const agente = cfg?.[0]?.nome_agente || "Júlia";
    const financiamento = (await financiamentoAutoLigado(tenant).catch(() => false)) && (await bancosAtivos(tenant).catch(() => [])).length > 0;
    const temCanal = canal.useAvisa || !!(canal.meta.phoneNumberId && canal.meta.accessToken);
    const destino = canal.gerentePrincipal;
    const bloqueio = !temCanal ? "loja sem canal de WhatsApp"
      : !destino ? "sem WhatsApp do gerente"
      : ehAutoEnvio(canal, destino) ? "gerente = número do agente (não recebe)"
      : null;
    const texto = textoNovidade({ agente, loja: canal.loja, financiamento, cloudApi: !canal.useAvisa });

    if (modo === "previa") {
      const r = await alertaInterno("novidade-gerente", `Prévia — ${canal.loja}`,
        `👀 *PRÉVIA — ${canal.loja}* (iria pro gerente ${destino ? "+" + destino : "—"}${bloqueio ? ` · ⚠️ NÃO ENVIARIA: ${bloqueio}` : ""})\n\n${texto}`);
      resultado.push({ tenant, loja: canal.loja, destino, bloqueio, previa_entregue: r.entregue });
      continue;
    }

    if (bloqueio) { resultado.push({ tenant, loja: canal.loja, status: `pulado: ${bloqueio}` }); continue; }
    let status = "falhou";
    try {
      if (canal.useAvisa) {
        status = (await sendAvisaMessage(destino!, texto, canal.avisa, { typing: false })) ? "enviado" : "falhou";
      } else if (await gerenteNaJanela(tenant)) {
        status = (await sendMetaMessage(destino!, texto, canal.meta).catch(() => null)) != null ? "enviado" : "falhou";
        // Fecha com botões pra ele testar na hora: o título do botão chega
        // como mensagem dele e cai no lib/gerente-assistente (resumo / menu).
        if (status === "enviado") {
          await sendMetaReplyButtons(destino!, "Quer testar agora? 👇", [
            { id: "novidade:hoje", titulo: "Como foi hoje?" },
            { id: "novidade:ajuda", titulo: "Ajuda" },
          ], canal.meta).catch(() => {});
        }
      } else {
        // Fora da janela de 24h: template "novidade_assistente" (MARKETING,
        // criado 08/11 na APROVE e no Bonitão) com os botões "Como foi hoje?"
        // e "Ajuda" — o toque abre a janela. O texto completo vai pra fila
        // que despeja quando ele falar com a loja.
        const viaTemplate = await sendMetaTemplate(destino!, "novidade_assistente", [agente, canal.loja], canal.meta);
        await enfileirarAlertaGerente(tenant, texto, "");
        status = viaTemplate ? "template enviado (texto completo na fila)" : "na fila (template ainda não aprovado)";
      }
    } catch (e: any) {
      status = `falhou: ${String(e?.message ?? e).slice(0, 120)}`;
    }
    resultado.push({ tenant, loja: canal.loja, destino, status });
  }
  return NextResponse.json({ modo, resultado });
}
