// app/api/webhook/prospeccao/route.ts
// =============================================================================
// AutoZap — Webhook de respostas da PROSPECÇÃO B2B
// =============================================================================
// Recebe as respostas das REVENDAS (prospects) na instância Avisa SEPARADA da
// AutoZap (não a dos tenants). Faz parsing do payload Avisa (mesmo shape do
// webhook existente em app/api/webhook/avisa/route.ts), acha o prospect, salva
// a mensagem, e — se não estiver em stand-by humano — gera e envia a resposta
// do agente vendedor via Gemini.
//
// SEGURANÇA: protegido por AUTOZAP_PROSPECCAO_WEBHOOK_TOKEN (na URL ?token= ou
// header Authorization: Bearer / x-webhook-token). NUNCA fail-open: se o token
// não estiver configurado no ambiente, retorna 401 (regra do CLAUDE.md).
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { bolhasParaLinhas } from "@/lib/prospeccao-historico";
import { sendAvisaMessage, sendAvisaImage, sendAvisaVideo, extractWebhookToken } from "@/lib/avisa";
import { gerarRespostaProspeccao, carregarPatioDemo, carregarLojaDemo } from "@/lib/process-prospeccao";
import { montarAbertura } from "@/lib/prospeccao-abertura";
import { bumpStats } from "@/lib/prospeccao-stats";
import { baixarAudioWhatsApp } from "@/lib/whatsapp-audio";
import { transcreverAudioCliente } from "@/lib/transcribe";
import type { Prospect, ProspectMensagem } from "@/lib/prospeccao-types";

// Espera antes de responder, pra deixar uma rajada se acomodar. Curto de
// propósito: é a latência que o prospect sente, e bot dispara tudo em ~1s.
// 2500 era curto demais pra como lojista digita. Caso real (André Moi, 14/08):
// "OK" 18:52:52 e "OBRIGADO" 18:52:56 — 4s de intervalo, duas execuções em
// paralelo: uma se despediu ("Sucesso aí com a loja") e a outra, que já estava
// no ar, emendou mais um argumento de venda DEPOIS da despedida. 8s cobre a
// pausa natural entre duas mensagens da mesma ideia sem deixar a resposta lenta.
const COALESCE_MS = 8000;

// Teto de imagens por pedido de foto. 4 = o álbum típico de revenda
// (frente, lateral, traseira, interior) sem virar rajada.
const MAX_FOTOS_POR_CARRO = 4;

// Teto de bolhas numa resposta comum. O modelo respondia "tá bom esse Corolla?"
// com SEIS mensagens seguidas — vira metralhadora e cansa. A lista do pátio é
// exceção e entra depois deste corte.
const MAX_BOLHAS_RESPOSTA = 3;

// Teto do turno INTEIRO (resposta + lista do pátio). Listar é 1 intro + 5 carros;
// acima disso vira rajada, e rajada é o que o WhatsApp pontua como spam.
const MAX_MENSAGENS_TURNO = 6;

// Ela ofereceu foto ("quer ver umas fotos dele?") E mandou as 4 na mesma
// resposta, sem esperar o sim. Ou pergunta, ou manda: se a própria resposta
// está oferecendo, a foto espera a confirmação.
const OFERTA_DE_MIDIA = /\b(quer|gostaria|posso)\b[^?]{0,40}\b(ver|mandar?|enviar|mando)\b[^?]{0,30}\b(fotos?|v[íi]deo)\b[^?]{0,20}\?/i;

export const maxDuration = 300;

// ─── Credenciais da instância Avisa da AutoZap (não dos tenants) ──────────────
function autozapAvisaCreds(): { baseUrl: string; token: string } | null {
  const baseUrl = process.env.AUTOZAP_AVISA_BASE_URL;
  const token = process.env.AUTOZAP_AVISA_TOKEN;
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

// ─── Verificação do token do webhook (timing-safe, nunca fail-open) ──────────
function verifyWebhookToken(req: NextRequest, payloadToken?: string | null): boolean {
  // Normaliza: aceita token puro OU uma URL colada por engano na env (extrai o token).
  const configured = extractWebhookToken(process.env.AUTOZAP_PROSPECCAO_WEBHOOK_TOKEN);
  // Fail-closed: sem token configurado, ninguém entra.
  if (!configured) {
    console.warn("⛔ [prospeccao webhook] AUTOZAP_PROSPECCAO_WEBHOOK_TOKEN não configurado — rejeitando.");
    return false;
  }

  const provided = extractWebhookToken(
    req.nextUrl.searchParams.get("token") ||
    req.headers.get("x-webhook-token") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    payloadToken ||
    "",
  );

  if (!provided) return false;

  const a = Buffer.from(configured, "utf8");
  const b = Buffer.from(provided, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ─── Normalização de telefone (espelha lib/avisa.ts formatPhone) ──────────────
function normalizePhone(phone: string): string {
  const withoutDevice = (phone || "").split(":")[0];
  let cleaned = withoutDevice.replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = cleaned.slice(1);
  if (cleaned.length === 10 || cleaned.length === 11) cleaned = "55" + cleaned;
  return cleaned;
}

// ─── Detecção de autoreply (robô do WhatsApp Business do prospect) ────────────
// Muitas revendas têm resposta automática ("agradecemos seu contato, como podemos
// ajudar?"). Isso NÃO é uma pessoa: responder a máquina desperdiça a 1ª impressão
// da Mari e arrisca loop bot×bot. Quando casa um destes padrões, o webhook salva
// a mensagem mas NÃO gera resposta — espera um humano real (ou o follow-up do cron).
// Padrões de ALTA precisão pra não classificar resposta humana real como autoreply.
const AUTOREPLY_PATTERNS: RegExp[] = [
  /agrade(?:ce|cemos|ço|cermos)\b[\s\S]{0,40}\bcontato/i,
  /obrigad[oa]\b[\s\S]{0,30}\b(?:contato|mensagem)/i,
  /retorn(?:aremos|arei|aremos o seu)\b/i,
  /assim que poss[íi]vel/i,
  /hor[áa]rio de (?:atendimento|funcionamento)/i,
  /(?:mensagem|resposta) autom[áa]tica/i,
  /como podemos (?:te |lhe )?ajudar/i,
  /em breve[\s\S]{0,30}\b(?:retorn|respond|contato|atend)/i,
  /um de nossos (?:atendentes|consultores|vendedores|colaboradores)/i,
  /seja bem[\s-]?vind/i,
  /seu contato (?:é|e) (?:muito )?importante/i,
  /aguarde[\s\S]{0,20}(?:retorn|atend|momento)/i,
];

// ─── Handoff porque caiu num robô ─────────────────────────────────────────────
// Diferente de todo outro handoff: aqui não há humano do outro lado esperando,
// então a IA precisa CALAR, não seguir conversando até alguém assumir.
// Olha tanto o motivo que o modelo deu quanto a própria fala de despedida que o
// prompt manda usar ("caí no atendimento automático de vocês").
// `\b` no fim não serve: o word-boundary do JS é ASCII e "robô" termina em "ô",
// que ele não considera letra — /\brob[ôo]\b/ NUNCA casa "robô". Usa lookahead
// unicode no lugar.
const HANDOFF_POR_ROBO =
  /\b(?:rob[ôo]|bot|atendimento autom[áa]tico|autoreply|resposta autom[áa]tica|IA da loja|outra IA)(?!\p{L})/iu;

function ehHandoffPorRobo(motivo: string | null | undefined, resposta: string): boolean {
  return HANDOFF_POR_ROBO.test(`${motivo ?? ""} ${resposta ?? ""}`);
}

function pareceAutoreply(text: string): boolean {
  const t = (text || "").trim();
  if (t.length < 6) return false;
  return AUTOREPLY_PATTERNS.some((re) => re.test(t));
}

// ─── Adiamento × recusa definitiva ────────────────────────────────────────────
// O Gemini erra essa classificação: mesmo com "depois eu vejo" listado como
// adiamento no prompt, ele marcava opt_out — e opt_out tira o contato da base
// PRA SEMPRE (cron e rodada nova filtram por ele). Como o custo do erro é
// assimétrico (perder um lojista que só estava ocupado vs. esperar 90 dias),
// a decisão passa a ser determinística aqui.
const ADIAMENTO_PATTERNS: RegExp[] = [
  /\bdepois\s+(?:eu\s+)?(?:vejo|olho|te\s+falo|a\s+gente\s+v[êe]|vemos)\b/i,
  /\bmais\s+pra\s+frente\b/i,
  /\b(?:semana|m[êe]s)\s+que\s+vem\b/i,
  /\boutro\s+dia\b/i,
  /\bsem\s+tempo\b/i,
  /\b(?:t[oô]|estou)\s+ocupad/i,
  /\b(?:agora|hoje)\s+n[ãa]o\s*(?:d[áa])?\b/i,
  /\bme\s+chama\s+(?:depois|outro|semana|m[êe]s)/i,
];

// Se QUALQUER um destes aparecer, é não de verdade — vence o adiamento.
const RECUSA_FORTE_PATTERNS: RegExp[] = [
  /\bn[ãa]o\s+(?:tenho|há|ha)\s+interesse\b/i,
  /\bn[ãa]o\s+me\s+interessa\b/i,
  /\bj[áa]\s+(?:tenho|uso|trabalho\s+com)\b/i,
  /\bn[ãa]o\s+(?:quero|preciso|uso)\b/i,
  /\b(?:tira|remove)\s+meu\s+n[úu]mero\b/i,
  /\bn[ãa]o\s+(?:me\s+)?mand[ae]\b/i,
  /\bpar[ae]\s+de\s+(?:me\s+)?mandar\b/i,
  /\bdescadastr/i,
];

function ehRecusaForte(text: string): boolean {
  return RECUSA_FORTE_PATTERNS.some((re) => re.test((text || "").trim()));
}

function ehAdiamento(text: string): boolean {
  const t = (text || "").trim();
  if (ehRecusaForte(t)) return false;
  return ADIAMENTO_PATTERNS.some((re) => re.test(t));
}

/**
 * Decide o destino de um encerramento. Só roda quando o modelo já resolveu
 * encerrar (opt_out OU adiou) — nunca transforma uma conversa viva em saída,
 * porque "não tenho interesse NESSE carro" não é recusa da campanha.
 * A recusa forte vence sempre: "não tenho interesse, me chama depois" sai da
 * base, mesmo que o modelo tenha lido só o "me chama depois".
 */
function destinoDoEncerramento(r: { opt_out: boolean; adiou: boolean }, text: string):
  "opt_out" | "adiou" | null {
  if (!r.opt_out && !r.adiou) return null;
  if (ehRecusaForte(text)) return "opt_out";
  if (ehAdiamento(text)) return "adiou";
  return r.opt_out ? "opt_out" : "adiou";
}

// ─── Quebra a resposta em BOLHAS curtas (no máx ~2 linhas cada) ───────────────
// Não depende de o Gemini formatar: pica por linha em branco -> frase -> vírgula
// e reagrupa em pedaços de no máximo MAX chars. Cada pedaço vira uma mensagem
// separada no WhatsApp (igual gente digitando "manda um pedaço, manda outro").
function quebrarEmBolhas(texto: string, MAX = 90): string[] {
  const MIN_BOLHA = 32;

  // Uma LINHA por si só já é uma bolha. Quando o Gemini lista (um carro por
  // linha), respeitar a quebra é o comportamento certo — antes o split só
  // conhecia linha em branco, frase e vírgula, e uma lista sem ponto final
  // entre os itens saía inteira numa bolha só, estourando o MAX sem ter onde
  // cortar. Linhas NÃO são reagrupadas entre si: a lista morreria de novo.
  const linhas = (texto || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const ehLista = linhas.length > 1;

  const out: string[] = [];
  for (const linha of linhas) {
    if (linha.length <= MAX) {
      out.push(linha);
      continue;
    }
    // Linha comprida: pica por frase e, se ainda estourar, por vírgula —
    // reagrupando até MAX (só DENTRO da linha).
    const unidades = linha
      .split(/(?<=[.!?])\s+/)
      .flatMap((f) => (f.length <= MAX ? [f] : f.split(/(?<=[,;])\s+/)))
      .map((u) => u.trim())
      .filter(Boolean);
    let atual = "";
    for (const u of unidades) {
      const cand = atual ? `${atual} ${u}` : u;
      if (cand.length <= MAX) atual = cand;
      else {
        if (atual) out.push(atual.trim());
        atual = u;
      }
    }
    if (atual) out.push(atual.trim());
  }

  let limpo = out.map((b) => b.trim()).filter(Boolean);

  // Costura bolha ÓRFÃ de volta na anterior — o preço saía sozinho ("...100 mil
  // km," | "por R$ 82.000."). Não vale em lista: ali as bolhas curtas são os
  // próprios itens, e juntá-las desfaria a lista.
  if (!ehLista) {
    limpo = limpo.reduce<string[]>((acc, b) => {
      const anterior = acc[acc.length - 1];
      if (anterior && b.length < MIN_BOLHA && `${anterior} ${b}`.length <= MAX + MIN_BOLHA) {
        acc[acc.length - 1] = `${anterior} ${b}`;
        return acc;
      }
      acc.push(b);
      return acc;
    }, []);
  }

  // Teto maior que 6: listar 5 carros + a frase de abertura já são 6 bolhas, e
  // o corte antigo comia o último item da lista.
  return (limpo.length ? limpo : [(texto || "").trim()]).filter(Boolean).slice(0, 8);
}

// ─── Extração de campos do payload Avisa (subset do webhook existente) ────────
function extractFields(payload: any): {
  phone: string;
  text: string;
  fromMe: boolean;
  messageId: string | null;
  audioUrl?: string;
  audioMediaKey?: string;
} {
  let parsedData: any = payload;
  if (payload?.jsonData) {
    try {
      parsedData = typeof payload.jsonData === "string" ? JSON.parse(payload.jsonData) : payload.jsonData;
    } catch {}
  }
  if (!parsedData) return { phone: "", text: "", fromMe: true, messageId: null };

  // Formato Baileys (event.Info / event.Message)
  if (parsedData?.event?.Info) {
    const info = parsedData.event.Info;
    const msg = parsedData.event.Message;
    if (parsedData.type !== "Message") return { phone: "", text: "", fromMe: true, messageId: null };
    if (info.Chat === "status@broadcast") return { phone: "", text: "", fromMe: true, messageId: null };

    const fromMe = info.IsFromMe ?? false;
    // Prioriza o JID real (@s.whatsapp.net) sobre o LID.
    const candidates = [info.Sender || "", info.SenderAlt || ""];
    const realJid = candidates.find((j: string) => j.endsWith("@s.whatsapp.net"));
    const phone = (realJid || info.Sender || "").replace(/@.*$/, "");
    const text = msg?.conversation || msg?.extendedTextMessage?.text || "";
    // Áudio: o lojista responde por voz o tempo todo. Sem isso a Mari ficava muda.
    const audioUrl = msg?.audioMessage?.URL ?? msg?.audioMessage?.url;
    const audioMediaKey = msg?.audioMessage?.mediaKey ?? msg?.audioMessage?.MediaKey;
    return { phone, text: (text || "").trim(), fromMe, messageId: info.ID ?? null, audioUrl, audioMediaKey };
  }

  // Formato Avisa/Z-API simplificado (number/phone + message/text)
  if (parsedData?.number || parsedData?.phone) {
    const phone = (parsedData.number || parsedData.phone || "").replace(/@.*$/, "");
    const text = parsedData.message || parsedData.text?.message || parsedData.body || "";
    const fromMe = parsedData.isGroup || parsedData.fromMe || false;
    const messageId = parsedData.messageId || parsedData.id || parsedData.text?.messageId || null;
    const audioUrl = parsedData.audio?.audioUrl || parsedData.audioUrl;
    const audioMediaKey = parsedData.audio?.mediaKey || parsedData.audioMediaKey;
    return { phone, text: (text || "").trim(), fromMe, messageId, audioUrl, audioMediaKey };
  }

  // Formato Evolution API (data.key.remoteJid)
  if (parsedData?.data?.key?.remoteJid) {
    const key = parsedData.data.key;
    const msg = parsedData.data.message;
    const phone = (key.remoteJid || "").replace(/@.*$/, "");
    const text = msg?.conversation || msg?.extendedTextMessage?.text || "";
    const audioUrl = msg?.audioMessage?.URL ?? msg?.audioMessage?.url;
    const audioMediaKey = msg?.audioMessage?.mediaKey ?? msg?.audioMessage?.MediaKey;
    return { phone, text: (text || "").trim(), fromMe: key.fromMe || false, messageId: key.id ?? null, audioUrl, audioMediaKey };
  }

  return { phone: "", text: "", fromMe: true, messageId: null };
}

// ─── Alerta de handoff para o dono (via Avisa, se configurado) ────────────────
async function alertarHandoff(prospect: Prospect, motivo: string | null) {
  const alvo = process.env.AUTOZAP_ALERT_WHATSAPP;
  const corpo = `🔔 Handoff de prospecção\n\nRevenda: ${prospect.nome_empresa}\nTelefone: ${prospect.telefone ?? prospect.wa_id ?? "-"}\nMotivo: ${motivo ?? "esquentou"}\n\nAssuma a conversa pelo Inbox da aba Vendas.`;
  if (!alvo) {
    console.log(`🔔 [prospeccao] Handoff (sem AUTOZAP_ALERT_WHATSAPP): ${prospect.nome_empresa} — ${motivo ?? ""}`);
    return;
  }
  const creds = autozapAvisaCreds();
  if (!creds) {
    console.warn("⚠️ [prospeccao] Alerta de handoff não enviado — credenciais AUTOZAP_AVISA_* ausentes.");
    return;
  }
  try {
    await sendAvisaMessage(alvo, corpo, creds, { typing: false });
  } catch (err) {
    console.warn("⚠️ [prospeccao] Falha ao enviar alerta de handoff:", err);
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // ── Parse do payload (JSON / form-urlencoded / jsonData=) ───────────────────
  let payload: any = {};
  const contentType = req.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      payload = Object.fromEntries(formData.entries());
    } else {
      const textBody = await req.text();
      try {
        payload = textBody ? JSON.parse(textBody) : {};
      } catch {
        if (textBody.includes("jsonData=")) {
          payload = Object.fromEntries(new URLSearchParams(textBody).entries());
        } else {
          payload = { rawText: textBody };
        }
      }
    }
  } catch {
    payload = {};
  }

  // ── Gate de segurança (NUNCA fail-open) ─────────────────────────────────────
  if (!verifyWebhookToken(req, payload?.token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── Extração + filtros básicos ──────────────────────────────────────────────
  const { phone, text: textoRecebido, fromMe, messageId, audioUrl, audioMediaKey } = extractFields(payload);
  let text = textoRecebido;

  // Ignora ecos (fromMe).
  if (fromMe) return NextResponse.json({ status: "ignored_from_me" });
  if (!phone) return NextResponse.json({ status: "empty_content" });

  // ── Áudio → texto ───────────────────────────────────────────────────────────
  // Lojista responde por voz o tempo todo. Antes, áudio caía em "empty_content"
  // e a Mari simplesmente não respondia — na campanha isso seria perder o lead
  // sem nem saber. Mesmo ASR do agente B2C (OpenAI, fallback Gemini).
  if (!text && audioUrl) {
    const buf = await baixarAudioWhatsApp(audioUrl, audioMediaKey);
    if (buf) {
      text = (await transcreverAudioCliente(buf, "audio/ogg; codecs=opus")).trim();
      if (text) console.log(`🎤 [prospeccao] Áudio transcrito: "${text.slice(0, 80)}"`);
    }
    if (!text) {
      console.warn("⚠️ [prospeccao] Áudio recebido mas não transcrito — sem resposta.");
      return NextResponse.json({ status: "audio_nao_transcrito" });
    }
  }

  if (!text) return NextResponse.json({ status: "empty_content" });

  const waId = normalizePhone(phone);

  // ── Acha o prospect por wa_id OU telefone (normalizados) ────────────────────
  // Busca tolerante: a coluna pode guardar o número com ou sem o "55", então
  // comparamos pelos últimos dígitos também.
  const ultimos = waId.slice(-11); // DDD + número (sem o 55)
  const { data: candidatos } = await supabaseAdmin
    .from("prospects")
    .select("*")
    .or(`wa_id.eq.${waId},telefone.eq.${waId},wa_id.ilike.%${ultimos},telefone.ilike.%${ultimos}`)
    .limit(1);

  const prospect = (candidatos?.[0] as Prospect | undefined) ?? null;

  if (!prospect) {
    console.warn(`⚠️ [prospeccao webhook] Sem prospect para ${waId} — mensagem ignorada.`);
    return NextResponse.json({ status: "prospect_not_found" });
  }

  // ── Comando !reset (só do número do Lucas) ──────────────────────────────────
  // Zera a conversa e reenvia a abertura, pra testar o fluxo do começo sem mexer
  // no banco à mão. Antes o "!reset" caía como mensagem normal no Gemini, que
  // respondia qualquer coisa — parecia que o comando "não funcionava".
  // Restrito ao AUTOZAP_ALERT_WHATSAPP: um lojista curioso digitando !reset não
  // pode apagar o próprio histórico de atendimento.
  if (/^!reset$/i.test(text.trim())) {
    const dono = normalizePhone(process.env.AUTOZAP_ALERT_WHATSAPP || "");
    if (!dono || waId !== dono) {
      console.warn(`⛔ [prospeccao] !reset ignorado — veio de ${waId}, não do número do admin.`);
      return NextResponse.json({ status: "reset_nao_autorizado" });
    }

    const creds = autozapAvisaCreds();
    const agora = new Date().toISOString();

    await supabaseAdmin.from("prospect_mensagens").delete().eq("prospect_id", prospect.id);
    await supabaseAdmin
      .from("prospects")
      .update({
        status: "enviado",
        rodada: 1,
        enviado_em: agora,
        ultima_msg_at: agora,
        proximo_contato_at: null,
        followup_count: 0,
        opt_out: false,
        em_atendimento_humano: false,
        updated_at: agora,
      })
      .eq("id", prospect.id);

    const bolhas = await montarAbertura(prospect);
    if (bolhas.length && creds) {
      for (let i = 0; i < bolhas.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 5000)); // mesma pausa do cron
        await sendAvisaMessage(waId, bolhas[i], creds, { typing: i === 0 });
      }
      await supabaseAdmin.from("prospect_mensagens").insert(
        bolhasParaLinhas(prospect.id, bolhas)
      );
    }

    console.log(`♻️ [prospeccao] !reset de ${prospect.nome_empresa} — conversa zerada, abertura reenviada.`);
    return NextResponse.json({ status: "reset_ok", bolhas: bolhas.length });
  }

  // ── Salva a mensagem recebida + conta a resposta do dia ─────────────────────
  const ehAutoreply = pareceAutoreply(text);

  // Guarda o id: a coalescência mais abaixo compara com a última mensagem do
  // prospect pra saber se esta invocação ainda é a que deve responder.
  const { data: msgSalva } = await supabaseAdmin
    .from("prospect_mensagens")
    .insert({
      prospect_id: prospect.id,
      remetente: "prospect",
      content: text,
      wa_message_id: messageId,
    })
    .select("id")
    .maybeSingle();
  const msgSalvaId = msgSalva?.id as string | undefined;
  // Autoreply é robô do outro lado, não resposta real → não infla a métrica.
  if (!ehAutoreply) await bumpStats({ respostas: 1 }).catch(() => {});

  const nowIso = new Date().toISOString();

  // Garante que o wa_id fique gravado para envios futuros.
  const patchBase: Record<string, any> = { ultima_msg_at: nowIso, updated_at: nowIso };
  if (!prospect.wa_id) patchBase.wa_id = waId;

  // ── Pausa global da IA de prospecção ────────────────────────────────────────
  // Campanha pausada (ativo=false) = pausa TOTAL: nem proativo (cron), nem reativo.
  // A mensagem recebida fica salva (acima) pro humano ver no Inbox, mas a Mari NÃO
  // responde. Reativa ao religar a campanha (ativo=true).
  {
    const { data: cfgCampanha } = await supabaseAdmin
      .from("prospeccao_config").select("ativo").eq("id", 1).maybeSingle();
    if (cfgCampanha?.ativo === false) {
      await supabaseAdmin.from("prospects").update(patchBase).eq("id", prospect.id);
      return NextResponse.json({ status: "campanha_pausada" });
    }
  }

  // ── Stand-by humano: não responde se um humano assumiu ──────────────────────
  if (prospect.em_atendimento_humano) {
    // Marca como "respondeu" se ainda não evoluiu, mas mantém o humano no controle.
    if (prospect.status === "enviado" || prospect.status === "novo" || prospect.status === "sem_resposta") {
      patchBase.status = "respondeu";
    }
    await supabaseAdmin.from("prospects").update(patchBase).eq("id", prospect.id);
    return NextResponse.json({ status: "standby_humano" });
  }

  // ── Autoreply do WhatsApp Business do prospect ──────────────────────────────
  // É uma máquina, não uma pessoa. Não responde (não queima a 1ª impressão da Mari
  // nem arrisca loop bot×bot) — espera resposta humana real; o follow-up do cron
  // retoma depois se ninguém aparecer. Mantém o status (não marca como engajamento).
  if (ehAutoreply) {
    await supabaseAdmin.from("prospects").update(patchBase).eq("id", prospect.id);
    console.log(`🤖 [prospeccao] Autoreply detectado de "${prospect.nome_empresa}" — aguardando humano real (sem resposta).`);
    return NextResponse.json({ status: "autoreply_ignorado" });
  }

  // ── Guarda anti-rajada / anti-loop IA×IA ────────────────────────────────────
  // (a) Coalescência "a última vence". O debounce ANTIGO (SET NX EX 30) travava a
  //     resposta por 30s e DESCARTAVA em silêncio tudo que chegasse na janela —
  //     ótimo contra bot, péssimo com gente: quem manda "tem gol?" e 25s depois
  //     "quanto tá?" nunca recebia a 2ª resposta, e a Mari parecia travada.
  //     Agora esperamos um instante e checamos se ainda somos a última mensagem
  //     do prospect. Rajada de bot → só a última invocação responde (com todo o
  //     contexto). Humano digitando devagar → cada mensagem é respondida.
  await new Promise((r) => setTimeout(r, COALESCE_MS));
  const { data: ultimaMsg } = await supabaseAdmin
    .from("prospect_mensagens")
    .select("id")
    .eq("prospect_id", prospect.id)
    .eq("remetente", "prospect")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ultimaMsg?.id && msgSalvaId && ultimaMsg.id !== msgSalvaId) {
    await supabaseAdmin.from("prospects").update(patchBase).eq("id", prospect.id);
    console.log(`⏭️ [prospeccao] Mensagem superada por outra mais nova de ${prospect.nome_empresa} — quem responde é a última.`);
    return NextResponse.json({ status: "superseded" });
  }
  // (b) Loop: detecta RAJADA INSTANTÂNEA — atendente automático dispara 4-5 msgs
  //     no MESMO segundo. Janela curta (12s) de propósito: um humano engajado manda
  //     várias mensagens ao longo de 1-2min (não 4 em 12s), então NÃO cai aqui.
  //     (Antes era 2min e travava humano à toa — ex.: Top Veículos.)
  const janelaBurst = new Date(Date.now() - 12_000).toISOString();
  const { count: inboundRajada } = await supabaseAdmin
    .from("prospect_mensagens")
    .select("*", { count: "exact", head: true })
    .eq("prospect_id", prospect.id)
    .eq("remetente", "prospect")
    .gte("created_at", janelaBurst);
  if ((inboundRajada ?? 0) >= 4) {
    await supabaseAdmin
      .from("prospects")
      .update({ ...patchBase, em_atendimento_humano: true, status: "handoff" })
      .eq("id", prospect.id);
    await alertarHandoff(prospect, "Possível loop com atendimento automático (IA×IA) — assuma a conversa");
    console.warn(`🔁 [prospeccao] Loop guard: ${prospect.nome_empresa} mandou ${inboundRajada} msgs em 12s (rajada/bot) — IA travada.`);
    return NextResponse.json({ status: "loop_guard" });
  }

  // ── (c) Disjuntor de VOLUME — pega loop que a rajada não pega ───────────────
  // Caso real (Interior Automóveis, 16/08): a loja tem uma IA de atendimento
  // própria, a "Lara". As duas conversaram 20 minutos e 122 mensagens, cada uma
  // tentando vender carro pra outra — a Lara oferecendo o Onix dela do estoque,
  // a Mari insistindo no Onix do pátio de demonstração.
  //
  // Nenhuma das travas existentes pegou, e por bons motivos:
  //   - `pareceAutoreply` procura frase de robô de recado ("agradecemos seu
  //     contato"). A Lara escreve como gente: "Olá Mari, tudo bem?".
  //   - a rajada exige 4 mensagens em 12s. A Lara mandava 2 ou 3 por vez, a cada
  //     ~19s — ritmo mais humano que o de muito humano.
  //   - a regra no prompt disparou... no minuto 19, depois de 120 mensagens. E
  //     mesmo depois de dizer "vou deixar pro responsável ver depois", ela
  //     mandou mais duas.
  //
  // Este aqui não tenta adivinhar SE é robô: olha só o tamanho. Conversa de
  // demonstração com lojista de verdade não passa de ~20 mensagens nossas, e
  // nunca a esse ritmo. Estourou o teto, cala e chama humano.
  const janelaVolume = new Date(Date.now() - 15 * 60_000).toISOString();
  const [{ count: totalAgente }, { count: agenteNaJanela }] = await Promise.all([
    supabaseAdmin
      .from("prospect_mensagens")
      .select("*", { count: "exact", head: true })
      .eq("prospect_id", prospect.id)
      .eq("remetente", "agente"),
    supabaseAdmin
      .from("prospect_mensagens")
      .select("*", { count: "exact", head: true })
      .eq("prospect_id", prospect.id)
      .eq("remetente", "agente")
      .gte("created_at", janelaVolume),
  ]);

  const MAX_AGENTE_CONVERSA = 30;
  const MAX_AGENTE_15MIN = 14;
  const estourou =
    (totalAgente ?? 0) >= MAX_AGENTE_CONVERSA || (agenteNaJanela ?? 0) >= MAX_AGENTE_15MIN;

  if (estourou) {
    await supabaseAdmin
      .from("prospects")
      .update({ ...patchBase, em_atendimento_humano: true, status: "handoff" })
      .eq("id", prospect.id);
    await alertarHandoff(
      prospect,
      `Conversa longa demais (${totalAgente} mensagens nossas, ${agenteNaJanela} nos últimos 15min) — provável IA×IA. Assuma pelo Inbox.`,
    );
    console.warn(`🔌 [prospeccao] Disjuntor: ${prospect.nome_empresa} — ${totalAgente} msgs do agente (${agenteNaJanela} em 15min). IA travada.`);
    return NextResponse.json({ status: "disjuntor_volume" });
  }

  // ── Carrega o histórico e gera a resposta do agente ─────────────────────────
  // O pátio vai junto: a Mari precisa dele pra ofertar carro E pra saber de qual
  // deles ela tem foto (só esses recebem [ID] no prompt).
  const [patio, loja] = await Promise.all([carregarPatioDemo(), carregarLojaDemo()]);
  const { data: msgs } = await supabaseAdmin
    .from("prospect_mensagens")
    .select("*")
    .eq("prospect_id", prospect.id)
    .order("created_at", { ascending: true });

  const mensagens = (msgs ?? []) as ProspectMensagem[];

  const r = await gerarRespostaProspeccao({ prospect, mensagens, patio, loja });

  // ── Blindagem: Gemini fora do ar → silêncio + alerta (nunca desculpa técnica) ─
  // O prospect é um potencial assinante vendo a IA em ação; vendedor humano que
  // demora é normal. Sem resposta salva, a conversa retoma sozinha na próxima
  // mensagem dele (ou no follow-up do cron) quando o Gemini voltar.
  if (r.gemini_fora) {
    console.warn(`🛟 [Blindagem Gemini B2B] IA indisponível — silêncio para ${prospect.nome_empresa}; gerente alertado.`);
    await alertarHandoff(prospect, "IA indisponível agora — responda você pelo Inbox de Vendas");
    return NextResponse.json({ status: "gemini_fora_silencio" });
  }

  // ── Define o novo status conforme a leitura do agente ───────────────────────
  // Reclassificação determinística: o modelo confunde adiamento com recusa nos
  // dois sentidos, e o erro é caro — opt_out tira o contato da base pra sempre.
  // A resposta enviada é a mesma; muda só se ele volta na próxima rodada.
  const destino = destinoDoEncerramento(r, text);
  if (destino && ((destino === "adiou") !== r.adiou)) {
    console.log(`🔀 [prospeccao] "${text.slice(0, 40)}" reclassificado como ${destino}.`);
  }

  if (destino === "opt_out") {
    // Recusa DEFINITIVA: sai da base pra sempre (cron e rodada nova filtram opt_out).
    patchBase.status = "opt_out";
    patchBase.opt_out = true;
  } else if (destino === "adiou") {
    // ADIAMENTO ("depois eu vejo", "tô sem tempo"). A Mari para de falar igual,
    // mas isso não é um não: marcar opt_out tirava da base pra sempre quem só
    // estava ocupado. Como `sem_resposta`, ele volta a ser elegível quando o
    // Lucas abrir a próxima rodada — com mensagem diferente, meses depois.
    patchBase.status = "sem_resposta";
    patchBase.proximo_contato_at = null;
    console.log(`⏸️ [prospeccao] ${prospect.nome_empresa} adiou — encerrado nesta rodada, elegível na próxima.`);
  } else {
    // Conversa viva. Desde a migration 042 não há follow-up automático, então não
    // há nada pra adiar: basta garantir que nenhum agendamento residual sobreviva.
    // (O status sair de 'enviado' também tira o prospect da varredura das 48h.)
    patchBase.proximo_contato_at = null;
    if (r.handoff) {
      patchBase.status = "handoff";
      // Em geral NÃO seta em_atendimento_humano: a IA continua respondendo até o
      // HUMANO assumir de fato (via /api/admin/vendas/enviar), pra não deixar o
      // vácuo em que o agente cala e ninguém responde.
      //
      // EXCEÇÃO: handoff por ter caído em robô. Aí continuar respondendo é
      // exatamente o que não pode — do outro lado não tem ninguém pra esperar.
      // A Mari chegou a dizer "vou deixar pro responsável ver depois" e mandou
      // mais DUAS mensagens depois disso, porque a fala dela não calava nada.
      if (ehHandoffPorRobo(r.motivo_handoff, r.resposta)) {
        patchBase.em_atendimento_humano = true;
        console.warn(`🤖 [prospeccao] ${prospect.nome_empresa}: handoff por robô — IA travada de verdade.`);
      }
    } else if (r.temperatura === "QUENTE") {
      patchBase.status = "quente";
    } else {
      patchBase.status = "respondeu";
    }
  }

  // ── Envia a resposta em BOLHAS curtas (graceful se credenciais ausentes) ─────
  // quebrarEmBolhas FORÇA mensagens de no máx ~2 linhas, mesmo se o Gemini mandar
  // um bloco corrido. sendAvisaMessage já aplica o delay humanizado entre cada.
  // A PONTE ("foi mais ou menos assim que eu respondi agora. seus clientes
  // teriam isso às 23h...") é UMA frase, mas o modelo a quebra em duas bolhas e
  // o teto de MAX_BOLHAS_RESPOSTA comia a segunda — foi o que o André Moi
  // recebeu: "Foi mais ou menos assim que eu respondi agora." e ponto, sem o
  // argumento. Cortada no meio ela não quer dizer nada, e é o momento mais
  // importante da demo. Cola as duas de volta ANTES do corte.
  const bolhasCruas = quebrarEmBolhas(r.resposta);
  for (let i = 0; i < bolhasCruas.length - 1; i++) {
    if (/foi mais ou menos assim/i.test(bolhasCruas[i]) && /seus clientes/i.test(bolhasCruas[i + 1])) {
      bolhasCruas.splice(i, 2, `${bolhasCruas[i]} ${bolhasCruas[i + 1]}`);
      break;
    }
  }
  const mensagensEnviar = bolhasCruas.slice(0, MAX_BOLHAS_RESPOSTA);

  // Lista do pátio montada pelo CÓDIGO, um carro por bolha. Deixar o modelo
  // formatar falhou duas vezes: primeiro ele mandou os 5 carros grudados num
  // parágrafo, depois mandou tudo corrido separado por vírgula e o split picou
  // no meio dos nomes ("...Chevrolet Onix 1.0 LT," | "2024, R$ 69.958..."). Ele
  // só sinaliza a intenção; a formatação é determinística aqui.
  // Trava de lista repetida: o Gio mandou duas mensagens em 27s, o modelo marcou
  // listar_patio nas duas e ele recebeu os 5 carros DUAS vezes — 13 mensagens em
  // 40 segundos. Uma vez listado, o estoque não se repete na mesma conversa;
  // se ele quiser rever, pergunta e a Mari responde com o carro que interessa.
  const jaListou =
    patio.length > 0 &&
    (mensagens ?? []).some(
      (m) => m.remetente !== "prospect" && (m.content || "").includes(patio[0].descricao)
    );

  if (r.listar_patio && !jaListou) {
    for (const carro of patio) mensagensEnviar.push(carro.descricao);
  } else if (r.listar_patio) {
    console.log(`🔁 [prospeccao] Lista do pátio já foi enviada a ${prospect.nome_empresa} — não repetindo.`);
  }

  // Teto global do turno. Mesmo com a lista, ninguém precisa receber mais que
  // isso de uma vez: rajada de mensagem é o padrão que o WhatsApp pontua.
  if (mensagensEnviar.length > MAX_MENSAGENS_TURNO) {
    mensagensEnviar.length = MAX_MENSAGENS_TURNO;
  }

  // ── Corrida in-flight: a conversa acabou enquanto esta execução pensava? ────
  // O Gemini leva ~10-20s. Nesse intervalo OUTRA execução (mensagem seguinte do
  // lojista) pode ter encerrado a rodada. Foi o que o André Moi viu: às 18:53:04
  // ela se despediu ("Sucesso aí com a loja") e 4s depois emendou um argumento
  // de venda do MyLink — a resposta do "OK" já estava no ar quando a do
  // "OBRIGADO" fechou a conversa. Despedir e continuar vendendo é pior que
  // qualquer uma das duas sozinha.
  if (!destino) {
    const { data: agora } = await supabaseAdmin
      .from("prospects")
      .select("status, opt_out")
      .eq("id", prospect.id)
      .maybeSingle();
    const encerradoPorOutraExecucao =
      agora?.opt_out === true || agora?.status === "opt_out" || agora?.status === "sem_resposta";
    if (encerradoPorOutraExecucao) {
      console.log(`🛑 [prospeccao] ${prospect.nome_empresa}: rodada encerrada por outra execução — resposta descartada.`);
      return NextResponse.json({ status: "encerrado_in_flight" });
    }
  }

  const creds = autozapAvisaCreds();
  let enviada = false;
  if (!creds) {
    console.warn("⚠️ [prospeccao webhook] AUTOZAP_AVISA_* ausentes — resposta gerada mas NÃO enviada (graceful).");
  } else {
    try {
      enviada = true;
      for (const bolha of mensagensEnviar) {
        // sendAvisaMessage agora retorna boolean: false = 463/erro (não saiu).
        const ok = await sendAvisaMessage(waId, bolha, creds);
        if (!ok) { enviada = false; break; } // não insiste nas próximas bolhas
      }

      // Foto do carro pedido. Vai DEPOIS do texto (o WhatsApp mostra a imagem
      // como resposta ao que ela acabou de dizer) e só se o Gemini apontou um ID
      // que existe no pátio E tem foto — ele não decide a URL, só qual carro.
      if (enviada && r.foto_veiculo_id && !OFERTA_DE_MIDIA.test(r.resposta)) {
        const carro = patio.find((c) => c.id === r.foto_veiculo_id);
        if (carro?.fotos.length) {
          // Manda TODAS (até o teto), não só a primeira: quando ia só a [0], o
          // "tem mais fotos?" devolvia a mesma imagem de novo. Revenda manda o
          // álbum do carro — frente, lateral, traseira e interior.
          const fotosEnviar = carro.fotos.slice(0, MAX_FOTOS_POR_CARRO);
          for (const foto of fotosEnviar) {
            try {
              await sendAvisaImage(waId, foto, undefined, creds);
              await new Promise((res) => setTimeout(res, 900)); // respiro entre imagens
            } catch (err) {
              // Foto é bônus da demo: falhar aqui não invalida a resposta enviada.
              console.error("❌ [prospeccao webhook] Falha ao enviar foto do carro:", err);
              break;
            }
          }
        } else {
          console.warn(`⚠️ [prospeccao webhook] foto_veiculo_id "${r.foto_veiculo_id}" sem foto no pátio — ignorado.`);
        }
      }

      // Vídeo do carro. Mesma lógica da foto: o Gemini escolhe o carro, nunca a
      // URL. Antes disso ela oferecia vídeo e depois voltava atrás com "aqui na
      // demonstração não consigo" — promessa quebrada no pico do interesse.
      if (enviada && r.video_veiculo_id && !OFERTA_DE_MIDIA.test(r.resposta)) {
        const carro = patio.find((c) => c.id === r.video_veiculo_id);
        if (carro?.video) {
          try {
            await sendAvisaVideo(waId, carro.video, undefined, creds);
          } catch (err) {
            console.error("❌ [prospeccao webhook] Falha ao enviar vídeo do carro:", err);
          }
        } else {
          console.warn(`⚠️ [prospeccao webhook] video_veiculo_id "${r.video_veiculo_id}" sem vídeo no pátio — ignorado.`);
        }
      }
    } catch (err) {
      console.error("❌ [prospeccao webhook] Erro inesperado ao enviar resposta:", err);
      enviada = false;
    }
    if (!enviada) {
      // Envio recusado (tipicamente soft-ban 463 do chip). NÃO grava resposta fantasma
      // no histórico (bloco abaixo só insere se enviada=true) e conta como bloqueio.
      console.error("❌ [prospeccao webhook] Resposta NÃO enviada (envio recusado — ex.: 463).");
      await bumpStats({ bloqueios: 1 }).catch(() => {});
    }
  }

  // Só salva as msgs do agente se de fato enviou (evita histórico fantasma).
  if (enviada) {
    await supabaseAdmin.from("prospect_mensagens").insert(
      bolhasParaLinhas(prospect.id, mensagensEnviar)
    );
  }

  await supabaseAdmin.from("prospects").update(patchBase).eq("id", prospect.id);

  // Alerta de handoff (após persistir o estado).
  if (r.handoff) {
    if (enviada) await bumpStats({ handoffs: 1 }).catch(() => {});
    await alertarHandoff(prospect, r.motivo_handoff);
  }

  return NextResponse.json({
    status: "ok",
    handoff: r.handoff,
    opt_out: r.opt_out,
    temperatura: r.temperatura,
    enviada,
  });
}
