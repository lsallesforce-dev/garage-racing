// lib/tts.ts
// Síntese de voz para as respostas do agente no WhatsApp.
//
// Espelho do lib/transcribe.ts (que faz o caminho inverso: áudio do cliente → texto).
//
// Primário: ElevenLabs Flash v2.5 — PT-BR com sotaque brasileiro real e ~75ms de
// latência. É o único motor testado que não entrega o "sotaque gringo" que denuncia
// que é robô, e a feature inteira existe pra soar humana.
// Fallback: OpenAI TTS (mesma chave já usada em transcribe.ts e marketing-pipeline.ts).
//
// Política de falha: FAIL-SOFT ABSOLUTO. Qualquer erro retorna null e o chamador
// manda a resposta em texto. Voz nunca pode derrubar um atendimento.

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY ?? "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

// Voz PT-BR padrão. Sobrescrevível por tenant (config_garage.voz_id).
const VOZ_PADRAO = process.env.ELEVENLABS_VOICE_ID ?? "";

// Mesmo padrão do OPENAI_ASR_MODELS em transcribe.ts: tenta o melhor primeiro e
// desce se a conta não tiver acesso ao modelo.
const ELEVEN_MODELS = ["eleven_flash_v2_5", "eleven_turbo_v2_5", "eleven_multilingual_v2"];

// Opus mono 48kHz é o que o WhatsApp renderiza como BOLHA DE VOZ. Qualquer outro
// container (mp3, wav) vira card de arquivo — que é exatamente o que não queremos.
const OPUS_BITRATE_KBPS = 32;

// ─── 1. Preparo do texto para fala ───────────────────────────────────────────

const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const DEZ_A_DEZENOVE = ["dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

// Números por extenso até milhões. O TTS lê "89.900" como "oitenta e nove ponto
// novecentos" — em conversa de preço de carro isso soa quebrado, então expandimos.
function porExtenso(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n === 0) return "zero";
  if (n === 100) return "cem";
  if (n < 10) return UNIDADES[n];
  if (n < 20) return DEZ_A_DEZENOVE[n - 10];
  if (n < 100) {
    const d = Math.floor(n / 10), u = n % 10;
    return u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d];
  }
  if (n < 1000) {
    const c = Math.floor(n / 100), r = n % 100;
    return r ? `${CENTENAS[c]} e ${porExtenso(r)}` : CENTENAS[c];
  }
  if (n < 1_000_000) {
    const m = Math.floor(n / 1000), r = n % 1000;
    const mil = m === 1 ? "mil" : `${porExtenso(m)} mil`;
    if (!r) return mil;
    // "vinte mil e quinhentos" (r < 100 ou múltiplo de 100) vs "vinte mil quinhentos e vinte"
    return r < 100 || r % 100 === 0 ? `${mil} e ${porExtenso(r)}` : `${mil} ${porExtenso(r)}`;
  }
  const mi = Math.floor(n / 1_000_000), r = n % 1_000_000;
  const milhoes = mi === 1 ? "um milhão" : `${porExtenso(mi)} milhões`;
  return r ? `${milhoes} e ${porExtenso(r)}` : milhoes;
}

function soNumero(s: string): number {
  return parseInt(s.replace(/\./g, "").replace(/\s/g, ""), 10);
}

/**
 * Converte a resposta de chat em texto falável. Retorna null quando a mensagem
 * NÃO deve virar áudio — o chamador então manda texto normal.
 *
 * Bloqueia (retorna null) quando o conteúdo depende de ser lido: link, lista de
 * veículos, tabela de preços, ou texto longo demais. Ninguém ouve áudio de dois
 * minutos, e link ditado em voz é inútil.
 */
export function prepararTextoParaVoz(texto: string, maxChars = 450): string | null {
  let t = (texto ?? "").trim();
  if (!t) return null;

  // URL/link: a mensagem existe pra ser clicada → texto.
  if (/https?:\/\/|www\.|wa\.me/i.test(t)) return null;

  // Lista/enumeração (estoque, opções de veículo) → o cliente precisa reler.
  if (/^\s*[-•*\d]+[.)]?\s+.+$/m.test(t) && (t.match(/\n/g)?.length ?? 0) >= 2) return null;

  // Markdown e emoji não se falam.
  t = t
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
    .replace(/~([^~]+)~/g, "$1")
    .replace(/`+/g, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu, "");

  // Dinheiro: "R$ 89.900" / "R$ 89.900,00" → por extenso.
  // O agrupamento de milhar é explícito de propósito: com `[\d.]+` o regex engolia
  // o ponto final da frase ("por R$ 89.900. Quer...") e colava as duas sentenças.
  t = t.replace(/R\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{2}))?/gi, (_m, int, cents) => {
    const v = soNumero(int);
    if (!Number.isFinite(v)) return _m;
    const reais = `${porExtenso(v)} ${v === 1 ? "real" : "reais"}`;
    const c = cents ? parseInt(cents, 10) : 0;
    return c ? `${reais} e ${porExtenso(c)} centavos` : reais;
  });

  // Ano-modelo: "2019/2020" → "dois mil e dezenove barra dois mil e vinte".
  t = t.replace(/\b(19|20)(\d{2})\s*\/\s*(19|20)(\d{2})\b/g, (_m, a, b, c, d) =>
    `${porExtenso(soNumero(a + b))} barra ${porExtenso(soNumero(c + d))}`);

  // Quilometragem: "45.000 km" → "quarenta e cinco mil quilômetros".
  t = t.replace(/(\d{1,3}(?:\.\d{3})+|\d+)\s*(km|Km|KM)\b/g, (_m, num) => {
    const v = soNumero(num);
    return Number.isFinite(v) ? `${porExtenso(v)} quilômetros` : _m;
  });

  // Motorização e decimais soltos: "1.0", "2.0," → "um ponto zero".
  // Sem restringir o que vem depois: "2.0," seguido de vírgula ficava em dígito, e
  // "ponto" é a leitura certa de qualquer decimal em PT-BR mesmo.
  t = t.replace(/\b(\d)\.(\d)\b/g, (_m, a, b) =>
    `${a === "0" ? "zero" : UNIDADES[Number(a)]} ponto ${b === "0" ? "zero" : UNIDADES[Number(b)]}`);

  // Siglas que o TTS soletra errado.
  t = t
    .replace(/\bIPVA\b/g, "I P V A")
    .replace(/\bFIPE\b/g, "Fipe")
    .replace(/\bCVT\b/g, "C V T")
    .replace(/\bABS\b/g, "A B S")
    .replace(/\bIPI\b/g, "I P I")
    .replace(/\bCRLV\b/g, "C R L V")
    .replace(/\bCNH\b/g, "C N H")
    .replace(/\bSUV\b/g, "suv");

  // Anos soltos ainda em dígito: "2019" → "dois mil e dezenove".
  t = t.replace(/\b(19|20)(\d{2})\b/g, (_m, a, b) => porExtenso(soNumero(a + b)));

  t = t.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  if (!t) return null;

  // Texto longo demais: o cliente não ouve, e o custo por caractere dispara.
  if (t.length > maxChars) return null;

  return t;
}

// ─── 2. Motores de síntese ───────────────────────────────────────────────────

async function sintetizarElevenLabs(texto: string, vozId: string): Promise<Buffer | null> {
  if (!ELEVEN_API_KEY || !vozId) return null;
  for (const model of ELEVEN_MODELS) {
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vozId)}?output_format=mp3_44100_64`,
        {
          method: "POST",
          headers: { "xi-api-key": ELEVEN_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            text: texto,
            model_id: model,
            language_code: "pt",
            voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.2, speed: 1.0, use_speaker_boost: true },
          }),
        },
      );
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        console.log(`🔊 [TTS ElevenLabs ${model}] ${texto.length} chars → ${(buf.length / 1024).toFixed(0)}KB`);
        return buf;
      }
      // 400/401/422 do modelo (conta sem acesso ao Flash, p.ex.) → tenta o próximo
      console.warn(`⚠️ [TTS ElevenLabs ${model}] HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
    } catch (e: any) {
      console.warn(`⚠️ [TTS ElevenLabs ${model}] ${e?.message ?? e}`);
    }
  }
  return null;
}

async function sintetizarOpenAI(texto: string): Promise<Buffer | null> {
  if (!OPENAI_API_KEY) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        input: texto,
        voice: "onyx",
        response_format: "opus",
        speed: 1.0,
      }),
    });
    if (!res.ok) {
      console.warn(`⚠️ [TTS OpenAI] HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    console.log(`🔊 [TTS OpenAI fallback] ${texto.length} chars → ${(buf.length / 1024).toFixed(0)}KB`);
    return buf;
  } catch (e: any) {
    console.warn(`⚠️ [TTS OpenAI] ${e?.message ?? e}`);
    return null;
  }
}

// ─── 3. Transcode para OGG/Opus mono ─────────────────────────────────────────
// Sempre transcodamos, mesmo quando o motor já devolve opus: o WhatsApp só trata
// como nota de voz o Opus mono 48kHz em container OGG, e cada motor entrega um
// container diferente. Um caminho só = um comportamento só.
// Mesmo padrão de ffmpeg-static do ensureCompressedVideo (process-whatsapp.ts).
async function paraOggOpus(entrada: Buffer): Promise<Buffer | null> {
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const fs = await import("fs/promises");
    const execFileAsync = promisify(execFile);

    const ffmpegStaticMod = await import("ffmpeg-static");
    const ffmpegSrc: string = (ffmpegStaticMod.default ?? ffmpegStaticMod) as unknown as string;
    const ffmpegPath = "/tmp/ffmpeg_whatsapp";
    try {
      await fs.copyFile(ffmpegSrc, ffmpegPath);
      await fs.chmod(ffmpegPath, 0o755);
    } catch (e: any) {
      if (e.code !== "ETXTBSY") throw e; // ETXTBSY = outra invocação já copiou
    }

    const id = Math.random().toString(36).slice(2);
    const tmpIn = `/tmp/tts_in_${id}`;
    const tmpOut = `/tmp/tts_out_${id}.ogg`;
    try {
      await fs.writeFile(tmpIn, entrada);
      await execFileAsync(ffmpegPath, [
        "-i", tmpIn,
        "-c:a", "libopus", "-b:a", `${OPUS_BITRATE_KBPS}k`,
        "-ar", "48000", "-ac", "1",
        "-application", "voip",
        "-f", "ogg",
        "-y", tmpOut,
      ], { maxBuffer: 32 * 1024 * 1024 });
      return await fs.readFile(tmpOut);
    } finally {
      await Promise.allSettled([fs.unlink(tmpIn).catch(() => {}), fs.unlink(tmpOut).catch(() => {})]);
    }
  } catch (e) {
    console.warn("⚠️ [TTS] transcode ogg/opus falhou:", String(e).slice(0, 200));
    return null;
  }
}

// ─── 4. API pública ──────────────────────────────────────────────────────────

/**
 * Sintetiza `texto` em uma nota de voz OGG/Opus pronta pro WhatsApp.
 * Retorna null em qualquer falha — o chamador deve cair pra texto.
 */
export async function sintetizarVoz(
  texto: string,
  opts?: { vozId?: string },
): Promise<{ ogg: Buffer; duracaoSeg: number } | null> {
  const t = (texto ?? "").trim();
  if (!t) return null;

  const t0 = Date.now();
  const bruto =
    (await sintetizarElevenLabs(t, opts?.vozId || VOZ_PADRAO)) ??
    (await sintetizarOpenAI(t));
  if (!bruto) return null;

  const ogg = await paraOggOpus(bruto);
  if (!ogg) return null;

  // Estimativa pelo bitrate — serve pra log e pra descontar do delay de digitação.
  // Não precisa ser exata; ffprobe não está disponível no runtime da Vercel.
  const duracaoSeg = Math.max(1, Math.round((ogg.length * 8) / (OPUS_BITRATE_KBPS * 1000)));
  console.log(`🔊 [TTS] pronto: ${(ogg.length / 1024).toFixed(0)}KB ~${duracaoSeg}s em ${Date.now() - t0}ms`);
  return { ogg, duracaoSeg };
}
