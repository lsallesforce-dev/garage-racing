// Contador de ACESSOS da vitrine — o outro lado da conta do painel.
//
// O painel só media lead. Sem visita, "o site não traz nada" não tinha como ser
// checado, e com o catálogo pago no ar a pergunta virou orçamento: em 11/09 a
// Meta entregou 436 aberturas de página e só 8 cliques no WhatsApp. O buraco
// estava na vitrine, não no anúncio — mas isso só dá pra ver medindo os dois.
//
// Grava agregado por dia (migration 059), sem IP, sem cookie, sem user agent
// guardado: só "quantos", nunca "quem".

import { createClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { after } from "next/server";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Robô não é visita. O `facebookexternalhit` sozinho já inflaria o número toda
// vez que um link da vitrine é compartilhado, e o catálogo faz a Meta buscar as
// páginas de hora em hora.
const ROBO_RE =
  /bot\b|bots?\/|crawler|spider|scrape|facebookexternalhit|meta-external|whatsapp|telegram|slurp|bingpreview|embedly|quora link preview|curl\/|wget\/|python-requests|node-fetch|axios\/|go-http|java\/|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitoring|semrush|ahrefs|mj12|dotbot|petalbot|yandex|baiduspider|applebot|duckduck/i;

/** 'catalogo' quando o link veio do feed pago (?o=cat); 'direto' no resto. */
export type OrigemVisita = "catalogo" | "direto";

/**
 * Conta um acesso. Nunca lança e nunca segura a renderização: roda no `after()`,
 * depois que a resposta já foi enviada — contador quebrado não pode derrubar a
 * vitrine de um cliente.
 */
export async function registrarVisitaVitrine(
  userId: string | null | undefined,
  origem: OrigemVisita
): Promise<void> {
  if (!userId) return;
  // O user agent é lido AGORA, dentro do request. Ler dentro do after() falha
  // (o request já acabou) e o erro morria no catch — contador zerado em
  // silêncio, foi o que aconteceu no primeiro deploy de 12/09.
  let ua = "";
  try {
    ua = (await headers()).get("user-agent") ?? "";
  } catch {
    return;
  }
  if (!ua || ROBO_RE.test(ua)) return;

  after(async () => {
    try {
      const { error } = await supabaseAdmin.rpc("registrar_visita_vitrine", {
        p_user_id: userId,
        p_origem: origem,
      });
      if (error) console.warn("⚠️ [vitrine-visitas] rpc:", error.message);
    } catch (e) {
      console.warn("⚠️ [vitrine-visitas]", e);
    }
  });
}

export type VisitasPeriodo = { total: number; catalogo: number; direto: number };

/** Soma de acessos entre duas datas BRT (YYYY-MM-DD), inclusive nas pontas. */
export async function visitasNoPeriodo(
  userId: string,
  diaInicio: string,
  diaFim: string
): Promise<VisitasPeriodo> {
  const { data, error } = await supabaseAdmin
    .from("vitrine_visitas")
    .select("origem, total")
    .eq("user_id", userId)
    .gte("dia", diaInicio)
    .lte("dia", diaFim);

  if (error || !data) return { total: 0, catalogo: 0, direto: 0 };
  return data.reduce<VisitasPeriodo>(
    (acc, r: any) => {
      const n = Number(r.total) || 0;
      acc.total += n;
      if (r.origem === "catalogo") acc.catalogo += n;
      else acc.direto += n;
      return acc;
    },
    { total: 0, catalogo: 0, direto: 0 }
  );
}
