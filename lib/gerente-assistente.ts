// lib/gerente-assistente.ts
// Pedidos livres do gerente (ou vendedor) pra Júlia, pelo WhatsApp da loja:
//   "qual o preço do Corolla 2022?"   → ficha curta do carro
//   "me manda as fotos da Hilux"      → fotos do carro pra ele
//   "como tá o João?"                 → situação do lead
//   "como foi hoje?"                  → resumo do dia
//   "chama o João de novo"            → IA retoma a conversa com o cliente
//
// O Gemini só CLASSIFICA (intenção + termo de busca); quem consulta o banco e
// responde é o código — a Júlia nunca inventa preço nem situação de cliente.
// Vendedor só enxerga os leads dele (leads.vendedor_id).

import { supabaseAdmin } from "@/lib/supabase-admin";
import { geminiFlashSales, parseGeminiJson } from "@/lib/gemini";
import { qstash } from "@/lib/qstash";

type Intencao = "info_carro" | "fotos_carro" | "status_lead" | "leads_hoje" | "reabordar" | "ajuda" | "outro";

export type Equipe = { papel: "gerente" | "vendedor"; vendedorId?: string | null; nome?: string | null };

const AJUDA =
  "Posso te ajudar com:\n" +
  "🚗 *Carro* — \"preço do Corolla 2022\", \"tem Hilux?\"\n" +
  "📸 *Fotos* — \"me manda as fotos do Compass\"\n" +
  "👤 *Cliente* — \"como tá o João?\" ou o telefone dele\n" +
  "📊 *Resumo* — \"como foi hoje?\"\n" +
  "🔁 *Retomar* — \"chama o João de novo\"\n" +
  "📅 *Agenda* — \"agenda visita amanhã 10h com o Pedro\"";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function classificar(texto: string): Promise<{ intencao: Intencao; busca: string | null } | null> {
  const prompt = `Você é a assistente de uma revenda de carros. Quem escreve é o GERENTE/VENDEDOR da loja (não um cliente).
Classifique o pedido dele. Mensagem: "${texto.slice(0, 500)}"

Responda SÓ com JSON: { "intencao": ..., "busca": ... }
- "info_carro": quer saber preço, km, ano, cor, se tem no estoque, dados de um carro. busca = carro citado (ex.: "corolla 2022 prata").
- "fotos_carro": quer que mande fotos/vídeo de um carro PRA ELE. busca = carro citado.
- "status_lead": pergunta como está um cliente, se respondeu, o que quer. busca = nome ou telefone do cliente.
- "leads_hoje": quer resumo/movimento do dia, quantos leads, quem está quente.
- "reabordar": pede pra IA chamar/retomar/reabordar um cliente. busca = nome ou telefone do cliente.
- "ajuda": pergunta o que você sabe fazer, "menu", "ajuda".
- "outro": qualquer outra coisa (cumprimento, recado, conversa, assunto pessoal).
busca = null quando não houver.`;
  try {
    const r = await geminiFlashSales.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    });
    const j = parseGeminiJson(r.response.text());
    const ok: Intencao[] = ["info_carro", "fotos_carro", "status_lead", "leads_hoje", "reabordar", "ajuda", "outro"];
    if (!ok.includes(j?.intencao)) return null;
    return { intencao: j.intencao, busca: typeof j.busca === "string" && j.busca.trim() ? j.busca.trim().slice(0, 80) : null };
  } catch (e: any) {
    console.warn("⚠️ [gerente-assistente] classificação falhou:", e?.message ?? e);
    return null;
  }
}

type Carro = {
  id: string; marca: string | null; modelo: string | null; versao: string | null; ano: number | null; ano_modelo: number | null;
  preco_sugerido: number | null; quilometragem_estimada: number | null; cor: string | null; placa: string | null;
  fotos: string[] | null; capa_marketing_url: string | null;
};

async function acharCarros(tenant: string, busca: string): Promise<Carro[]> {
  const { data } = await supabaseAdmin
    .from("veiculos")
    .select("id, marca, modelo, versao, ano, ano_modelo, preco_sugerido, quilometragem_estimada, cor, placa, fotos, capa_marketing_url")
    .eq("user_id", tenant)
    .eq("status_venda", "DISPONIVEL")
    .limit(1000);
  const tokens = semAcento(busca).split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  if (!tokens.length) return [];
  const pontuados = (data as Carro[] ?? []).map((v) => {
    const alvo = semAcento([v.marca, v.modelo, v.versao, v.cor, v.placa].filter(Boolean).join(" "));
    let pts = 0;
    for (const t of tokens) {
      if (/^\d{4}$/.test(t)) { if (String(v.ano) === t || String(v.ano_modelo) === t) pts += 3; continue; }
      if (/^\d{2}$/.test(t)) { if (String(v.ano).endsWith(t) || String(v.ano_modelo).endsWith(t)) pts += 1; continue; }
      if (new RegExp(`\\b${t}`).test(alvo)) pts += 2;
    }
    return { v, pts };
  }).filter((x) => x.pts >= 2);
  const max = Math.max(0, ...pontuados.map((x) => x.pts));
  return pontuados.filter((x) => x.pts === max).sort((a, b) => Number(a.v.preco_sugerido ?? 0) - Number(b.v.preco_sugerido ?? 0)).map((x) => x.v);
}

function fichaCarro(v: Carro): string {
  const ano = v.ano && v.ano_modelo && v.ano !== v.ano_modelo ? `${v.ano}/${v.ano_modelo}` : String(v.ano_modelo ?? v.ano ?? "");
  return `🚗 *${[v.marca, v.modelo, v.versao].filter(Boolean).join(" ")}* ${ano}\n` +
    `💰 ${v.preco_sugerido ? brl(Number(v.preco_sugerido)) : "sem preço"}` +
    `${v.quilometragem_estimada ? ` · ${Number(v.quilometragem_estimada).toLocaleString("pt-BR")} km` : ""}` +
    `${v.cor ? ` · ${v.cor}` : ""}${v.placa ? ` · ${v.placa}` : ""}` +
    ` · ${(v.fotos?.length ?? 0)} foto(s)`;
}

type LeadRow = {
  id: string; wa_id: string; nome: string | null; status: string | null; resumo_negociacao: string | null;
  em_atendimento_humano: boolean | null; instrucao_pendente: string | null; updated_at: string | null;
  veiculos: any;
};

async function acharLeads(tenant: string, busca: string, eq: Equipe): Promise<LeadRow[]> {
  const digitos = busca.replace(/\D/g, "");
  let q = supabaseAdmin
    .from("leads")
    .select("id, wa_id, nome, status, resumo_negociacao, em_atendimento_humano, instrucao_pendente, updated_at, veiculos(marca, modelo, ano)")
    .eq("user_id", tenant)
    .order("updated_at", { ascending: false })
    .limit(5);
  if (eq.papel === "vendedor" && eq.vendedorId) q = q.eq("vendedor_id", eq.vendedorId);
  q = digitos.length >= 8 ? q.like("wa_id", `%${digitos.slice(-8)}%`) : q.ilike("nome", `%${busca.replace(/[%_,()]/g, "")}%`);
  const { data } = await q;
  return (data as LeadRow[]) ?? [];
}

function pendenciaLimpa(s: string): string {
  return s.replace(/\s*·\s*CPF:[^·]*/gi, "").replace(/\s*·\s*Nascimento:[^·]*/gi, "").replace(/\s*·\s*\[Cobrança[\s\S]*$/, "").slice(0, 200);
}

function quando(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

async function fichaLead(l: LeadRow): Promise<string> {
  const v = Array.isArray(l.veiculos) ? l.veiculos[0] : l.veiculos;
  const { data: ult } = await supabaseAdmin
    .from("mensagens").select("content, remetente, created_at")
    .eq("lead_id", l.id).not("content", "like", "[Nota interna%")
    .order("created_at", { ascending: false }).limit(1);
  const u = ult?.[0];
  const link = /^(ig|fb):/.test(l.wa_id) ? `https://www.autozap.digital/chat?wa_id=${encodeURIComponent(l.wa_id)}` : `https://wa.me/${l.wa_id}`;
  return `👤 *${l.nome || "Sem nome"}* (+${l.wa_id})\n` +
    `🌡️ ${l.status ?? "-"} · ${l.em_atendimento_humano ? "🙋 com humano (IA em stand-by)" : "🤖 com a IA"}` +
    `${v ? `\n🚗 ${[v.marca, v.modelo, v.ano].filter(Boolean).join(" ")}` : ""}` +
    `${l.resumo_negociacao ? `\n📝 ${String(l.resumo_negociacao).slice(0, 200)}` : ""}` +
    `${l.instrucao_pendente ? `\n⏳ ${pendenciaLimpa(l.instrucao_pendente)}` : ""}` +
    `${u ? `\n💬 Última (${u.remetente === "user" ? "cliente" : "loja"}, ${quando(u.created_at)}): "${String(u.content).slice(0, 140)}"` : ""}` +
    `\n🔗 ${link}`;
}

async function resumoDoDia(tenant: string, eq: Equipe): Promise<string> {
  const hojeBrt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const inicio = new Date(`${hojeBrt}T00:00:00-03:00`).toISOString();
  const base = () => {
    let q = supabaseAdmin.from("leads").select("id, nome, wa_id, status, em_atendimento_humano", { count: "exact" }).eq("user_id", tenant);
    if (eq.papel === "vendedor" && eq.vendedorId) q = q.eq("vendedor_id", eq.vendedorId);
    return q;
  };
  const [novos, ativos, quentes, humanos, fin] = await Promise.all([
    base().gte("created_at", inicio).limit(1),
    base().gte("updated_at", inicio).limit(1),
    base().gte("updated_at", inicio).eq("status", "QUENTE").order("updated_at", { ascending: false }).limit(5),
    base().eq("em_atendimento_humano", true).gte("updated_at", new Date(Date.now() - 48 * 3600_000).toISOString()).limit(1),
    base().like("instrucao_pendente", "Financiamento%").gte("instrucao_pendente_desde", new Date(Date.now() - 72 * 3600_000).toISOString()).limit(1),
  ]);
  const listaQuentes = (quentes.data ?? []).map((l: any) => `• ${l.nome || "+" + l.wa_id}`).join("\n");
  return `📊 *Hoje${eq.papel === "vendedor" ? " (seus leads)" : ""}*\n\n` +
    `🆕 Leads novos: ${novos.count ?? 0}\n💬 Conversas ativas: ${ativos.count ?? 0}\n🔥 Quentes: ${quentes.count ?? 0}` +
    `${listaQuentes ? `\n${listaQuentes}` : ""}` +
    `\n🙋 Com humano (48h): ${humanos.count ?? 0}\n💳 Financiamentos pendentes: ${fin.count ?? 0}` +
    `\n\nPergunta de um cliente pelo nome que eu te conto como está.`;
}

/**
 * Trata um pedido livre do gerente/vendedor. Devolve true se respondeu;
 * false pra seguir o fluxo antigo (mensagem que não é pedido).
 */
export async function atenderGerente(p: {
  tenant: string;
  texto: string;
  equipe: Equipe;
  responder: (texto: string) => Promise<unknown>;
  enviarImagem: (url: string, legenda?: string) => Promise<boolean>;
}): Promise<boolean> {
  const texto = p.texto.trim();
  if (!texto || texto.startsWith("!") || texto.length > 600) return false;
  const c = await classificar(texto);
  if (!c || c.intencao === "outro") return false;

  if (c.intencao === "ajuda") { await p.responder(AJUDA); return true; }
  if (c.intencao === "leads_hoje") { await p.responder(await resumoDoDia(p.tenant, p.equipe)); return true; }

  if (c.intencao === "info_carro" || c.intencao === "fotos_carro") {
    if (!c.busca) { await p.responder("Qual carro? Me fala o modelo (e o ano, se tiver mais de um)."); return true; }
    const carros = await acharCarros(p.tenant, c.busca);
    if (!carros.length) { await p.responder(`Não achei "${c.busca}" no estoque disponível.`); return true; }
    if (c.intencao === "info_carro") {
      const extra = carros.length > 5 ? `\n\n…e mais ${carros.length - 5}. Me fala o ano ou a cor pra filtrar.` : "";
      await p.responder(carros.slice(0, 5).map(fichaCarro).join("\n\n") + extra);
      return true;
    }
    if (carros.length > 1) {
      await p.responder(`Achei ${carros.length}. De qual você quer as fotos?\n\n${carros.slice(0, 5).map(fichaCarro).join("\n\n")}`);
      return true;
    }
    const v = carros[0];
    const fotos = (v.fotos ?? []).filter(Boolean).slice(0, 15);
    if (!fotos.length) { await p.responder(`O ${v.marca} ${v.modelo} ainda não tem foto cadastrada.`); return true; }
    let enviadas = 0;
    for (const [i, url] of fotos.entries()) {
      if (await p.enviarImagem(url, i === 0 ? fichaCarro(v).replace(/\*/g, "") : undefined)) enviadas++;
    }
    if (!enviadas) await p.responder("⚠️ Não consegui enviar as fotos agora. Tenta de novo em instantes.");
    return true;
  }

  if (c.intencao === "status_lead" || c.intencao === "reabordar") {
    if (!c.busca) { await p.responder("Qual cliente? Me fala o nome ou o telefone."); return true; }
    const leads = await acharLeads(p.tenant, c.busca, p.equipe);
    if (!leads.length) { await p.responder(`Não achei cliente "${c.busca}"${p.equipe.papel === "vendedor" ? " entre os seus leads" : ""}.`); return true; }
    if (leads.length > 1 && c.intencao === "reabordar") {
      await p.responder(`Achei ${leads.length} com esse nome. Qual deles? Me manda o telefone:\n\n${leads.map((l) => `• ${l.nome || "-"} +${l.wa_id}`).join("\n")}`);
      return true;
    }
    if (c.intencao === "status_lead") {
      const fichas = await Promise.all(leads.slice(0, 3).map(fichaLead));
      await p.responder(fichas.join("\n\n"));
      return true;
    }
    const l = leads[0];
    if (!l.em_atendimento_humano) { await p.responder(`O ${l.nome || "+" + l.wa_id} já está com a IA — ela responde quando ele escrever.`); return true; }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital";
    await qstash.publishJSON({ url: `${appUrl}/api/cron/reativar-lead`, body: { leadId: l.id, tenantUserId: p.tenant }, retries: 1 });
    await supabaseAdmin.from("mensagens").insert({
      lead_id: l.id, content: `[Nota interna — não enviada ao cliente] ${p.equipe.papel === "vendedor" ? "Vendedor" : "Gerente"} pediu pra IA retomar a conversa.`,
      remetente: "agente", delivered: true,
    });
    await p.responder(`🤖 Combinado, vou retomar a conversa com o ${l.nome || "+" + l.wa_id} agora.`);
    return true;
  }
  return false;
}
