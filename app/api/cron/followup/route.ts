// app/api/cron/followup/route.ts
//
// Cron job de follow-up inteligente de leads.
// Roda 6x/dia via Vercel Cron (vercel.json): 11,13,15,17,19,21h UTC.
// Gate de horário comercial (8h–18h BRT) bloqueia execuções fora do expediente.
// CADA EXECUÇÃO processa leads elegíveis — sem cronGuard global.
// O cooldown é controlado por lead (ultimo_followup) com prazo por temperatura:
//
// Dois cohorts de follow-up:
//
//   COHORT A — Primeiro contato sem resposta (2h):
//     · Cliente clicou no anúncio, agente mandou saudação, cliente sumiu
//     · Condição: ≤ 2 mensagens, agente falou por último, ultimo_followup IS NULL
//     · Aguarda 2h e manda: "Vi que você tem interesse no {carro}, ficou alguma dúvida?"
//     · Requer veiculo_id (veio de anúncio com carro específico)
//
//   COHORT B — Leads estabelecidos que esfriaram:
//     · Conversa tinha tração mas o cliente parou de responder
//     · Cooldown por temperatura: QUENTE=48h, MORNO=4 dias, FRIO=7 dias
//     · FRIO requer veiculo_id; MORNO/QUENTE aceita sem carro específico
//
// Fluxo por lead:
//   1. Detecta cohort (A ou B)
//   2. Lê as últimas 5 mensagens da conversa (contexto real)
//   3. Verifica se o carro de interesse ainda está disponível
//   4. Se vendido → busca alternativa compatível (modelo → categoria)
//   5. Gemini gera mensagem personalizada baseada no histórico
//   6. Envia via Avisa ou Meta (detecta canal do tenant)
//   7. Salva mensagem no histórico e atualiza ultimo_followup

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendMetaMessage } from "@/lib/meta";
import { sendAvisaMessage } from "@/lib/avisa";
import { geminiFlashSales } from "@/lib/gemini";

export const maxDuration = 300;

// ─── Autenticação ─────────────────────────────────────────────────────────────
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

// ─── Cooldowns por temperatura ────────────────────────────────────────────────
const COOLDOWN_DAYS: Record<string, number> = {
  QUENTE: 2,  // 48h — lead quente esfriando é urgente
  MORNO:  4,  // 4 dias
  FRIO:   7,  // 7 dias
};

// ─── Cohort A — Mensagem de primeiro contato sem resposta ─────────────────────
async function gerarMensagemPrimeiroContato(params: {
  nomeAgente: string;
  carro: string;
  preco: string;
}): Promise<string> {
  const { nomeAgente, carro, preco } = params;
  const prompt = `Você é ${nomeAgente}, vendedor de uma concessionária.
Um cliente clicou num anúncio do ${carro}${preco ? ` (${preco})` : ""} mas não respondeu à sua saudação inicial há mais de 2 horas.
Escreva UMA mensagem curtíssima e natural para retomar o contato.
Regras:
- Máximo 1 linha curta
- Mencione o carro de interesse de forma natural
- Tom leve, sem pressão, sem urgência artificial
- PROIBIDO: "follow-up", "retomada", "checando", saudações (Bom dia/tarde/noite)
- PROIBIDO: começar com o nome do cliente
- Máximo 1 emoji
- Responda APENAS com o texto da mensagem, sem aspas nem explicações`;

  try {
    const result = await geminiFlashSales.generateContent(prompt);
    return result.response.text().trim().replace(/^["']|["']$/g, "").trim();
  } catch {
    return `Vi que você tem interesse no ${carro}${preco ? ` por ${preco}` : ""}. Ficou alguma dúvida? 😊`;
  }
}

// ─── Cohort B — Mensagem de retomada de conversa estabelecida ─────────────────
async function gerarMensagemFollowup(params: {
  nomeLead: string | null;
  nomeAgente: string;
  nomeEmpresa: string;
  resumoNegociacao: string | null;
  carro: string;
  preco: string;
  disponivel: boolean;
  alternativa?: string;
  ultimasMensagens: Array<{ remetente: string; content: string }>;
  temperatura: string;
}): Promise<string> {
  const {
    nomeLead, nomeAgente, nomeEmpresa, resumoNegociacao,
    carro, preco, disponivel, alternativa,
    ultimasMensagens, temperatura,
  } = params;

  const historicoFormatado = ultimasMensagens.length > 0
    ? ultimasMensagens.map(m =>
        `${m.remetente === "usuario" ? "Cliente" : nomeAgente}: ${m.content}`
      ).join("\n")
    : "Sem histórico detalhado.";

  const ultimaMsg = ultimasMensagens[ultimasMensagens.length - 1];
  const agenteFalouPorUltimo = ultimaMsg?.remetente === "agente";

  const contextoDisponibilidade = disponivel
    ? `O ${carro}${preco ? ` (${preco})` : ""} ainda está disponível no pátio.`
    : `O ${carro} foi vendido, mas temos uma alternativa: ${alternativa || "outro veículo semelhante"}.`;

  const prompt = `
Você é ${nomeAgente}, vendedor da ${nomeEmpresa}.
A conversa com ${nomeLead || "o cliente"} sobre o ${carro} ficou parada há mais de 24 horas.
Temperatura atual do lead: ${temperatura}

${contextoDisponibilidade}

${resumoNegociacao ? `Resumo da negociação: ${resumoNegociacao}` : ""}

Últimas mensagens da conversa (ordem cronológica):
${historicoFormatado}

${agenteFalouPorUltimo
    ? "⚠️ VOCÊ (agente) foi quem mandou a última mensagem e o cliente NÃO respondeu. Retome de forma leve, perguntando se viu sua mensagem ou se ficou alguma dúvida."
    : "⚠️ O CLIENTE foi quem mandou a última mensagem e você NÃO respondeu. Retome respondendo o que ele perguntou/disse e demonstrando interesse em continuar."}

Escreva UMA mensagem curta de retomada baseada EXATAMENTE no que estava sendo discutido.
Regras:
- Se o cliente fez uma pergunta que ficou sem resposta → responda e pergunte se ainda tem interesse
- Se o agente fez uma pergunta e o cliente não respondeu → retome perguntando se viu a mensagem
- Se discutiram visita/agendamento → pergunte se quer confirmar o dia
- Se o cliente pediu foto/vídeo e recebeu → pergunte o que achou
- Se o carro foi vendido → apresente a alternativa como novidade, não como consolo
- Máximo 2 linhas curtas
- Tom natural e humano, como um vendedor real mandaria
- PROIBIDO: "follow-up", "retomada", "checando", "conferindo", "retorno"
- PROIBIDO: começar com saudação (Bom dia/Boa tarde/Boa noite) — vá direto ao ponto
- PROIBIDO: usar o nome do cliente mais de uma vez
- Máximo 1 emoji
- Responda APENAS com o texto da mensagem, sem aspas nem explicações
`;

  try {
    const result = await geminiFlashSales.generateContent(prompt);
    return result.response.text().trim().replace(/^["']|["']$/g, "").trim();
  } catch (e) {
    console.warn("⚠️ Gemini falhou no follow-up, usando fallback:", String(e).slice(0, 200));
    if (!disponivel && alternativa) {
      return `${nomeLead ? `Oi ${nomeLead}! ` : "Oi! "}Temos uma novidade que pode te interessar: ${alternativa}. Quer saber mais?`;
    }
    if (agenteFalouPorUltimo) {
      return `${nomeLead ? `${nomeLead}, ` : ""}conseguiu ver minha última mensagem? O ${carro} ainda está aqui${preco ? ` por ${preco}` : ""} 😉`;
    }
    return `${nomeLead ? `Oi ${nomeLead}! ` : "Oi! "}O ${carro} ainda está disponível${preco ? ` por ${preco}` : ""}. Ficou com alguma dúvida?`;
  }
}

// ─── GET Handler ──────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agora = new Date();

  // ── Gate de horário comercial (8h–18h BRT) ────────────────────────────────
  const horaBRT = parseInt(
    agora.toLocaleString("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }),
    10
  );
  if (horaBRT < 8 || horaBRT >= 18) {
    console.log(`⏰ Cron followup: fora do horário comercial (${horaBRT}h BRT) — adiando`);
    return NextResponse.json({ ok: true, skipped: true, motivo: "fora_horario_comercial", hora_brt: horaBRT });
  }

  // Cooldown mais permissivo para o filtro SQL (QUENTE = 48h)
  // A validação fina por temperatura acontece no loop
  const limite2h      = new Date(agora.getTime() -  2 * 60 * 60 * 1000).toISOString();
  const limiteSQL     = new Date(agora.getTime() -  2 * 24 * 60 * 60 * 1000).toISOString(); // 48h — QUENTE
  const limite24h     = new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString();

  // ── 1. Busca leads elegíveis ───────────────────────────────────────────────
  // Sem cronGuard global — cada lead controla seu próprio cooldown via ultimo_followup.
  // Filtro SQL usa o cooldown mais permissivo (48h = QUENTE) para não excluir nada.
  // MORNO e FRIO são filtrados no loop via COOLDOWN_DAYS.
  const { data: leads, error } = await supabaseAdmin
    .from("leads")
    .select(`
      id, wa_id, nome, user_id, veiculo_id, status,
      resumo_negociacao, ultimo_followup
    `)
    .in("status", ["FRIO", "MORNO", "QUENTE"])
    .eq("em_atendimento_humano", false)
    .or(`ultimo_followup.is.null,ultimo_followup.lt.${limiteSQL}`)
    .limit(100);

  if (error) {
    console.error("❌ Cron followup — erro ao buscar leads:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!leads || leads.length === 0) {
    console.log("📊 Cron followup: 0 leads elegíveis");
    return NextResponse.json({ ok: true, processados: 0 });
  }

  // ── 2. Cache de configs por tenant (evita N+1 queries) ─────────────────────
  const tenantIds = [...new Set(leads.map(l => l.user_id))];
  const { data: configs } = await supabaseAdmin
    .from("config_garage")
    .select(`
      user_id, nome_empresa, nome_fantasia, nome_agente, whatsapp,
      meta_phone_id, meta_access_token,
      avisa_base_url, avisa_token,
      plano_ativo, trial_ends_at, plano_vence_em
    `)
    .in("user_id", tenantIds);

  // Para config_garage com múltiplas linhas por tenant, pega a mais recente
  const configMap = new Map<string, any>();
  for (const c of configs ?? []) {
    const existing = configMap.get(c.user_id);
    if (!existing || c.created_at > existing.created_at) {
      configMap.set(c.user_id, c);
    }
  }

  let enviados = 0;
  let ignorados = 0;
  const motivosIgnorados: Record<string, number> = {};
  const ignorar = (motivo: string) => {
    ignorados++;
    motivosIgnorados[motivo] = (motivosIgnorados[motivo] || 0) + 1;
  };

  const MAX_ENVIOS = 50;

  for (const lead of leads) {
    if (enviados >= MAX_ENVIOS) break;

    try {
      // ── 2b. Gate de assinatura ──────────────────────────────────────────────
      const garagem = configMap.get(lead.user_id);
      if (!garagem) { ignorar("sem_config"); continue; }

      const trialConfigurado = garagem.trial_ends_at != null;
      const trialValido = trialConfigurado && new Date(garagem.trial_ends_at) > agora;
      const planoValido = garagem.plano_ativo === true && garagem.plano_vence_em && new Date(garagem.plano_vence_em) > agora;
      if (trialConfigurado && !trialValido && !planoValido) { ignorar("assinatura_expirada"); continue; }

      // ── 3. Cooldown por temperatura (MORNO e FRIO precisam de mais tempo) ──
      if (lead.ultimo_followup) {
        const cooldownDias = COOLDOWN_DAYS[lead.status as string] ?? 7;
        const cooldownMs   = cooldownDias * 24 * 60 * 60 * 1000;
        const msSinceFollowup = agora.getTime() - new Date(lead.ultimo_followup).getTime();
        if (msSinceFollowup < cooldownMs) {
          ignorar(`dentro_cooldown_${lead.status.toLowerCase()}`);
          continue;
        }
      }

      // ── 4. Mensagens da conversa ────────────────────────────────────────────
      const { data: ultimasMsgsDesc } = await supabaseAdmin
        .from("mensagens")
        .select("content, remetente, created_at, media_tipo")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(5);

      if (!ultimasMsgsDesc || ultimasMsgsDesc.length === 0) { ignorar("sem_mensagens"); continue; }

      const ultimaMsg     = ultimasMsgsDesc[0];
      const totalMensagens = ultimasMsgsDesc.length;
      const agenteFalouPorUltimo = ultimaMsg.remetente === "agente";

      // Filtra mensagens de mídia para o histórico (não enviar URL como contexto)
      const mensagensOrdenadas = [...ultimasMsgsDesc]
        .filter(m => !m.media_tipo) // remove registros de foto/vídeo
        .reverse();

      // ── 5. Detecta Cohort A (primeiro contato sem resposta) ─────────────────
      // Condições: ≤ 2 trocas, agente falou por último, cliente nunca respondeu
      // de volta, ultimo_followup IS NULL, veiculo_id existe (veio de anúncio)
      const isCohortA =
        lead.ultimo_followup === null &&
        lead.veiculo_id !== null &&
        totalMensagens <= 2 &&
        agenteFalouPorUltimo &&
        ultimaMsg.created_at < limite2h; // ≥ 2h sem resposta

      // ── 6. Cohort B: verifica silêncio mínimo de 24h ───────────────────────
      if (!isCohortA) {
        // Conversa está ativa há menos de 24h — não interromper
        if (ultimaMsg.created_at > limite24h) { ignorar("conversa_recente"); continue; }
        // FRIO sem histórico real ou sem carro específico — não retomar
        if (lead.status === "FRIO" && (totalMensagens < 2 || !lead.veiculo_id)) {
          ignorar("frio_sem_contexto"); continue;
        }
      }

      // ── 7. Config do tenant ─────────────────────────────────────────────────
      const nomeAgente  = garagem.nome_agente  || "Assistente";
      const nomeEmpresa = garagem.nome_fantasia || garagem.nome_empresa || "a loja";

      const useAvisa   = !!garagem.avisa_base_url && !!garagem.avisa_token;
      const avisaCreds = { baseUrl: garagem.avisa_base_url ?? "", token: garagem.avisa_token ?? "" };
      const metaCreds  = {
        phoneNumberId: garagem.meta_phone_id ?? "",
        accessToken:   garagem.meta_access_token || process.env.META_ACCESS_TOKEN || "",
      };
      const sendText = (to: string, text: string) =>
        useAvisa ? sendAvisaMessage(to, text, avisaCreds) : sendMetaMessage(to, text, metaCreds);

      // ── 8. Dados do veículo (se houver) ────────────────────────────────────
      let carro    = "veículo de interesse";
      let preco    = "";
      let disponivel = false;
      let alternativa: string | undefined;

      if (lead.veiculo_id) {
        const { data: veiculo } = await supabaseAdmin
          .from("veiculos")
          .select("marca, modelo, versao, ano, preco_sugerido, status_venda, categoria, user_id")
          .eq("id", lead.veiculo_id)
          .single();

        if (veiculo) {
          carro = `${veiculo.marca} ${veiculo.modelo}${veiculo.versao ? " " + veiculo.versao : ""} ${veiculo.ano || ""}`.trim();
          preco = veiculo.preco_sugerido
            ? `R$ ${veiculo.preco_sugerido.toLocaleString("pt-BR")}`
            : "";
          disponivel = veiculo.status_venda === "DISPONIVEL";

          if (!disponivel) {
            // Prioridade 1: mesmo modelo
            const { data: similar } = await supabaseAdmin
              .from("veiculos")
              .select("marca, modelo, versao, ano, preco_sugerido")
              .eq("status_venda", "DISPONIVEL")
              .eq("user_id", veiculo.user_id)
              .ilike("modelo", `%${(veiculo.modelo || "").split(" ")[0]}%`)
              .neq("id", lead.veiculo_id)
              .limit(1)
              .single();

            if (similar) {
              alternativa = `${similar.marca} ${similar.modelo}${similar.versao ? " " + similar.versao : ""} ${similar.ano || ""}`.trim();
              if (similar.preco_sugerido) alternativa += ` por R$ ${similar.preco_sugerido.toLocaleString("pt-BR")}`;
            } else {
              // Prioridade 2: mesma categoria
              const { data: mesmaCat } = await supabaseAdmin
                .from("veiculos")
                .select("marca, modelo, versao, ano, preco_sugerido")
                .eq("status_venda", "DISPONIVEL")
                .eq("user_id", veiculo.user_id)
                .eq("categoria", (veiculo as any).categoria || "")
                .neq("id", lead.veiculo_id)
                .limit(1)
                .single();

              if (mesmaCat) {
                alternativa = `${mesmaCat.marca} ${mesmaCat.modelo}${mesmaCat.versao ? " " + mesmaCat.versao : ""} ${mesmaCat.ano || ""}`.trim();
                if (mesmaCat.preco_sugerido) alternativa += ` por R$ ${mesmaCat.preco_sugerido.toLocaleString("pt-BR")}`;
              }
            }

            // Cohort A: se o carro foi vendido e não tem alternativa, pula
            if (isCohortA && !alternativa) { ignorar("vendido_sem_alternativa"); continue; }
            // Cohort B: mesma regra
            if (!isCohortA && !disponivel && !alternativa) { ignorar("vendido_sem_alternativa"); continue; }
          }
        }
      }

      // ── 9. Gera mensagem ────────────────────────────────────────────────────
      let mensagem: string;

      if (isCohortA) {
        // Cohort A: mensagem curta de primeiro contato
        mensagem = await gerarMensagemPrimeiroContato({ nomeAgente, carro, preco });
        console.log(`🆕 [Cohort A] ${lead.wa_id} (${lead.status}) — primeiro contato 2h`);
      } else {
        // Cohort B: retomada contextualizada
        mensagem = await gerarMensagemFollowup({
          nomeLead: lead.nome,
          nomeAgente,
          nomeEmpresa,
          resumoNegociacao: lead.resumo_negociacao,
          carro,
          preco,
          disponivel,
          alternativa,
          ultimasMensagens: mensagensOrdenadas,
          temperatura: lead.status,
        });
        console.log(`🔁 [Cohort B] ${lead.wa_id} (${lead.status}) — retomada`);
      }

      // ── 10. Envia ───────────────────────────────────────────────────────────
      await sendText(lead.wa_id, mensagem);

      // ── 11. Salva no histórico e atualiza ultimo_followup ──────────────────
      await supabaseAdmin.from("mensagens").insert({
        lead_id:   lead.id,
        content:   mensagem,
        remetente: "agente",
      });
      await supabaseAdmin
        .from("leads")
        .update({ ultimo_followup: agora.toISOString() })
        .eq("id", lead.id);

      console.log(`✅ Follow-up enviado → ${lead.wa_id} (${isCohortA ? "A" : "B"}, ${lead.status}) — "${mensagem.slice(0, 80)}"`);
      enviados++;

      // Pausa entre envios (3s) — anti-spam + rate limit WhatsApp
      await new Promise((r) => setTimeout(r, 3000));

    } catch (e) {
      console.error(`❌ Erro no follow-up do lead ${lead.id}:`, e);
    }
  }

  console.log(`📊 Cron followup: ${enviados} enviados, ${ignorados} ignorados (${JSON.stringify(motivosIgnorados)}) de ${leads.length} candidatos`);
  return NextResponse.json({ ok: true, enviados, ignorados, motivos: motivosIgnorados, total: leads.length });
}
