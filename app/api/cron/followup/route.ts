// app/api/cron/followup/route.ts
//
// Cron job de follow-up de leads — ciclo de 2 mensagens por lead, encerrado.
// Roda 6x/dia via Vercel Cron (vercel.json): 11,13,15,17,19,21h UTC.
// Gate de horário comercial (8h–18h BRT) bloqueia execuções fora do expediente.
//
// CICLO FIXO — máximo 2 follow-ups por lead (campo followup_count):
//   · followup_count = 0 → 1° follow-up: aguarda 2h de silêncio do cliente
//   · followup_count = 1 → 2° follow-up: aguarda 24h desde o 1° (ultimo_followup)
//   · followup_count ≥ 2 → ciclo encerrado, lead não recebe mais follow-ups
//
// Se o cliente responder entre os follow-ups → followup_count é zerado pelo webhook.
//
// Fluxo por lead:
//   1. Lê as últimas 5 mensagens da conversa (contexto real)
//   2. Verifica se o carro de interesse ainda está disponível
//   3. Se vendido → busca alternativa compatível (modelo → categoria)
//   4. Gemini gera mensagem personalizada baseada no histórico
//   5. Envia via Avisa (Meta exige template aprovado para mensagens fora da sessão)
//   6. Salva mensagem no histórico, incrementa followup_count e atualiza ultimo_followup

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendMetaMessage } from "@/lib/meta";
import { sendAvisaMessage } from "@/lib/avisa";
import { geminiFlashSales } from "@/lib/gemini";

export const maxDuration = 300;

// ─── Autenticação ─────────────────────────────────────────────────────────────
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;

  if (secret) {
    // CRON_SECRET configurado → exige o Bearer token que o Vercel envia automaticamente
    return req.headers.get("authorization") === `Bearer ${secret}`;
  }

  // CRON_SECRET não configurado:
  // – em dev: libera tudo
  // – em produção: aceita apenas chamadas do próprio Vercel Cron (User-Agent vercel-cron/1.0)
  if (process.env.NODE_ENV !== "production") return true;
  return req.headers.get("user-agent") === "vercel-cron/1.0";
}

// ─── Timing de follow-up (fixo para todos os status) ─────────────────────────
const SILENCIO_PRIMEIRO_FOLLOWUP_HORAS = 2;   // 2h sem resposta → dispara o 1°
const COOLDOWN_SEGUNDO_FOLLOWUP_HORAS  = 24;  // 24h após o 1° → dispara o 2° e encerra
const MAX_FOLLOWUPS = 2;                       // ciclo máximo por lead

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

// ─── Em Risco — Reengajamento de lead QUENTE sem resposta há 48h+ ─────────────
async function gerarMensagemReengajamento(params: {
  nomeLead: string | null;
  nomeAgente: string;
  nomeEmpresa: string;
  carro: string;
  preco: string;
  disponivel: boolean;
  alternativa?: string;
  resumoNegociacao: string | null;
  ultimasMensagens: Array<{ remetente: string; content: string }>;
}): Promise<string> {
  const { nomeLead, nomeAgente, nomeEmpresa, carro, preco, disponivel, alternativa, resumoNegociacao, ultimasMensagens } = params;

  const historicoFormatado = ultimasMensagens.length > 0
    ? ultimasMensagens.map(m =>
        `${m.remetente === "usuario" ? "Cliente" : nomeAgente}: ${m.content}`
      ).join("\n")
    : "Sem histórico.";

  const contextoDisp = disponivel
    ? `O ${carro}${preco ? ` (${preco})` : ""} ainda está no pátio.`
    : `O ${carro} foi vendido. Mas temos: ${alternativa || "outro veículo semelhante"}.`;

  const prompt = `
Você é ${nomeAgente}, vendedor da ${nomeEmpresa}.
${nomeLead || "O cliente"} estava MUITO interessado no ${carro} e a conversa estava quente — mas sumiu há mais de 48 horas sem responder.
Situação: ${contextoDisp}
${resumoNegociacao ? `Resumo da negociação: ${resumoNegociacao}` : ""}

Últimas mensagens:
${historicoFormatado}

Escreva UMA mensagem direta para recuperar este lead. Estratégia:
- Crie URGÊNCIA real e legítima (estoque limitado, o carro pode sair antes de amanhã, etc.)
- Seja assertivo mas não desesperado
- Se o carro foi vendido → apresente a alternativa como oportunidade única
- Tom: amigo que dá um alerta, não vendedor chato
- Máximo 2 linhas
- PROIBIDO: "follow-up", "retomada", "checando", saudação no início
- PROIBIDO: começar com o nome do cliente
- Máximo 1 emoji
- Responda APENAS com o texto, sem aspas nem explicações
`;

  try {
    const result = await geminiFlashSales.generateContent(prompt);
    return result.response.text().trim().replace(/^["']|["']$/g, "").trim();
  } catch {
    if (!disponivel && alternativa) {
      return `O ${carro} foi vendido, mas encontrei algo parecido: ${alternativa}. Posso te mostrar? 🔥`;
    }
    return `${nomeLead ? `${nomeLead}, ` : ""}o ${carro} ainda está aqui mas a procura tá alta — se quiser garantir, me chama agora 🔥`;
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

  // Filtro SQL: pega leads com ciclo ainda aberto (followup_count < 2) e
  // que já passaram do cooldown mínimo (2h de silêncio ou 24h desde o 1°).
  // Validação fina de timing acontece no loop.
  const limite2h  = new Date(agora.getTime() - SILENCIO_PRIMEIRO_FOLLOWUP_HORAS * 60 * 60 * 1000).toISOString();
  const limite24h = new Date(agora.getTime() - COOLDOWN_SEGUNDO_FOLLOWUP_HORAS  * 60 * 60 * 1000).toISOString();

  // ── 1. Busca leads elegíveis ───────────────────────────────────────────────
  const { data: leads, error } = await supabaseAdmin
    .from("leads")
    .select(`
      id, wa_id, nome, user_id, veiculo_id, status,
      resumo_negociacao, ultimo_followup, followup_count
    `)
    .in("status", ["FRIO", "MORNO", "QUENTE"])
    .eq("em_atendimento_humano", false)
    .lt("followup_count", MAX_FOLLOWUPS)
    .or(`ultimo_followup.is.null,ultimo_followup.lt.${limite24h}`)
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

      // ── 3. Mensagens da conversa ────────────────────────────────────────────
      const { data: ultimasMsgsDesc } = await supabaseAdmin
        .from("mensagens")
        .select("content, remetente, created_at, media_tipo")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(5);

      if (!ultimasMsgsDesc || ultimasMsgsDesc.length === 0) { ignorar("sem_mensagens"); continue; }

      const ultimaMsg      = ultimasMsgsDesc[0];
      const totalMensagens = ultimasMsgsDesc.length;
      const agenteFalouPorUltimo = ultimaMsg.remetente === "agente";

      // Filtra mensagens de mídia do histórico (URLs não devem ir como contexto)
      const mensagensOrdenadas = [...ultimasMsgsDesc]
        .filter(m => !m.media_tipo)
        .reverse();

      // Tempo de silêncio desde a última mensagem
      const silencioMs    = agora.getTime() - new Date(ultimaMsg.created_at).getTime();
      const silencioHoras = silencioMs / (60 * 60 * 1000);

      // ── 4. Validação de timing — ciclo fixo de 2 follow-ups ──────────────
      const followupCount = lead.followup_count ?? 0;

      if (followupCount === 0) {
        // 1° follow-up: aguarda 2h de silêncio do cliente
        if (silencioHoras < SILENCIO_PRIMEIRO_FOLLOWUP_HORAS) {
          ignorar(`aguardando_2h_silencio`);
          continue;
        }
      } else {
        // 2° follow-up: aguarda 24h desde o 1° (ultimo_followup)
        const msSinceFollowup = lead.ultimo_followup
          ? agora.getTime() - new Date(lead.ultimo_followup).getTime()
          : Infinity;
        const horasSinceFollowup = msSinceFollowup / (60 * 60 * 1000);
        if (horasSinceFollowup < COOLDOWN_SEGUNDO_FOLLOWUP_HORAS) {
          ignorar(`aguardando_24h_segundo_followup`);
          continue;
        }
      }

      // ── 5. Filtros de qualidade ─────────────────────────────────────────────
      // Lead sem histórico real e sem carro → skip
      if (totalMensagens < 2 && !lead.veiculo_id) {
        ignorar("sem_contexto"); continue;
      }

      // ── 7. Config do tenant ─────────────────────────────────────────────────
      const nomeAgente  = garagem.nome_agente  || "Assistente";
      const nomeEmpresa = garagem.nome_fantasia || garagem.nome_empresa || "a loja";

      const useAvisa   = !!garagem.avisa_base_url && !!garagem.avisa_token;

      // Follow-up proativo só é permitido via Avisa API.
      // Meta Cloud API exige template aprovado para mensagens fora da janela de sessão
      // de 24h — enviar mensagem livre fora da sessão viola a política da Meta.
      if (!useAvisa) { ignorar("meta_api_sem_followup"); continue; }

      const avisaCreds = { baseUrl: garagem.avisa_base_url ?? "", token: garagem.avisa_token ?? "" };
      const sendText = (to: string, text: string) =>
        sendAvisaMessage(to, text, avisaCreds);

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

            // Carro vendido sem alternativa disponível — pula
            if (!alternativa) { ignorar("vendido_sem_alternativa"); continue; }
          }
        }
      }

      // ── 9. Gera mensagem ────────────────────────────────────────────────────
      // 1° follow-up (followup_count=0): mensagem curta se poucos msgs e tem carro,
      //                                  ou contextual baseada no histórico
      // 2° follow-up (followup_count=1): sempre contextual (reengajamento mais direto)

      const isFirstFollowup = followupCount === 0;
      const usarMensagemCurta =
        isFirstFollowup &&
        totalMensagens <= 2 &&
        lead.veiculo_id !== null;

      let mensagem: string;

      if (usarMensagemCurta) {
        mensagem = await gerarMensagemPrimeiroContato({ nomeAgente, carro, preco });
        console.log(`🆕 [1° follow-up/curta] ${lead.wa_id} (${lead.status}) — primeiro contato`);
      } else if (isFirstFollowup) {
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
        console.log(`🔁 [1° follow-up/contextual] ${lead.wa_id} (${lead.status}) — retomada`);
      } else {
        // 2° e último follow-up — reengajamento assertivo
        mensagem = await gerarMensagemReengajamento({
          nomeLead: lead.nome,
          nomeAgente,
          nomeEmpresa,
          carro,
          preco,
          disponivel,
          alternativa,
          resumoNegociacao: lead.resumo_negociacao,
          ultimasMensagens: mensagensOrdenadas,
        });
        console.log(`🚨 [2° follow-up/final] ${lead.wa_id} (${lead.status}) — ciclo encerra após este`);
      }

      // ── 10. Envia ───────────────────────────────────────────────────────────
      await sendText(lead.wa_id, mensagem);

      // ── 11. Salva no histórico e atualiza lead ─────────────────────────────
      const { error: insertErr } = await supabaseAdmin.from("mensagens").insert({
        lead_id:   lead.id,
        content:   mensagem,
        remetente: "agente",
      });
      if (insertErr) {
        console.error(`❌ Erro ao salvar mensagem no histórico do lead ${lead.id}:`, insertErr);
      }

      // Incrementa followup_count e atualiza updated_at para o lead subir no chat
      await supabaseAdmin
        .from("leads")
        .update({
          ultimo_followup: agora.toISOString(),
          followup_count:  followupCount + 1,
          updated_at:      agora.toISOString(),
        })
        .eq("id", lead.id);

      const tipoMensagem = usarMensagemCurta ? "curta" : isFirstFollowup ? "contextual" : "final";
      console.log(`✅ Follow-up ${followupCount + 1}/${MAX_FOLLOWUPS} → ${lead.wa_id} (${lead.status}, ${tipoMensagem}) — "${mensagem.slice(0, 80)}"`);
      enviados++;

      await new Promise((r) => setTimeout(r, 3_000)); // 3s entre envios (anti-spam)

    } catch (e) {
      console.error(`❌ Erro no follow-up do lead ${lead.id}:`, e);
    }
  }

  console.log(`📊 Cron followup: ${enviados} enviados, ${ignorados} ignorados (${JSON.stringify(motivosIgnorados)}) de ${leads.length} candidatos`);
  return NextResponse.json({ ok: true, enviados, ignorados, motivos: motivosIgnorados, total: leads.length });
}
