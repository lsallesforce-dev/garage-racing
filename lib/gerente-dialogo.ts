// lib/gerente-dialogo.ts
// Conversa da Júlia (IA) com o GERENTE, que volta pra conversa com o CLIENTE.
//
// Os alertas ao gerente diziam "Responda a esta mensagem com a instrução para o
// agente continuar" — mas nada lia essa resposta: a mensagem do gerente caía no
// pipeline como se ele fosse um lead e morria em stand-by. Na APROVE (30 dias
// até 16/10), 11 de 13 pedidos de simulação ficaram sem resposta humana, e o
// cliente nunca sabia em que pé estava.
//
// Agora, quando o gerente escreve pro número da loja respondendo a uma
// pendência ("já passei", "ficha ruim", "ainda não tive tempo, faço à tarde",
// "pode dar 2 mil de desconto"), a Júlia:
//   1. descobre de qual cliente ele fala (o último alerta que ele recebeu, ou o
//      nome/telefone que ele citar, entre os clientes com pendência aberta);
//   2. entende o que ele disse (Gemini só LÊ — quem decide o que fazer é o código);
//   3. avisa o cliente quando faz sentido, com as palavras do gerente — nunca
//      inventa parcela, taxa ou aprovação;
//   4. grava uma nota interna no histórico do cliente e devolve a conversa pra IA;
//   5. confirma pro gerente o que foi feito.
// Mensagem que não é sobre cliente nenhum ("oi", "bom dia") segue o caminho antigo.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { geminiFlashSales, parseGeminiJson } from "@/lib/gemini";
import { getGerenteFoco, setGerenteFoco, invalidateHistory } from "@/lib/redis";
import { dentroJanela24h } from "@/lib/meta";

type Intencao = "ja_passou" | "reprovado" | "aprovado" | "adiado" | "instrucao" | "outro";

type Leitura = {
  cliente: number | null;
  intencao: Intencao;
  prazo: string | null;
  mensagem_cliente: string | null;
};

type Candidato = {
  id: string;
  wa_id: string;
  nome: string | null;
  instrucao_pendente: string;
  instrucao_pendente_desde: string | null;
  carro: string | null;
};

const SAUDACAO = /^\s*(oi+|ol[áa]|opa|bom dia|boa tarde|boa noite|blz|beleza|ok|👍|🙏)[\s!.,]*$/i;
const PRAZO_MAX_DIAS = 7;

function hBRT(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

/** Resumo da pendência sem dado pessoal (CPF/nascimento ficam fora do prompt e das mensagens). */
function pendenciaLimpa(instrucao: string): string {
  return instrucao
    .replace(/\s*·\s*CPF:[^·]*/gi, "")
    .replace(/\s*·\s*Nascimento:[^·]*/gi, "")
    .replace(/\s*·\s*\[Cobrança[\s\S]*$/, "")
    .slice(0, 160);
}

export async function lerMensagemDoGerente(texto: string, candidatos: Candidato[], focoIdx: number | null): Promise<Leitura | null> {
  const lista = candidatos.map((c, i) =>
    `${i}. ${c.nome || "sem nome"} (+${c.wa_id})${c.carro ? ` — ${c.carro}` : ""} — pendência: ${pendenciaLimpa(c.instrucao_pendente)}`,
  ).join("\n");
  const prompt = `Você é a assistente de uma revenda de carros e lê a mensagem que o GERENTE mandou no WhatsApp da loja.
Hoje é ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} (${new Date().toISOString()}).

Clientes com pendência aberta com o gerente:
${lista}
${focoIdx != null ? `O último aviso que o gerente recebeu foi sobre o cliente ${focoIdx}.` : ""}

Mensagem do gerente: "${texto}"

Responda SÓ com JSON:
{
  "cliente": número do cliente da lista de quem ele fala, ou null se não der pra saber (se ele não citar ninguém e houver "último aviso", use esse),
  "intencao": "ja_passou" (já mandou/ligou/passou a simulação ou já resolveu com o cliente) | "reprovado" (ficha ruim, não aprovou, score baixo, banco recusou) | "aprovado" (aprovou, passou condições) | "adiado" (ainda não teve tempo, vai fazer depois, amanhã, à tarde) | "instrucao" (manda a Júlia dizer/fazer algo pro cliente: desconto, valor, documento, horário) | "outro" (cumprimento, assunto que não é de cliente nenhum),
  "prazo": se "adiado" e ele disse quando, ISO8601 com -03:00 (à tarde = 14:00, fim do dia = 17:00, amanhã sem hora = 10:00 do dia seguinte); senão null,
  "mensagem_cliente": texto CURTO (máx. 2 frases) que a Júlia vai mandar ao cliente, em português informal e educado, SÓ para "reprovado", "aprovado", "adiado" ou "instrucao"; senão null
}

REGRAS da mensagem_cliente:
- Use SOMENTE o que o gerente disse. NUNCA invente parcela, taxa, valor, banco ou prazo que ele não falou.
- "reprovado": diga com delicadeza que o financiamento não foi aprovado nessas condições; só cite alternativa (entrada maior, outra pessoa na ficha) se o gerente citou.
- "aprovado": dê a notícia e repita as condições exatamente como ele escreveu, se ele escreveu.
- "adiado": diga que o especialista está finalizando a análise e retorna${" "}(cite o prazo se ele deu). Não diga que ele "não teve tempo".
- Não cite o nome do gerente, não diga que é uma IA.`;
  try {
    const r = await geminiFlashSales.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    });
    const j = parseGeminiJson(r.response.text());
    const intencoes: Intencao[] = ["ja_passou", "reprovado", "aprovado", "adiado", "instrucao", "outro"];
    if (!intencoes.includes(j?.intencao)) return null;
    const idx = Number.isInteger(j.cliente) && j.cliente >= 0 && j.cliente < candidatos.length ? j.cliente : null;
    return {
      cliente: idx,
      intencao: j.intencao,
      prazo: typeof j.prazo === "string" ? j.prazo : null,
      mensagem_cliente: typeof j.mensagem_cliente === "string" && j.mensagem_cliente.trim() ? j.mensagem_cliente.trim().slice(0, 400) : null,
    };
  } catch (e: any) {
    console.warn("⚠️ [gerente-dialogo] leitura falhou:", e?.message ?? e);
    return null;
  }
}

/**
 * Trata a mensagem do gerente. Devolve true se ela foi sobre um cliente e já
 * foi tratada aqui (o pipeline deve parar); false pra seguir o caminho antigo.
 */
export async function tratarMensagemDoGerente(p: {
  tenantUserId: string;
  texto: string;
  useAvisa: boolean;
  /** Envia texto (mesmo canal do tenant). */
  enviar: (to: string, text: string) => Promise<boolean>;
  gerentePhone: string;
}): Promise<boolean> {
  const texto = p.texto.trim();
  if (!texto || SAUDACAO.test(texto) || texto.startsWith("!")) return false;

  // Candidatos: clientes com pendência aberta nos últimos 3 dias.
  const desde = new Date(Date.now() - 72 * 3600_000).toISOString();
  const { data } = await supabaseAdmin
    .from("leads")
    .select("id, wa_id, nome, instrucao_pendente, instrucao_pendente_desde, veiculos(marca, modelo, ano)")
    .eq("user_id", p.tenantUserId)
    .not("instrucao_pendente", "is", null)
    .gte("instrucao_pendente_desde", desde)
    .order("instrucao_pendente_desde", { ascending: false })
    .limit(10);
  const candidatos: Candidato[] = (data ?? [])
    .filter((l: any) => l.wa_id && !String(l.wa_id).startsWith("ig:") && String(l.wa_id).replace(/\D/g, "") !== p.gerentePhone)
    .map((l: any) => {
      const v = Array.isArray(l.veiculos) ? l.veiculos[0] : l.veiculos;
      return {
        id: l.id, wa_id: l.wa_id, nome: l.nome, instrucao_pendente: String(l.instrucao_pendente),
        instrucao_pendente_desde: l.instrucao_pendente_desde,
        carro: v ? [v.marca, v.modelo, v.ano].filter(Boolean).join(" ") : null,
      };
    });
  if (!candidatos.length) return false;

  const foco = await getGerenteFoco(p.tenantUserId);
  const focoIdx = foco ? candidatos.findIndex((c) => String(c.wa_id).replace(/\D/g, "") === foco) : -1;

  const leitura = await lerMensagemDoGerente(texto, candidatos, focoIdx >= 0 ? focoIdx : null);
  if (!leitura || leitura.intencao === "outro") return false;

  if (leitura.cliente == null) {
    const nomes = candidatos.slice(0, 5).map((c, i) => `${i + 1}. ${c.nome || "+" + c.wa_id}${c.carro ? ` (${c.carro})` : ""}`).join("\n");
    await p.enviar(p.gerentePhone, `Não entendi de qual cliente você está falando. É algum destes?\n\n${nomes}\n\nResponde com o nome do cliente junto, que eu repasso.`);
    return true;
  }

  const c = candidatos[leitura.cliente];
  const quem = c.nome || `+${c.wa_id}`;
  const agora = new Date().toISOString();
  await setGerenteFoco(p.tenantUserId, c.wa_id);

  // Nota interna no histórico do cliente: aparece no painel e a IA lê na próxima
  // resposta. Não é enviada ao cliente.
  const nota = `[Nota interna — não enviada ao cliente] Gerente (${hBRT(agora)}): ${texto.slice(0, 300)}`;
  await supabaseAdmin.from("mensagens").insert({
    lead_id: c.id, content: nota, remetente: "agente", delivered: true,
  });

  // Avisa o cliente, quando há o que dizer e o canal deixa.
  let avisouCliente = false;
  let motivoNaoAvisou = "";
  if (leitura.mensagem_cliente && leitura.intencao !== "ja_passou") {
    const podeTextoLivre = p.useAvisa || (await dentroJanela24h(c.id));
    if (podeTextoLivre) {
      avisouCliente = await p.enviar(c.wa_id, leitura.mensagem_cliente);
      if (avisouCliente) {
        await supabaseAdmin.from("mensagens").insert({ lead_id: c.id, content: leitura.mensagem_cliente, remetente: "agente" });
      } else {
        motivoNaoAvisou = "o envio falhou";
      }
    } else {
      motivoNaoAvisou = "ele não fala com a loja há mais de 24h e o WhatsApp não deixa mandar mensagem livre";
    }
  }

  // Atualiza a pendência. O cron de cobrança só olha instrução que começa com
  // "Financiamento" — trocar o texto encerra a cobrança; "adiado" mantém e
  // empurra o relógio pro prazo que o gerente deu.
  const update: Record<string, any> = { em_atendimento_humano: false };
  if (leitura.intencao === "adiado") {
    const prazo = leitura.prazo ? new Date(leitura.prazo) : null;
    const prazoValido = prazo && !isNaN(prazo.getTime()) && prazo.getTime() > Date.now()
      && prazo.getTime() < Date.now() + PRAZO_MAX_DIAS * 86400_000;
    // instrucao_pendente_desde no FUTURO = a cobrança só volta 30 min depois do
    // prazo prometido (o cron mede o tempo a partir daqui).
    update.instrucao_pendente_desde = (prazoValido ? prazo! : new Date(Date.now() + 3 * 3600_000)).toISOString();
  } else {
    const resumo: Record<Exclude<Intencao, "adiado" | "outro">, string> = {
      // Começa com "Gerente:" de propósito: o cron de cobrança só pega instrução
      // que começa com "Financiamento" — essa não pode voltar a ser cobrada.
      ja_passou: "Gerente: já passou a simulação/retorno ao cliente.",
      reprovado: "Gerente: financiamento não aprovado.",
      aprovado: "Gerente: financiamento aprovado.",
      instrucao: "Gerente: passou instrução para o cliente.",
    };
    update.instrucao_pendente = `${resumo[leitura.intencao]} ${hBRT(agora)}: "${texto.slice(0, 200)}"`;
    update.instrucao_pendente_desde = agora;
  }
  await supabaseAdmin.from("leads").update(update).eq("id", c.id);
  // Fecha a cobrança aberta desse cliente (o gerente respondeu). No "adiado"
  // também: o ciclo recomeça do zero 30 min depois do prazo que ele deu.
  await supabaseAdmin.from("alertas_operacionais")
    .update({ resolvido_em: agora })
    .eq("lead_id", c.id).in("tipo", ["fin_cobranca_gerente", "fin_escalonado", "fin_pergunta_cliente"]).is("resolvido_em", null);
  await invalidateHistory(p.tenantUserId, c.id).catch(() => {});

  const feito: Record<Exclude<Intencao, "outro">, string> = {
    ja_passou: `✅ Anotado: você já passou o retorno pro ${quem}. Parei de cobrar.`,
    reprovado: `✅ Anotado: ficha do ${quem} não aprovada.`,
    aprovado: `✅ Anotado: financiamento do ${quem} aprovado.`,
    adiado: `✅ Combinado. Volto a te lembrar do ${quem} depois do prazo.`,
    instrucao: `✅ Anotado pro ${quem}.`,
  };
  const linhaCliente = avisouCliente
    ? `\n\nAvisei o cliente: "${leitura.mensagem_cliente}"`
    : motivoNaoAvisou
      ? `\n\n⚠️ Não consegui avisar o cliente: ${motivoNaoAvisou}. Melhor ligar: https://wa.me/${c.wa_id}`
      : "";
  await p.enviar(p.gerentePhone, feito[leitura.intencao] + linhaCliente);
  console.log(`🤝 [gerente-dialogo/${p.tenantUserId}] ${leitura.intencao} → lead ${c.id} (cliente avisado: ${avisouCliente})`);
  return true;
}
