// lib/mercadolivre-sync.ts
// Traz pro AutoZap todos os anúncios da conta ML do tenant — inclusive os criados
// direto no painel do ML — com status, qualidade e visitas. Casa cada item com o
// veículo do estoque por ml_item_id ou pela placa (LICENSE_PLATE).

import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMLToken, mlHeaders, ML_API } from "@/lib/mercadolivre";

const soPlaca = (p: string | null | undefined) => (p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Atributos de carro elétrico (e o horário de contato) não contam pra ficha de carro a combustão:
// a S10 com nota 66 só não tinha esses — e o ML não cobrava nada da ficha dela.
const ATTR_IGNORADOS = /^(BATTERY_|CHARGE|CHARGER_|CARS_BATTERY_|HAS_AUTOPILOT$|CONTACT_SCHEDULE$)/;

type Objetivo = { tipo: "ficha" | "video" | "fotos"; texto: string };

// A API do ML não expõe os objetivos de qualidade pra classificado de veículo
// (/item/{id}/performance → "Item classified is not supported"; health/actions → 403).
// Estimativa calibrada nos anúncios reais da APROVE (28/10): nota 50 = "2 objetivos" no painel
// (ficha técnica + vídeo); a S10 com ficha completa = 66, "1 objetivo" (vídeo). Descrição curta
// NÃO conta — os de 50 têm 256–370 caracteres e o painel mostra só 2.
function objetivosQualidade(it: any, attrsCategoria: { id: string; name: string }[]): Objetivo[] {
  const preenchidos = new Set((it.attributes ?? []).filter((a: any) => a.value_name).map((a: any) => a.id));
  const relevantes  = attrsCategoria.filter(a => !ATTR_IGNORADOS.test(a.id));
  // Equipamentos (HAS_*/WITH_*) primeiro nos exemplos — é o que o lojista sabe responder
  const faltando    = relevantes.filter(a => !preenchidos.has(a.id))
    .sort((a, b) => Number(/^(HAS|WITH)_/.test(b.id)) - Number(/^(HAS|WITH)_/.test(a.id)));
  const obj: Objetivo[] = [];
  if (faltando.length > 0) {
    const pct = Math.round(((relevantes.length - faltando.length) / relevantes.length) * 100);
    const ex  = faltando.slice(0, 5).map(a => a.name.toLowerCase()).join(", ");
    obj.push({ tipo: "ficha", texto: `Completar a ficha técnica (${pct}% preenchida — faltam ${faltando.length} itens, ex.: ${ex})` });
  }
  if (!it.video_id) obj.push({ tipo: "video", texto: "Adicionar vídeo do YouTube ao anúncio" });
  if ((it.pictures ?? []).length < 10) obj.push({ tipo: "fotos", texto: `Só ${(it.pictures ?? []).length} fotos — o ML favorece 10 ou mais` });
  return obj;
}

const STATUS_ML: Record<string, string> = {
  active:       "ativo",
  paused:       "pausado",
  closed:       "removido",
  under_review: "pendente",
  inactive:     "pausado",
};

export async function syncAnunciosML(userId: string): Promise<{ sincronizados: number; semVeiculo: string[] } | null> {
  const token = await getMLToken(userId);
  if (!token) return null;

  const { data: cfgRows } = await supabaseAdmin
    .from("config_garage")
    .select("ml_user_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const mlUserId = cfgRows?.[0]?.ml_user_id;
  if (!mlUserId) return null;

  // 1. Todos os itens da conta (paginado; search devolve ativos + pausados + em revisão)
  const ids: string[] = [];
  for (let offset = 0; offset < 1000; offset += 50) {
    const r = await fetch(`${ML_API}/users/${mlUserId}/items/search?limit=50&offset=${offset}`, { headers: mlHeaders(token) });
    if (!r.ok) { console.error("❌ ML sync: items/search falhou", r.status); return null; }
    const j = await r.json();
    ids.push(...(j.results ?? []));
    if (ids.length >= (j.paging?.total ?? 0) || !(j.results ?? []).length) break;
  }

  // 2. Detalhe em lotes de 20 (limite do multiget)
  const itens: any[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const lote = ids.slice(i, i + 20).join(",");
    const r = await fetch(
      `${ML_API}/items?ids=${lote}&attributes=id,title,price,status,health,date_created,pictures,attributes,permalink,video_id`,
      { headers: mlHeaders(token) },
    );
    if (!r.ok) continue;
    for (const x of await r.json()) if (x.code === 200) itens.push(x.body);
  }

  // 3. Visitas — o endpoint só aceita 1 id por chamada
  const visitas: Record<string, number> = {};
  await Promise.all(itens.map(async it => {
    const r = await fetch(`${ML_API}/visits/items?ids=${it.id}`, { headers: mlHeaders(token) }).catch(() => null);
    if (r?.ok) visitas[it.id] = Number((await r.json())?.[it.id] ?? 0);
  }));

  // Atributos visíveis da categoria — base da ficha técnica (endpoint público)
  const attrsCategoria: { id: string; name: string }[] = await fetch(`${ML_API}/categories/MLB1744/attributes`)
    .then(r => (r.ok ? r.json() : []))
    .then((l: any[]) => l.filter(a => !a.tags?.hidden && !a.tags?.read_only).map(a => ({ id: a.id, name: a.name })))
    .catch(() => []);

  // 4. Casa com o estoque: ml_item_id primeiro, depois placa
  const { data: veiculos } = await supabaseAdmin
    .from("veiculos")
    .select("id, placa, ml_item_id, relatorio_ia, detalhes_inspecao")
    .eq("user_id", userId);
  const porItem  = new Map((veiculos ?? []).filter(v => v.ml_item_id).map(v => [v.ml_item_id as string, v]));
  const porPlaca = new Map((veiculos ?? []).filter(v => soPlaca(v.placa)).map(v => [soPlaca(v.placa), v]));

  const { data: existentes } = await supabaseAdmin
    .from("anuncios")
    .select("veiculo_id, portal_ad_id, descricao, publicado_em")
    .eq("user_id", userId)
    .eq("portal", "mercadolivre");
  const existente = new Map((existentes ?? []).map(a => [a.veiculo_id, a]));

  const semVeiculo: string[] = [];
  const agora = new Date().toISOString();
  let sincronizados = 0;

  for (const it of itens) {
    const placa = soPlaca(it.attributes?.find((a: any) => a.id === "LICENSE_PLATE")?.value_name);
    const v = porItem.get(it.id) ?? (placa ? porPlaca.get(placa) : undefined);
    if (!v) { semVeiculo.push(`${it.id} ${it.title}`); continue; }

    const status = STATUS_ML[it.status] ?? it.status;
    const antes  = existente.get(v.id);
    const { error } = await supabaseAdmin.from("anuncios").upsert({
      user_id:      userId,
      veiculo_id:   v.id,
      portal:       "mercadolivre",
      portal_ad_id: it.id,
      status,
      titulo:       it.title,
      descricao:    antes?.descricao ?? (v.relatorio_ia || v.detalhes_inspecao || null),
      preco:        it.price,
      fotos:        (it.pictures ?? []).map((p: any) => p.secure_url ?? p.url).filter(Boolean).slice(0, 12),
      snapshot: {
        listing_type: "silver",
        category:     "MLB1744",
        permalink:    it.permalink,
        qualidade:    it.health != null ? Math.round(Number(it.health) * 100) : null,
        visitas:      visitas[it.id] ?? null,
        ml_status:    it.status,
        objetivos:    attrsCategoria.length ? objetivosQualidade(it, attrsCategoria) : null,
        sincronizado_em: agora,
      },
      publicado_em:  antes?.publicado_em ?? it.date_created,
      atualizado_em: agora,
    }, { onConflict: "veiculo_id,portal" });
    if (error) { console.error("❌ ML sync: upsert anuncios", it.id, error.message); continue; }

    if (v.ml_item_id !== it.id || status === "removido") {
      await supabaseAdmin.from("veiculos")
        .update({ ml_item_id: status === "removido" ? null : it.id, status_ml: status === "ativo" ? "publicado" : status })
        .eq("id", v.id);
    }
    sincronizados++;
  }

  // 5. Anúncio que o AutoZap achava no ar mas sumiu da conta (encerrado/excluído no painel do ML)
  const vistos = new Set(itens.map(it => it.id));
  const sumidos = (existentes ?? []).filter(a => a.portal_ad_id && !vistos.has(a.portal_ad_id)).map(a => a.portal_ad_id as string);
  if (sumidos.length) {
    await supabaseAdmin.from("anuncios")
      .update({ status: "removido", atualizado_em: agora })
      .eq("user_id", userId).eq("portal", "mercadolivre").in("portal_ad_id", sumidos).neq("status", "deletado");
  }

  if (semVeiculo.length) console.warn(`⚠️ ML sync ${userId}: ${semVeiculo.length} anúncio(s) sem veículo no estoque (placa não bate):`, semVeiculo.join(" | "));
  return { sincronizados, semVeiculo };
}
