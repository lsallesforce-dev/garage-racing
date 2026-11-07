// lib/gerente-acoes.ts
// Perguntas da Júlia ao gerente que esperam um sim/não — o lado "assistente"
// do diálogo gerente × agente.
//
// Antes os avisos eram monólogo: "cliente quer financiar, faça a simulação",
// "lead esperando há 3h". Agora o aviso OFERECE a ação e a Júlia executa no sim:
//   - simular_financiamento    "Consulto nos bancos?"          → iniciarSimulacao
//   - enviar_simulacao_cliente "Posso mandar pro cliente?"     → manda o texto pronto
//   - reabordar_lead           "Quer que eu retome a conversa?"→ worker reativar-lead
//
// Cada pergunta é uma linha em `gerente_acoes` (migration 075). A resposta chega
// pelo pipeline (process-whatsapp, passo 2c): botão da Cloud API vem como
// "acao:<id>:sim|nao"; no Avisa (ou fora da janela) o gerente responde "1"/"sim"
// e resolve a pergunta aberta MAIS RECENTE pra ele. A troca aberta→aceita é
// condicional: clique duplo não executa duas vezes.
//
// Falhou em gravar ou enviar a pergunta → devolve null e quem chamou segue o
// fluxo antigo (aviso simples). Nunca deixa o gerente sem o aviso.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage } from "@/lib/avisa";
import { sendMetaReplyButtons, sendMetaAlertaTemplate } from "@/lib/meta";
import { gerenteNaJanela, enfileirarAlertaGerente, invalidateHistory, setGerenteFoco } from "@/lib/redis";
import { qstash } from "@/lib/qstash";
import { carregarCanal, enviarCliente, ehAutoEnvio, normWa, type Canal } from "@/lib/canal-tenant";

export type TipoAcao = "simular_financiamento" | "enviar_simulacao_cliente" | "reabordar_lead";

type Acao = {
  id: string;
  user_id: string;
  lead_id: string | null;
  destinatario: string;
  tipo: TipoAcao;
  payload: any;
  status: string;
  expira_em: string;
};

const DICA_AVISA = "\n\nResponda *1* para sim ou *2* para não.";
// Só resposta CURTA vira sim/não: "pode dar 2 mil de desconto" é instrução
// (gerente-dialogo), não um "pode" pra pergunta aberta.
const SIM = /^\s*(1|sim|s|pode( sim| enviar| mandar| consultar| retomar| fazer)?|manda|mande|envia|envie|consulta|consulte|faz|faça|faca|bora|isso|quero|claro|retoma|retome|ok|okay|beleza|blz|👍)([\s,!.]+(sim|pode|por favor|pfv|obrigad[oa]|vlw|valeu|👍))*[\s!.]*$/i;
const NAO = /^\s*(2|n|n[aã]o|deixa( comigo)?|eu fa[cç]o|eu falo|eu mesmo|agora n[aã]o|negativo|👎)([\s,!.]+(obrigad[oa]|vlw|valeu|eu fa[cç]o|eu falo|deixa comigo|n[aã]o))*[\s!.]*$/i;

/**
 * Manda a pergunta e grava a ação. Devolve o id da ação ou null (aí quem chamou
 * manda o aviso no formato antigo).
 */
export async function perguntarAoGerente(p: {
  tenant: string;
  leadId: string | null;
  clientePhone: string;
  tipo: TipoAcao;
  payload: Record<string, any>;
  texto: string;
  /** [sim, não] — títulos dos botões na Cloud API (máx. 20 caracteres). */
  botoes: [string, string];
  /** Padrão: gerente de financiamento/gerente da loja. */
  destino?: string | null;
  canal?: Canal | null;
}): Promise<string | null> {
  const canal = p.canal ?? (await carregarCanal(p.tenant));
  if (!canal) return null;
  const destino = normWa(p.destino ?? canal.gerente);
  if (!destino || ehAutoEnvio(canal, destino)) return null;

  const { data: acao, error } = await supabaseAdmin
    .from("gerente_acoes")
    .insert({
      user_id: p.tenant, lead_id: p.leadId, destinatario: destino,
      tipo: p.tipo, payload: p.payload, texto: p.texto.slice(0, 4000),
    })
    .select("id")
    .single();
  if (error || !acao) {
    console.warn(`⚠️ [gerente-acoes] não gravou a pergunta (${p.tipo}): ${error?.message}`);
    return null;
  }

  let enviado = false;
  try {
    if (canal.useAvisa) {
      enviado = await sendAvisaMessage(destino, p.texto + DICA_AVISA, canal.avisa, { typing: false });
    } else if (await gerenteNaJanela(p.tenant)) {
      const botoes = [
        { id: `acao:${acao.id}:sim`, titulo: p.botoes[0] },
        { id: `acao:${acao.id}:nao`, titulo: p.botoes[1] },
      ];
      // Corpo de mensagem com botão tem teto de 1024: texto longo vai antes,
      // e o botão sai com a última linha (a pergunta).
      if (p.texto.length > 1000) {
        const { sendMetaMessage } = await import("@/lib/meta");
        await sendMetaMessage(destino, p.texto, canal.meta);
        await sendMetaReplyButtons(destino, "Como fica?", botoes, canal.meta);
      } else {
        await sendMetaReplyButtons(destino, p.texto, botoes, canal.meta);
      }
      enviado = true;
    } else {
      // Fora da janela: o modelo de alerta abre a conversa e a pergunta
      // completa entra na fila que despeja quando ele responder.
      await sendMetaAlertaTemplate(destino, canal.loja, p.texto, p.clientePhone, canal.meta);
      await enfileirarAlertaGerente(p.tenant, p.texto + DICA_AVISA, p.clientePhone);
      enviado = true;
    }
  } catch (e: any) {
    console.warn(`⚠️ [gerente-acoes] envio da pergunta falhou (${p.tipo}): ${e?.message ?? e}`);
  }
  if (!enviado) {
    await supabaseAdmin.from("gerente_acoes").update({ status: "falhou", resultado: "pergunta não entregue" }).eq("id", acao.id);
    return null;
  }
  if (p.clientePhone) await setGerenteFoco(p.tenant, p.clientePhone).catch(() => {});
  console.log(`❓ [gerente-acoes/${p.tenant}] ${p.tipo} → ${destino} (ação ${acao.id})`);
  return acao.id;
}

/**
 * Tenta tratar a mensagem do gerente como resposta a uma pergunta aberta.
 * Devolve true se tratou (o pipeline para); false pra seguir o fluxo.
 */
export async function responderAcao(p: {
  tenant: string;
  remetente: string;
  texto: string;
  responder: (texto: string) => Promise<unknown>;
}): Promise<boolean> {
  const texto = p.texto.trim();
  const remetente = normWa(p.remetente);
  if (!texto || !remetente) return false;

  let acao: Acao | null = null;
  let aceita: boolean;
  const botao = texto.match(/^acao:([0-9a-f-]{36}):(sim|nao)$/i);
  if (botao) {
    const { data } = await supabaseAdmin.from("gerente_acoes").select("*")
      .eq("id", botao[1]).eq("user_id", p.tenant).maybeSingle();
    acao = (data as Acao) ?? null;
    aceita = botao[2].toLowerCase() === "sim";
    if (!acao) { await p.responder("Essa pergunta não existe mais."); return true; }
    if (acao.status !== "aberta") {
      await p.responder(`Essa já foi resolvida (${acao.status}).`);
      return true;
    }
  } else {
    const ehSim = SIM.test(texto);
    const ehNao = !ehSim && NAO.test(texto);
    if (!ehSim && !ehNao) return false;
    aceita = ehSim;
    const { data } = await supabaseAdmin.from("gerente_acoes").select("*")
      .eq("user_id", p.tenant).eq("destinatario", remetente).eq("status", "aberta")
      .gt("expira_em", new Date().toISOString())
      .order("criado_em", { ascending: false }).limit(1);
    acao = (data?.[0] as Acao) ?? null;
    if (!acao) return false; // "ok"/"beleza" sem pergunta aberta → fluxo normal
  }
  if (new Date(acao.expira_em).getTime() < Date.now()) {
    await supabaseAdmin.from("gerente_acoes").update({ status: "expirada", resolvido_em: new Date().toISOString() }).eq("id", acao.id);
    await p.responder("Essa pergunta expirou (mais de 24h). Se ainda precisar, me pede de novo.");
    return true;
  }

  // Trava: só quem virar aberta→aceita/recusada executa.
  const { data: travou } = await supabaseAdmin.from("gerente_acoes")
    .update({ status: aceita ? "aceita" : "recusada", resolvido_em: new Date().toISOString() })
    .eq("id", acao.id).eq("status", "aberta").select("id");
  if (!travou?.length) { await p.responder("Já estou cuidando dessa. 👍"); return true; }

  const r = await executarAcao(acao, aceita).catch((e: any) => ({ ok: false, msg: `Deu erro aqui: ${String(e?.message ?? e).slice(0, 120)}` }));
  if (aceita) {
    await supabaseAdmin.from("gerente_acoes")
      .update({ status: r.ok ? "executada" : "falhou", resultado: r.msg.slice(0, 500) }).eq("id", acao.id);
  }
  await p.responder(r.msg);
  console.log(`🤝 [gerente-acoes/${p.tenant}] ${acao.tipo} ${aceita ? "aceita" : "recusada"} → ${r.ok ? "ok" : "falhou"}`);
  return true;
}

async function notaInterna(leadId: string, tenant: string, texto: string) {
  await supabaseAdmin.from("mensagens").insert({
    lead_id: leadId, content: `[Nota interna — não enviada ao cliente] ${texto}`, remetente: "agente", delivered: true,
  });
  await invalidateHistory(tenant, leadId).catch(() => {});
}

async function executarAcao(acao: Acao, aceita: boolean): Promise<{ ok: boolean; msg: string }> {
  const tenant = acao.user_id;
  const { data: lead } = acao.lead_id
    ? await supabaseAdmin.from("leads").select("id, wa_id, nome, em_atendimento_humano").eq("id", acao.lead_id).maybeSingle()
    : { data: null as any };
  if (!lead) return { ok: false, msg: "Não achei mais esse cliente." };
  const quem = lead.nome || `+${lead.wa_id}`;
  const pl = acao.payload ?? {};

  if (acao.tipo === "simular_financiamento") {
    if (!aceita) {
      await notaInterna(lead.id, tenant, "Gerente preferiu fazer a simulação ele mesmo.");
      return { ok: true, msg: `Ok, a simulação do ${quem} fica com você. Os dados estão no aviso acima.` };
    }
    const { iniciarSimulacao } = await import("@/lib/financiamento-simulacao");
    const sim = await iniciarSimulacao({
      tenant, leadId: lead.id, phone: lead.wa_id, veiculoId: pl.veiculoId, coleta: pl.coleta,
    });
    if (!sim.ok) {
      return { ok: false, msg: `⚠️ Não consegui consultar os bancos pro ${quem}: ${sim.motivo}.\nFaça a simulação manual — os dados estão no aviso acima.` };
    }
    const c = pl.coleta ?? {};
    await supabaseAdmin.from("leads").update({
      instrucao_pendente: `Financiamento — simulação automática em andamento (liberada pelo gerente). Entrada: ${c.entrada} · Nome: ${c.nome ?? "pedido ao cliente"} · CPF: ${c.cpf} · Nascimento: ${c.nascimento}`,
      instrucao_pendente_desde: new Date().toISOString(),
    }).eq("id", lead.id);
    await notaInterna(lead.id, tenant, "Gerente liberou a consulta nos bancos.");
    return { ok: true, msg: `🔎 Consultando os bancos pro ${quem}. Em alguns minutos te mando o resultado pra você aprovar antes de ir pro cliente.` };
  }

  if (acao.tipo === "enviar_simulacao_cliente") {
    if (!aceita) {
      await notaInterna(lead.id, tenant, "Gerente vai passar o resultado da simulação ele mesmo.");
      return { ok: true, msg: `Ok, não mandei nada pro ${quem}. Fica com você — a IA segue em stand-by nesse lead.` };
    }
    const canal = await carregarCanal(tenant);
    if (!canal) return { ok: false, msg: "Não achei a configuração da loja." };
    const texto = String(pl.texto ?? "");
    const ok = texto ? await enviarCliente(canal, lead.id, lead.wa_id, texto) : false;
    if (!ok) {
      return { ok: false, msg: `⚠️ Não consegui mandar pro ${quem} (sem conversa nas últimas 24h, o WhatsApp não deixa). Chama ele: https://wa.me/${lead.wa_id}` };
    }
    await supabaseAdmin.from("mensagens").insert({ lead_id: lead.id, content: texto, remetente: "agente" });
    await invalidateHistory(tenant, lead.id).catch(() => {});
    if (pl.simId) await supabaseAdmin.from("financiamento_simulacoes").update({ enviada_cliente: true }).eq("id", pl.simId);
    // "Simulação…" (não "Financiamento…") tira o lead do cron de cobrança.
    await supabaseAdmin.from("leads").update({
      instrucao_pendente: pl.aprovou
        ? `Simulação automática enviada ao cliente: ${pl.resumo}. Fechar o financiamento com ele.`
        : "Simulação sem aprovação — cliente avisado que o gerente vai chamar com outras opções.",
      instrucao_pendente_desde: new Date().toISOString(),
    }).eq("id", lead.id);
    await supabaseAdmin.from("alertas_operacionais").update({ resolvido_em: new Date().toISOString() })
      .eq("lead_id", lead.id).in("tipo", ["fin_cobranca_gerente", "fin_escalonado", "fin_pergunta_cliente"]).is("resolvido_em", null);
    return { ok: true, msg: `✅ Enviei pro ${quem}.${pl.aprovou ? " Agora é com você pra fechar — a IA segue em stand-by nesse lead." : ""}` };
  }

  if (acao.tipo === "reabordar_lead") {
    if (!aceita) {
      await notaInterna(lead.id, tenant, "Gerente vai responder o cliente ele mesmo (não quis a retomada pela IA).");
      return { ok: true, msg: `Ok, o ${quem} fica com você.` };
    }
    if (!lead.em_atendimento_humano) return { ok: true, msg: `O ${quem} já está com a IA — nada a fazer.` };
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital";
    await qstash.publishJSON({
      url: `${appUrl}/api/cron/reativar-lead`,
      body: { leadId: lead.id, tenantUserId: tenant },
      retries: 1,
    });
    await notaInterna(lead.id, tenant, "Gerente pediu pra IA retomar a conversa.");
    return { ok: true, msg: `🤖 Combinado, vou retomar a conversa com o ${quem} agora.` };
  }

  return { ok: false, msg: "Não sei fazer isso ainda." };
}
