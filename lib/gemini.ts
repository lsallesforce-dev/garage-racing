import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY!;
const genAI = new GoogleGenerativeAI(apiKey);

// ✅ Modelo principal (pago) com fallback gratuito em caso de 429
export const geminiFlashSales = genAI.getGenerativeModel(
  { model: "gemini-2.5-flash" },
  { apiVersion: "v1beta" }
);

// Fallback quando principal atinge 429 — gemini-2.0-flash (lite está descontinuado/404)
export const geminiFlashFallback = genAI.getGenerativeModel(
  { model: "gemini-2.0-flash" },
  { apiVersion: "v1beta" }
);

/**
 * JSON.parse tolerante à saída do Gemini. O modelo às vezes deixa caracteres de controle
 * CRUS (quebra de linha, tab) DENTRO das strings do JSON — ex: uma "resposta" com \n
 * literal — e o JSON.parse padrão rejeita com "Bad control character in string literal".
 * Aqui tentamos o parse normal e, se falhar, escapamos os control chars APENAS dentro de
 * strings (a quebra vira \n escapado, preservando o texto/as bolhas) e tentamos de novo.
 * Lança se ainda assim não for JSON válido — o chamador decide o fallback.
 */
export function parseGeminiJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    let out = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === "\\") { out += ch; escaped = true; continue; }
      if (ch === '"') { inString = !inString; out += ch; continue; }
      if (inString && ch.charCodeAt(0) < 0x20) {
        if (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        else out += "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
        continue;
      }
      out += ch;
    }
    return JSON.parse(out);
  }
}

// Dimensão do vetor. TEM que bater com a coluna `veiculos.embedding`, que é
// vector(1536) desde a era OpenAI — por isso 1536 e não o default do modelo.
// gemini-embedding-001 é MRL: truncar pra 1536 é suportado oficialmente.
export const EMBEDDING_DIMS = 1536;
const EMBEDDING_MODEL = "gemini-embedding-001";

/**
 * Retorna o vetor de embedding ou null se indisponível.
 * null sinaliza explicitamente "busca semântica indisponível" — nunca retorna zeros
 * para não poluir o pgvector com vetores nulos que parecem válidos.
 *
 * ⚠️ Chamada via fetch, não pelo SDK: o @google/generative-ai 0.24.1 não tem
 * `outputDimensionality` no EmbedContentRequest e descarta o campo em silêncio —
 * voltariam 3072 dims que não entram na coluna vector(1536).
 *
 * Histórico: rodava em `text-embedding-005`, que é modelo do VERTEX AI e nunca
 * existiu nesta API — dava 404 em toda mensagem desde ~abril/2026 e a busca
 * semântica ficava desligada sem ninguém notar (a textual segurava sozinha).
 * `text-embedding-004` também já saiu do ar.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`;
  const body = JSON.stringify({
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text }] },
    outputDimensionality: EMBEDDING_DIMS,
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (!res.ok) {
        const detalhe = (await res.text()).slice(0, 200);
        // 404 = modelo fora do ar nesta key. Não adianta insistir — avisa alto,
        // porque foi exatamente assim que a semântica morreu calada da última vez.
        if (res.status === 404) {
          console.error(`🚨 Embedding: modelo ${EMBEDDING_MODEL} não existe nesta API key (404). Busca semântica DESLIGADA.`);
          return null;
        }
        if (res.status === 429 && attempt < 2) {
          const wait = (attempt + 1) * 2000;
          console.warn(`⏳ Embedding rate limit, aguardando ${wait}ms (tentativa ${attempt + 1}/3)`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        console.warn(`⚠️ Embedding falhou (HTTP ${res.status}): ${detalhe}`);
        return null;
      }

      const values: number[] | undefined = (await res.json())?.embedding?.values;
      if (!values || values.length === 0) return null;
      if (values.length !== EMBEDDING_DIMS) {
        // Guarda-chuva: dimensão errada quebraria o insert no pgvector com um
        // erro obscuro lá na frente. Melhor recusar aqui.
        console.error(`🚨 Embedding veio com ${values.length} dims, esperado ${EMBEDDING_DIMS}. Descartando.`);
        return null;
      }

      // Truncagem MRL desnormaliza o vetor. O match_veiculos usa distância de
      // cosseno (<=>), que é invariante a escala, então isso não muda ranking —
      // mas normalizar mantém os vetores comparáveis se um dia trocar o operador.
      const norma = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
      return norma > 0 ? values.map((v) => v / norma) : values;
    } catch (error: any) {
      console.warn(`⚠️ Embedding indisponível (tentativa ${attempt + 1}/3):`, String(error).slice(0, 200));
      return null;
    }
  }
  return null;
}