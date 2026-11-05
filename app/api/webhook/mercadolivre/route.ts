// Recebe notificações do Mercado Livre (perguntas em anúncios). A agente responde a
// pergunta no anúncio (lib/mercadolivre-resposta) e o gerente recebe o aviso com a resposta.
// ML envia um POST único para toda a aplicação — identificamos o tenant pelo ml_user_id.
//
// Configurar no painel ML Developers → Notificações:
//   URL: https://www.autozap.digital/api/webhook/mercadolivre
//   Tópicos: questions

import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMLToken, mlHeaders, ML_API } from "@/lib/mercadolivre";
import { sendMetaMessage, sendMetaCtaButton, sendMetaAlertaTemplate } from "@/lib/meta";
import { gerenteNaJanela, enfileirarAlertaGerente } from "@/lib/redis";
import { sendAvisaMessage } from "@/lib/avisa";
import { gerarRespostaML } from "@/lib/mercadolivre-resposta";

export const maxDuration = 60;

async function processNotification(body: any) {
  const { topic, resource, user_id: mlUserId } = body ?? {};
  if (!topic || !resource || !mlUserId) return;

  // Resolve tenant pelo ml_user_id salvo no OAuth
  const { data: cfgRows } = await supabaseAdmin
    .from("config_garage")
    .select("user_id, nome_fantasia, nome_empresa, nome_agente, cidade, estado, horario_funcionamento, agente_pausado, whatsapp, meta_phone_id, meta_access_token, avisa_base_url, avisa_token")
    .eq("ml_user_id", String(mlUserId))
    .limit(1);

  const cfg = cfgRows?.[0];
  if (!cfg) {
    console.warn(`⚠️ ML webhook: ml_user_id ${mlUserId} não encontrado`);
    return;
  }

  const tenantId = cfg.user_id;
  const token    = await getMLToken(tenantId);
  if (!token) return;

  // ── Pergunta em anúncio ────────────────────────────────────────────────────
  if (topic === "questions") {
    const qId = resource.replace(/\D/g, "");

    const qResp = await fetch(`${ML_API}/questions/${qId}`, { headers: mlHeaders(token) });
    if (!qResp.ok) { console.warn(`⚠️ ML: pergunta ${qId} não encontrada`); return; }
    const q = await qResp.json();

    // O ML notifica de novo quando a pergunta é respondida (pela agente ou no painel):
    // só a pergunta em aberto cria lead, gera resposta e avisa o gerente.
    if (q.status !== "UNANSWERED") return;

    const itemId: string    = q.item_id ?? "";
    const buyerMlId: number = q.from?.id;
    const texto: string     = q.text ?? "";

    // Localiza o veículo pelo ml_item_id
    const { data: vRows } = await supabaseAdmin
      .from("veiculos")
      .select("id, marca, modelo, versao, ano_modelo, ano, preco_sugerido, quilometragem_estimada, cor, combustivel, cambio, opcionais, relatorio_ia, status_venda")
      .eq("ml_item_id", itemId)
      .eq("user_id", tenantId)
      .limit(1);

    const veiculo = vRows?.[0];

    // Busca nome do comprador (ML não expõe telefone em perguntas)
    let nomeComprador = "Cliente ML";
    if (buyerMlId) {
      const uResp = await fetch(`${ML_API}/users/${buyerMlId}`, { headers: mlHeaders(token) }).catch(() => null);
      if (uResp?.ok) {
        const u = await uResp.json();
        if (u.first_name) nomeComprador = `${u.first_name} ${u.last_name ?? ""}`.trim();
      }
    }

    // Cria lead sem telefone (ML não expõe) — atendimento humano direto
    const mlLeadId = `ml_${qId}`;
    const { data: leadDb } = await supabaseAdmin
      .from("leads")
      .upsert(
        {
          wa_id:               mlLeadId,
          user_id:             tenantId,
          nome:                nomeComprador,
          origem:              "mercadolivre",
          origem_anuncio_id:   itemId || undefined,
          origem_mensagem:     texto.slice(0, 500) || undefined,
          veiculo_id:          veiculo?.id ?? null,
          temperatura:         "FRIO",
          em_atendimento_humano: true,
        },
        { onConflict: "user_id,wa_id", ignoreDuplicates: false }
      )
      .select()
      .single();

    if (leadDb) {
      await supabaseAdmin.from("mensagens").insert({
        lead_id:  leadDb.id,
        content:  `[ML] ${texto}`,
        remetente: "usuario",
      });
    }

    const veiculoNome = veiculo
      ? `${veiculo.marca} ${veiculo.modelo} ${veiculo.ano_modelo ?? veiculo.ano ?? ""}`.trim()
      : "anúncio desconhecido";
    const nomeEmpresa = cfg.nome_fantasia || cfg.nome_empresa || "AutoZap";

    // Agente responde a pergunta no próprio anúncio (pública). Agente pausada ou
    // Gemini fora → fica pro gerente responder no painel, como antes.
    let respostaAgente: string | null = null;
    if (cfg.agente_pausado !== true) {
      let tituloAnuncio = veiculoNome;
      let precoAnuncio: number | null = null;
      if (!veiculo && itemId) {
        const it = await fetch(`${ML_API}/items/${itemId}`, { headers: mlHeaders(token) }).then(r => (r.ok ? r.json() : null)).catch(() => null);
        if (it) { tituloAnuncio = it.title ?? tituloAnuncio; precoAnuncio = Number(it.price) || null; }
      }
      const resposta = await gerarRespostaML(texto, veiculo ?? null, {
        nomeAgente: cfg.nome_agente, nomeLoja: nomeEmpresa, cidade: cfg.cidade, estado: cfg.estado, horario: cfg.horario_funcionamento,
      }, tituloAnuncio, precoAnuncio);
      if (resposta) {
        const ans = await fetch(`${ML_API}/answers`, {
          method: "POST",
          headers: mlHeaders(token),
          body: JSON.stringify({ question_id: Number(qId), text: resposta }),
        });
        if (ans.ok) {
          respostaAgente = resposta;
          if (leadDb) {
            await supabaseAdmin.from("mensagens").insert({ lead_id: leadDb.id, content: `[ML] ${resposta}`, remetente: "agente" });
          }
          console.log(`🤖 ML pergunta ${qId} respondida pela agente`);
        } else {
          console.error(`❌ ML /answers ${qId} falhou:`, ans.status, (await ans.text().catch(() => "")).slice(0, 300));
        }
      }
    }

    console.log(`✅ ML pergunta ${qId} — ${nomeComprador} — ${veiculoNome} — tenant ${tenantId}`);

    // Alerta o gerente via WhatsApp — respeita o canal do tenant (Avisa ou Meta)
    const gerentePhone = cfg.whatsapp
      ? cfg.whatsapp.replace(/\D/g, "").replace(/^(?!55)/, "55")
      : null;

    if (gerentePhone) {
      const mlLink = `https://www.mercadolivre.com.br/perguntas-e-respostas/item/${itemId}`;

      const alertBody =
        `🟡 *LEAD MERCADO LIVRE — ${nomeEmpresa.toUpperCase()}*\n\n` +
        `👤 *De:* ${nomeComprador}\n` +
        `🚗 *Veículo:* ${veiculoNome}\n` +
        `💬 *Pergunta:* "${texto.slice(0, 300)}"\n\n` +
        (respostaAgente
          ? `🤖 *${cfg.nome_agente || "Agente"} respondeu no anúncio:* "${respostaAgente}"`
          : `_Responda pelo painel do Mercado Livre_`);

      // Mesma regra do resto do app: Avisa configurada vence; senão Meta.
      const useAvisa = !!cfg.avisa_base_url && !!cfg.avisa_token;

      if (useAvisa) {
        const avisaCreds = { baseUrl: cfg.avisa_base_url as string, token: cfg.avisa_token as string };
        await sendAvisaMessage(gerentePhone, `${alertBody}\n\n${mlLink}`, avisaCreds, { typing: false })
          .catch(err => console.error("❌ ML alert Avisa falhou:", err?.message ?? err));
      } else if (cfg.meta_phone_id && cfg.meta_access_token) {
        const metaCreds = { phoneNumberId: cfg.meta_phone_id, accessToken: cfg.meta_access_token };
        // Cloud API: fora da janela de 24h do gerente texto livre não entrega →
        // template de alerta; sem template, fila que despeja quando a janela abrir.
        let ok = false;
        if (await gerenteNaJanela(tenantId)) {
          ok = await sendMetaCtaButton(gerentePhone, alertBody, "Responder no ML", mlLink, metaCreds)
            .then(() => true)
            .catch(() => sendMetaMessage(gerentePhone, `${alertBody}\n\n${mlLink}`, metaCreds).then(r => r != null).catch(() => false));
        }
        const textoFila = respostaAgente
          ? `Pergunta no Mercado Livre de ${nomeComprador} sobre ${veiculoNome}: "${texto.slice(0, 300)}" — ${cfg.nome_agente || "a agente"} já respondeu: "${respostaAgente}"`
          : `Pergunta no Mercado Livre de ${nomeComprador} sobre ${veiculoNome}: "${texto.slice(0, 300)}" — responder em ${mlLink}`;
        if (!ok) ok = await sendMetaAlertaTemplate(gerentePhone, nomeEmpresa, textoFila, "", metaCreds);
        if (!ok) await enfileirarAlertaGerente(tenantId, textoFila, "");
      } else {
        console.warn(`⚠️ ML alert: tenant ${tenantId} sem canal de WhatsApp configurado (nem Avisa nem Meta)`);
      }
    }
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  after(async () => {
    await processNotification(body).catch(err =>
      console.error("❌ ML webhook after() erro:", err?.message ?? err)
    );
  });

  return NextResponse.json({ received: true });
}
