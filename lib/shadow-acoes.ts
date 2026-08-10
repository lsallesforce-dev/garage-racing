// lib/shadow-acoes.ts
//
// SHADOW MODE da Fase 2 — comparar quem decide melhor "o cliente pediu mídia?":
// as 18 regras de regex do passo 11 (`lib/process-whatsapp.ts`) ou o próprio
// Gemini, que agora declara isso no campo `acoes` do JSON de resposta.
//
// ⚠️ NADA AQUI EXECUTA AÇÃO. O comportamento em produção continua sendo o do
// regex. Este módulo só registra a divergência em `alertas_operacionais`
// (tipo `shadow_diff`), pra que a virada da Fase 2 seja feita com dado medido
// em vez de fé. O plano previa inverter o turno já no primeiro dia; com 3
// tenants pagantes e muita coisa nova no ar, medir antes sai mais barato.
//
// O que motivou a Fase 2: hoje a mídia é enviada ANTES da chamada ao Gemini, e
// quem decide são listas de palavras. Quando a lista não tem a palavra que o
// cliente usou ("Manda o material", 10/08), o passo de envio nem roda e o
// modelo — que não sabe disso — escreve "estou te enviando as fotos". A palavra
// e a ação vêm de origens diferentes e só concordam por sorte.

import { supabaseAdmin } from "@/lib/supabase-admin";

export type AcaoTipo = "enviar_fotos" | "enviar_video";

export interface AcaoDeclarada {
  tipo: AcaoTipo;
  veiculo_id: string | null;
  partes?: string[];
}

/** O que o REGEX decidiu neste turno (comportamento vigente). */
export interface DecisaoRegex {
  foto: boolean;
  video: boolean;
  veiculoId: string | null;
}

/** O que o MODELO declarou no campo `acoes`. */
export interface DecisaoModelo {
  foto: boolean;
  video: boolean;
  veiculoId: string | null;
  partes: string[];
}

const TIPOS_VALIDOS: AcaoTipo[] = ["enviar_fotos", "enviar_video"];
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normaliza o `acoes` cru do Gemini. Tolerante de propósito: o modelo às vezes
 * manda string no lugar de array, ou um objeto solto. Nada aqui pode lançar —
 * shadow mode quebrando o turno do cliente seria o pior resultado possível.
 *
 * `idsValidos` = IDs que estavam no contexto. Um ID fora dessa lista é
 * alucinação e vira null, mesma política do `veiculo_id_foco` (que já valida
 * contra o tenant antes de aplicar).
 */
export function lerAcoes(bruto: unknown, idsValidos: Set<string>): DecisaoModelo {
  const out: DecisaoModelo = { foto: false, video: false, veiculoId: null, partes: [] };
  const lista = Array.isArray(bruto) ? bruto : bruto && typeof bruto === "object" ? [bruto] : [];

  for (const item of lista) {
    if (!item || typeof item !== "object") continue;
    const tipo = String((item as any).tipo ?? "").trim().toLowerCase() as AcaoTipo;
    if (!TIPOS_VALIDOS.includes(tipo)) continue;

    if (tipo === "enviar_fotos") out.foto = true;
    if (tipo === "enviar_video") out.video = true;

    const vid = (item as any).veiculo_id;
    if (typeof vid === "string" && RE_UUID.test(vid.trim()) && idsValidos.has(vid.trim())) {
      out.veiculoId ??= vid.trim();
    }

    const partes = (item as any).partes;
    if (Array.isArray(partes)) {
      for (const p of partes) {
        const s = String(p ?? "").trim().toLowerCase();
        if (s && s.length <= 30 && !out.partes.includes(s)) out.partes.push(s);
      }
    }
  }
  return out;
}

export interface Divergencia {
  houve: boolean;
  detalhe: string;
  /** Regex não pediu e o modelo pediu — é a falha do caso "Manda o material". */
  regexPerdeu: boolean;
  /** Regex pediu e o modelo não — despejo de mídia não solicitado. */
  regexExagerou: boolean;
  /** Os dois pediram, mas apontando carros diferentes. */
  carroDivergiu: boolean;
}

export function compararDecisoes(
  regex: DecisaoRegex,
  modelo: DecisaoModelo,
  mensagemCliente: string,
): Divergencia {
  const perdeuFoto = !regex.foto && modelo.foto;
  const perdeuVideo = !regex.video && modelo.video;
  const exagerouFoto = regex.foto && !modelo.foto;
  const exagerouVideo = regex.video && !modelo.video;

  // Só compara carro quando os dois concordam que há mídia a enviar e os dois
  // apontaram algum veículo — senão a "divergência" seria só ausência de dado.
  const carroDivergiu =
    (regex.foto || regex.video) && (modelo.foto || modelo.video) &&
    !!regex.veiculoId && !!modelo.veiculoId && regex.veiculoId !== modelo.veiculoId;

  const partes: string[] = [];
  if (perdeuFoto) partes.push("regex NÃO pediu foto, modelo pediu");
  if (perdeuVideo) partes.push("regex NÃO pediu vídeo, modelo pediu");
  if (exagerouFoto) partes.push("regex pediu foto, modelo NÃO");
  if (exagerouVideo) partes.push("regex pediu vídeo, modelo NÃO");
  if (carroDivergiu) partes.push(`carro diferente (regex ${regex.veiculoId?.slice(0, 8)} × modelo ${modelo.veiculoId?.slice(0, 8)})`);
  if (modelo.partes.length) partes.push(`partes pedidas: ${modelo.partes.join("/")}`);

  return {
    houve: perdeuFoto || perdeuVideo || exagerouFoto || exagerouVideo || carroDivergiu,
    detalhe: `msg: "${mensagemCliente.slice(0, 80)}" — ${partes.join("; ")}`,
    regexPerdeu: perdeuFoto || perdeuVideo,
    regexExagerou: exagerouFoto || exagerouVideo,
    carroDivergiu,
  };
}

/**
 * Grava a divergência. Nunca lança: shadow mode não pode derrubar o turno.
 *
 * Não usa o índice único parcial de `alertas_operacionais` (que existe pra
 * dedupe de alerta operacional) porque aqui interessa CADA ocorrência — é
 * amostra estatística, não fila de trabalho. Por isso o `resolvido_em` já
 * nasce preenchido: a linha entra fechada e não polui o painel de pendências.
 */
export async function registrarShadow(
  tenantUserId: string,
  leadId: string | null,
  div: Divergencia,
): Promise<void> {
  if (!div.houve) return;
  try {
    await supabaseAdmin.from("alertas_operacionais").insert({
      tenant_user_id: tenantUserId,
      lead_id: leadId,
      tipo: "shadow_diff",
      detalhe: div.detalhe.slice(0, 500),
      resolvido_em: new Date().toISOString(),
    });
  } catch {
    /* shadow mode é observação; falhar aqui não pode afetar o cliente */
  }
}
