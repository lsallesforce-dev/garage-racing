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

/**
 * De onde o acesso veio. A página só sabe dizer 'catalogo' (link do feed pago,
 * ?o=cat) ou 'direto'; o resto é deduzido aqui, do Referer e do navegador
 * embutido dos apps — ver `deduzirOrigem`.
 */
export type OrigemVisita =
  | "catalogo"
  | "instagram"
  | "facebook"
  | "google"
  | "whatsapp"
  | "navegacao"
  | "direto";

// Por que isso existe (14/09): a vitrine da APROVE passou a receber ~160
// acessos/dia "diretos" e ninguém sabia de onde. Sem Referer não dá pra
// separar bio do Instagram, post turbinado, Google ou gente clicando carro por
// carro dentro do próprio site — e cada uma dessas pede decisão diferente.
//
// Só o HOSTNAME do Referer é olhado e nada é gravado além do rótulo final.
function deduzirOrigem(base: OrigemVisita, referer: string, ua: string, hostAtual: string): OrigemVisita {
  if (base === "catalogo") return base;

  // Navegador embutido do app: o Instagram e o Facebook costumam NÃO mandar
  // Referer quando abrem link da bio ou do post, mas se identificam no UA.
  if (/Instagram/i.test(ua)) return "instagram";
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return "facebook";

  let host = "";
  try {
    host = referer ? new URL(referer).hostname.toLowerCase() : "";
  } catch {
    host = "";
  }
  if (!host) return "direto";

  // Clique dentro da própria vitrine (home → carro, "Mais carros"). Separado
  // porque 1 pessoa olhando 6 carros vira 6 acessos — sem isso o total parece
  // gente nova chegando.
  const semWww = (h: string) => h.replace(/^www\./, "");
  if (hostAtual && semWww(host) === semWww(hostAtual)) return "navegacao";
  if (/(^|\.)autozap\.digital$/.test(host)) return "navegacao";

  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  if (/(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.me$/.test(host)) return "facebook";
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return "google";
  if (/whatsapp|wa\.me/.test(host)) return "whatsapp";
  return "direto";
}

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
  let referer = "";
  let hostAtual = "";
  let metodo = "GET";
  let idioma = "";
  try {
    const h = await headers();
    ua = h.get("user-agent") ?? "";
    referer = h.get("referer") ?? "";
    hostAtual = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(":")[0];
    // `x-metodo` vem do proxy.ts — Server Component não enxerga o método sozinho.
    metodo = (h.get("x-metodo") ?? "GET").toUpperCase();
    idioma = h.get("accept-language") ?? "";
  } catch {
    return;
  }
  if (!ua || ROBO_RE.test(ua)) return;
  // Duas peneiras a mais, pro que sobra de robô com user agent de navegador
  // (17/09: ~115 acessos/dia "diretos", com a IA mandando o link só 3-5x por dia):
  //   - HEAD/OPTIONS não é visita: é link-checker perguntando se a página existe.
  //     No log apareciam de 10 em 10 minutos, sempre no mesmo carro.
  //   - sem Accept-Language: navegador manda sempre, robô quase nunca se lembra.
  // Nenhuma das duas guarda nada — continuam só decidindo se conta ou não.
  if (metodo !== "GET") return;
  if (!idioma) return;
  const origemFinal = deduzirOrigem(origem, referer, ua, hostAtual);

  after(async () => {
    try {
      const { error } = await supabaseAdmin.rpc("registrar_visita_vitrine", {
        p_user_id: userId,
        p_origem: origemFinal,
      });
      if (error) console.warn("⚠️ [vitrine-visitas] rpc:", error.message);
    } catch (e) {
      console.warn("⚠️ [vitrine-visitas]", e);
    }
  });
}

export type VisitasPeriodo = {
  total: number;
  catalogo: number;
  direto: number;
  /** Total por origem ('instagram', 'google', 'navegacao'...). */
  porOrigem: Record<string, number>;
};

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

  if (error || !data) return { total: 0, catalogo: 0, direto: 0, porOrigem: {} };
  return data.reduce<VisitasPeriodo>(
    (acc, r: any) => {
      const n = Number(r.total) || 0;
      acc.total += n;
      if (r.origem === "catalogo") acc.catalogo += n;
      else acc.direto += n;
      acc.porOrigem[r.origem] = (acc.porOrigem[r.origem] ?? 0) + n;
      return acc;
    },
    { total: 0, catalogo: 0, direto: 0, porOrigem: {} as Record<string, number> }
  );
}
