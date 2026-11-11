// Resolução do tenant da vitrine pública (slug → config_garage).
//
// Estava inline em app/vitrine/[tenant]/page.tsx; saiu pra cá quando o feed de
// catálogo (feed.csv) passou a precisar da MESMA resolução. Duas cópias
// divergiriam em silêncio — e a regra do `.limit(1)` abaixo é justamente do
// tipo que se perde numa cópia.

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const GARAGE_COLS =
  "user_id, nome_empresa, whatsapp, whatsapp_agente, logo_url, vitrine_tema, dominio_custom, cidade, estado, endereco, endereco_complemento, horario_funcionamento, telefone_loja, plano_ativo, plano_vence_em, trial_ends_at, bloqueado, meta_pixel_id";

// Resolve o tenant por vitrine_slug (curto) ou webhook_token (links antigos compartilhados).
// `config_garage` tem MAIS DE UMA linha por user_id — daí o order+limit(1) em vez
// de .single(), que devolveria null em silêncio.
export async function resolveGaragem(tenant: string) {
  const bySlug = await supabaseAdmin
    .from("config_garage")
    .select(GARAGE_COLS)
    .eq("vitrine_slug", tenant)
    .order("created_at", { ascending: false })
    .limit(1);
  if (bySlug.data?.[0]) return bySlug.data[0] as any;

  const byToken = await supabaseAdmin
    .from("config_garage")
    .select(GARAGE_COLS)
    .eq("webhook_token", tenant)
    .order("created_at", { ascending: false })
    .limit(1);
  return (byToken.data?.[0] as any) ?? null;
}

/** Base pública da vitrine do tenant — domínio próprio quando existe. */
export function baseVitrine(garagem: any, tenant: string): string {
  const dominio = (garagem?.dominio_custom as string | undefined)?.trim();
  if (dominio) return `https://${dominio.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  const app = (process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital").replace(/\/+$/, "");
  return `${app}/vitrine/${tenant}`;
}

/**
 * Ícone da loja (aba + resultado do Google) — app/vitrine/[tenant]/icone.
 * Sem isso a vitrine herdava o "Z" do AutoZap do app/layout.tsx, inclusive no
 * domínio próprio. Sem logo cadastrada, devolve undefined e fica o padrão.
 * O ?v= vem da URL da logo (o upload grava ?v=<timestamp>): trocou a logo, o
 * navegador e o Google buscam de novo.
 */
export function iconesDaVitrine(garagem: any, tenant: string) {
  const logo = String(garagem?.logo_url ?? "").trim();
  if (!logo) return undefined;
  const versao = logo.match(/[?&]v=([\w-]+)/)?.[1] ?? "1";
  const url = `/vitrine/${garagem?.vitrine_slug ?? tenant}/icone?v=${versao}`;
  return { icon: [{ url, type: "image/png", sizes: "192x192" }], shortcut: url, apple: url };
}

/**
 * Loja dona do host, quando a request chega pelo DOMÍNIO PRÓPRIO
 * (www.aprovemultimarcas.com.br). robots.txt e sitemap.xml ficam fora do proxy
 * (matcher), então no domínio próprio eles caíam nos do AutoZap: o Google lia
 * um sitemap com 344 URLs de autozap.digital e nenhuma da loja (11/11/2026).
 * Host do AutoZap / Vercel / local → null (sitemap institucional).
 */
export async function garagemDoHost(hostCru: string | null | undefined) {
  const host = String(hostCru ?? "").toLowerCase().split(":")[0].trim();
  if (!host || host === "localhost" || host.endsWith("autozap.digital") || host.endsWith(".vercel.app")) return null;
  const alt = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("user_id, vitrine_slug, dominio_custom, updated_at")
    .in("dominio_custom", [host, alt])
    .limit(1);
  const g = data?.[0];
  if (!g?.dominio_custom) return null;
  const base = `https://${String(g.dominio_custom).replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return { userId: g.user_id as string, slug: g.vitrine_slug as string | null, base, updatedAt: g.updated_at as string | null };
}
