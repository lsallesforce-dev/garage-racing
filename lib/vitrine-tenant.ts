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
