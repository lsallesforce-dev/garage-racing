// app/api/cron/followup/route.ts
//
// Cron job de follow-up inteligente de leads.
// Roda diariamente via Vercel Cron (vercel.json) às 13h BRT.
//
// Evolução: lê as últimas mensagens REAIS da conversa para gerar
// follow-ups contextualizados — baseados no que foi discutido,
// no carro que foi visto, e em quem falou por último.
//
// Regras de elegibilidade:
//   - Lead MORNO ou QUENTE → sempre elegível
//   - Lead FRIO → elegível SE tem veiculo_id (demonstrou interesse em carro específico)
//   - Última mensagem > 24h atrás
//   - ultimo_followup IS NULL ou > 7 dias atrás
//   - Não está em atendimento humano
//   - Tenant com plano/trial ativo
//
// Fluxo por lead:
//   1. Lê as últimas 4 mensagens da conversa (contexto real)
//   2. Verifica se o carro de interesse ainda está disponível
//   3. Se vendido → busca alternativa compatível (modelo → categoria)
//   4. Gemini gera mensagem personalizada com base no histórico real
//   5. Envia via Avisa ou Meta (detecta canal do tenant)
//   6. Salva mensagem no histórico e atualiza ultimo_followup

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendMetaMessage } from "@/lib/meta";
import { sendAvisaMessage } from "@/lib/avisa";
import { geminiFlashSales } from "@/lib/gemini";
import { cronGuard } from "@/lib/redis";

export const maxDuration = 300;

// ─── Autenticação ─────────────────────────────────────────────────────────────
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

// ─── Geração de Mensagem Inteligente ──────────────────────────────────────────
// Recebe o histórico real da conversa + contexto do veículo para gerar
// uma mensagem que parece continuação natural da conversa.
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

  // Formata o histórico real da conversa
  const historicoFormatado = ultimasMensagens.length > 0
    ? ultimasMensagens.map(m =>
        `${m.remetente === "usuario" ? "Cliente" : nomeAgente}: ${m.content}`
      ).join("\n")
    : "Sem histórico detalhado.";

  // Detecta quem falou por último (impacta o tom da retomada)
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
    const texto = result.response.text().trim();
    // Remove aspas envolventes que o Gemini às vezes adiciona
    return texto.replace(/^["']|["']$/g, "").trim();
  } catch (e) {
    console.warn("⚠️ Gemini falhou no follow-up, usando fallback:", String(e).slice(0, 200));
    // Fallback manual contextualizado
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

  // Guard de idempotência: impede duplo disparo no mesmo dia
  const hoje = agora.toISOString().slice(0, 10);
  const primeiraVez = await cronGuard(`followup:${hoje}`, 86_400);
  if (!primeiraVez) {
    console.log(`⏭️ Follow-up já executado hoje (${hoje}) — skip`);
    return NextResponse.json({ ok: true, skipped: true, motivo: "already_ran_today" });
  }

  const limite24h = new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const limite7d = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // ── 1. Busca leads elegíveis ───────────────────────────────────────────────
  // MORNO/QUENTE: sempre elegíveis
  // FRIO: elegível SE tem veiculo_id (demonstrou interesse em carro específico)
  const { data: leads, error } = await supabaseAdmin
    .from("leads")
    .select(`
      id, wa_id, nome, user_id, veiculo_id, status,
      resumo_negociacao, ultimo_followup
    `)
    .in("status", ["FRIO", "MORNO", "QUENTE"])
    .eq("em_atendimento_humano", false)
    .not("veiculo_id", "is", null)
    .or(`ultimo_followup.is.null,ultimo_followup.lt.${limite7d}`)
    .limit(80); // busca mais que o necessário, filtra depois

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

  const configMap = new Map<string, any>();
  for (const c of configs ?? []) {
    configMap.set(c.user_id, c);
  }

  let enviados = 0;
  let ignorados = 0;
  let motivosIgnorados: Record<string, number> = {};

  const ignorar = (motivo: string) => {
    ignorados++;
    motivosIgnorados[motivo] = (motivosIgnorados[motivo] || 0) + 1;
  };

  // Limite de processamento por execução (evita timeout de 300s)
  const MAX_ENVIOS = 50;

  for (const lead of leads) {
    if (enviados >= MAX_ENVIOS) break;

    try {
      // ── 2b. Gate de assinatura ──────────────────────────────────────────────
      const garagem = configMap.get(lead.user_id);
      if (!garagem) {
        ignorar("sem_config");
        continue;
      }

      const trialConfigurado = garagem.trial_ends_at != null;
      const trialValido = trialConfigurado && new Date(garagem.trial_ends_at) > agora;
      const planoValido = garagem.plano_ativo === true && garagem.plano_vence_em && new Date(garagem.plano_vence_em) > agora;
      if (trialConfigurado && !trialValido && !planoValido) {
        ignorar("assinatura_expirada");
        continue;
      }

      // ── 3. Verifica última mensagem (> 24h?) ───────────────────────────────
      const { data: ultimasMsgs } = await supabaseAdmin
        .from("mensagens")
        .select("content, remetente, created_at")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(4);

      if (!ultimasMsgs || ultimasMsgs.length === 0) {
        ignorar("sem_mensagens");
        continue;
      }

      // Verifica se última mensagem foi há menos de 24h
      if (ultimasMsgs[0].created_at && ultimasMsgs[0].created_at > limite24h) {
        ignorar("conversa_recente");
        continue;
      }

      // FRIO sem pelo menos 2 mensagens → conversa não começou de verdade
      if (lead.status === "FRIO" && ultimasMsgs.length < 2) {
        ignorar("frio_sem_historico");
        continue;
      }

      // Reverte para ordem cronológica (as mais antigas primeiro)
      const mensagensOrdenadas = [...ultimasMsgs].reverse();

      // ── 4. Config do tenant ─────────────────────────────────────────────────
      const nomeAgente = garagem.nome_agente || "Assistente";
      const nomeEmpresa = garagem.nome_fantasia || garagem.nome_empresa || "a loja";

      // Canal de envio: Avisa se configurado, caso contrário Meta
      const useAvisa = !!garagem.avisa_base_url && !!garagem.avisa_token;
      const avisaCreds = { baseUrl: garagem.avisa_base_url ?? "", token: garagem.avisa_token ?? "" };
      const metaCreds = {
        phoneNumberId: garagem.meta_phone_id ?? "",
        accessToken: garagem.meta_access_token || process.env.META_ACCESS_TOKEN || "",
      };

      const sendText = (to: string, text: string) =>
        useAvisa
          ? sendAvisaMessage(to, text, avisaCreds)
          : sendMetaMessage(to, text, metaCreds);

      // ── 5. Dados do veículo ─────────────────────────────────────────────────
      let carro = "veículo de interesse";
      let preco = "";
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

          // Se vendido, busca alternativa compatível
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
              if (similar.preco_sugerido) {
                alternativa += ` por R$ ${similar.preco_sugerido.toLocaleString("pt-BR")}`;
              }
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
                if (mesmaCat.preco_sugerido) {
                  alternativa += ` por R$ ${mesmaCat.preco_sugerido.toLocaleString("pt-BR")}`;
                }
              }
            }

            // Sem alternativa disponível — pula este lead
            if (!alternativa) {
              ignorar("vendido_sem_alternativa");
              continue;
            }
          }
        }
      }

      // ── 6. Gera mensagem contextualizada ────────────────────────────────────
      const mensagem = await gerarMensagemFollowup({
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

      // ── 7. Envia ────────────────────────────────────────────────────────────
      await sendText(lead.wa_id, mensagem);

      // ── 8. Salva no histórico ───────────────────────────────────────────────
      await supabaseAdmin.from("mensagens").insert({
        lead_id: lead.id,
        content: mensagem,
        remetente: "agente",
      });

      // Atualiza ultimo_followup
      await supabaseAdmin
        .from("leads")
        .update({ ultimo_followup: agora.toISOString() })
        .eq("id", lead.id);

      console.log(`✅ Follow-up enviado para ${lead.wa_id} (lead ${lead.id}, ${lead.status}) — "${mensagem.slice(0, 80)}..."`);
      enviados++;

      // Pausa entre envios (3s) — anti-spam + rate limit
      await new Promise((r) => setTimeout(r, 3000));
    } catch (e) {
      console.error(`❌ Erro no follow-up do lead ${lead.id}:`, e);
    }
  }

  console.log(`📊 Cron followup: ${enviados} enviados, ${ignorados} ignorados (${JSON.stringify(motivosIgnorados)}) de ${leads.length} leads`);
  return NextResponse.json({ ok: true, enviados, ignorados, motivos: motivosIgnorados, total: leads.length });
}
