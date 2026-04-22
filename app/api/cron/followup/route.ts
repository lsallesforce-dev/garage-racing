// app/api/cron/followup/route.ts
//
// Cron job de follow-up automático de leads frios.
// Roda diariamente via Vercel Cron (vercel.json).
//
// Regras:
//   - Lead MORNO ou QUENTE
//   - Última mensagem > 24h atrás
//   - ultimo_followup IS NULL ou > 7 dias atrás
//   - Não está em atendimento humano
//
// Fluxo por lead:
//   1. Verifica se o carro de interesse ainda está disponível
//   2. Se sim → mensagem de reaquecimento com o mesmo carro
//   3. Se não → busca compatível (mesmo modelo → mesma categoria) e oferece
//   4. Gemini gera a mensagem personalizada com base no resumo_negociacao
//   5. Envia via Avisa e atualiza ultimo_followup

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendMetaMessage } from "@/lib/meta";
import { geminiFlashSales } from "@/lib/gemini";

export const maxDuration = 300;

// Autenticação via CRON_SECRET (adicione ao .env e às variáveis da Vercel)
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Sem secret: permite apenas em desenvolvimento local (fail-secure em produção)
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

async function gerarMensagemFollowup(params: {
  nomeLead: string | null;
  nomeAgente: string;
  nomeEmpresa: string;
  resumoNegociacao: string | null;
  carro: string;
  preco: string;
  disponivel: boolean;
  alternativa?: string;
}): Promise<string> {
  const { nomeLead, nomeAgente, nomeEmpresa, resumoNegociacao, carro, preco, disponivel, alternativa } = params;

  const contexto = disponivel
    ? `O cliente se interessou pelo ${carro} (${preco}) mas a conversa esfriou. O carro ainda está disponível.`
    : `O cliente se interessou pelo ${carro} mas ele foi vendido. Temos uma alternativa: ${alternativa}.`;

  const prompt = `
Você é ${nomeAgente}, vendedor da ${nomeEmpresa}.
${resumoNegociacao ? `Contexto da negociação: ${resumoNegociacao}` : ""}
${contexto}

Escreva UMA mensagem curta e natural de follow-up para ${nomeLead || "o cliente"} via WhatsApp.
Regras:
- Máximo 2 linhas
- Tom humano, não robótico
- Não mencione "follow-up", "retomada" ou palavras de marketing
- Se o carro ainda está disponível: gere interesse e urgência sutil
- Se é alternativa: apresente como novidade, não como consolo
- Não use emojis excessivos (máximo 1)
- Responda APENAS com o texto da mensagem, sem aspas nem explicações
`;

  try {
    const result = await geminiFlashSales.generateContent(prompt);
    return result.response.text().trim();
  } catch {
    // Fallback manual se Gemini falhar
    if (disponivel) {
      return `${nomeLead ? `Oi ${nomeLead}! ` : "Oi! "}O ${carro} ainda está disponível por ${preco}. Ficou com alguma dúvida?`;
    }
    return `${nomeLead ? `Oi ${nomeLead}! ` : "Oi! "}Temos uma novidade que pode te interessar: ${alternativa}. Quer saber mais?`;
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agora = new Date();
  const limite24h = new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const limite7d = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Busca leads elegíveis para follow-up
  const { data: leads, error } = await supabaseAdmin
    .from("leads")
    .select(`
      id, wa_id, nome, user_id, veiculo_id, status,
      resumo_negociacao, ultimo_followup,
      config_garagem:user_id (nome_empresa, nome_agente, whatsapp, meta_phone_id, meta_access_token)
    `)
    .in("status", ["MORNO", "QUENTE"])
    .eq("em_atendimento_humano", false)
    .or(`ultimo_followup.is.null,ultimo_followup.lt.${limite7d}`);

  if (error) {
    console.error("❌ Cron followup — erro ao buscar leads:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!leads || leads.length === 0) {
    return NextResponse.json({ ok: true, processados: 0 });
  }

  let enviados = 0;
  let ignorados = 0;

  for (const lead of leads) {
    try {
      // Verifica última mensagem do lead
      const { data: ultimaMensagem } = await supabaseAdmin
        .from("mensagens")
        .select("created_at")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      // Ignora se última mensagem foi há menos de 24h
      if (ultimaMensagem?.created_at && ultimaMensagem.created_at > limite24h) {
        ignorados++;
        continue;
      }

      const garagem = Array.isArray(lead.config_garagem)
        ? lead.config_garagem[0]
        : lead.config_garagem;
      const nomeAgente = (garagem as any)?.nome_agente || "André";
      const nomeEmpresa = (garagem as any)?.nome_empresa || "a loja";
      const metaCreds = {
        phoneNumberId: (garagem as any)?.meta_phone_id ?? "",
        accessToken: (garagem as any)?.meta_access_token || process.env.META_ACCESS_TOKEN || "",
      };

      let carro = "veículo de interesse";
      let preco = "";
      let disponivel = false;
      let alternativa: string | undefined;

      // Verifica se o carro de interesse ainda está disponível
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
              // Tenta mesma categoria
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
              ignorados++;
              continue;
            }
          }
        }
      }

      // Gera mensagem personalizada
      const mensagem = await gerarMensagemFollowup({
        nomeLead: lead.nome,
        nomeAgente,
        nomeEmpresa,
        resumoNegociacao: lead.resumo_negociacao,
        carro,
        preco,
        disponivel,
        alternativa,
      });

      await sendMetaMessage(lead.wa_id, mensagem, metaCreds);

      // Salva mensagem no histórico
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

      console.log(`✅ Follow-up enviado para ${lead.wa_id} (lead ${lead.id})`);
      enviados++;

      // Pausa entre envios para não parecer spam
      await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      console.error(`❌ Erro no follow-up do lead ${lead.id}:`, e);
    }
  }

  console.log(`📊 Cron followup: ${enviados} enviados, ${ignorados} ignorados de ${leads.length} leads`);
  return NextResponse.json({ ok: true, enviados, ignorados, total: leads.length });
}
