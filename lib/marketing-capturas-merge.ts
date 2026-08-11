// Fonte única de verdade dos takes de um veículo.
//
// Antes desta camada existiam duas listas divergentes:
//   - veiculos.video_takes[]            → array de URLs, append-only, SEM tag
//   - veiculos.marketing_capturas.takes → upsert por tag, COM tag
// O upload gravava numa, o registro na outra, e o DELETE só limpava a primeira.
// Resultado: take re-enviado duplicava em video_takes e take apagado voltava.
//
// Agora: `marketing_capturas.takes` é CANÔNICO e `video_takes` é espelho derivado
// (as mesmas URLs, na ordem narrativa da shot list). Quem lê video_takes
// (marketing-pipeline, reel-render, reel-edit, reel/route) continua funcionando.
// Toda escrita passa por aqui, num único .update().

import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  ordenarTakes,
  normalizarTag,
  segundosDoTake,
  type CapturaOrigem,
  type CapturaRegistro,
  type MarketingCapturas,
} from "@/lib/marketing-shotlist";

/** Um clipe do reel já resolvido: qual arquivo, em que slot, de onde até onde. */
export interface ClipeResolvido {
  tag: string | null;
  url: string;
  inicio: number;
  fim: number;
  /** o que o vendedor digitou naquele clipe ("" = seguir a legenda automática) */
  manualCallout: string | null;
  manualSub: string | null;
}

/**
 * A lista de clipes do reel, na ordem final. Fonte única do editor
 * (/api/marketing/reel-edit) e do render (lib/reel-render.ts) — enquanto isso
 * viveu duplicado nos dois, o editor mostrava uma coisa e o reel gerava outra.
 *
 * Sem edição salva: todos os takes, na ordem da shot list.
 * Com edição salva: ela manda na ORDEM, nos cortes e nos deletes, mas
 *   · a FONTE de cada slot é o take gravado hoje (regravar o slot atualiza aqui);
 *   · etiqueta que sumiu dos takes = take apagado → o clipe cai fora;
 *   · take gravado depois da edição entra no fim, salvo se estiver em `removidos`.
 */
export function clipesDoReel(veiculo: any): ClipeResolvido[] {
  const capturas: MarketingCapturas = veiculo?.marketing_capturas ?? {};
  const gravados: { url: string; tag: string | null }[] = capturas.takes?.length
    ? ordenarTakes(capturas.takes).map((t) => ({ url: t.url, tag: t.tag ?? null }))
    : ((veiculo?.video_takes ?? []) as string[]).map((url) => ({ url, tag: null }));

  const edit = veiculo?.marketing_reel_edit ?? null;
  const salvos: any[] = Array.isArray(edit?.clips) ? edit.clips : [];
  if (!salvos.length) {
    return gravados.map((t) => ({
      tag: t.tag,
      url: t.url,
      inicio: 0,
      fim: segundosDoTake(t.tag),
      manualCallout: null,
      manualSub: null,
    }));
  }

  const urlDaTag = new Map(gravados.filter((g) => g.tag).map((g) => [g.tag as string, g.url]));
  const removidos: { tag?: string | null; url?: string }[] = Array.isArray(edit?.removidos) ? edit.removidos : [];
  // A url entra na comparação de propósito: regravar o slot troca a url, e aí é
  // take NOVO — volta a aparecer mesmo tendo sido removido antes.
  const foiRemovido = (t: { url: string; tag: string | null }) =>
    removidos.some((r) => (r.tag ? r.tag === t.tag && r.url === t.url : r.url === t.url));

  const out: ClipeResolvido[] = [];
  for (const e of salvos) {
    if (typeof e?.url !== "string") continue;
    // A url pode repetir (decupagem: N slots do mesmo arquivo-fonte), então a tag
    // salva manda; o find por url é retrocompat de edição antiga, sem tag.
    const tag = typeof e.tag === "string" ? e.tag : gravados.find((t) => t.url === e.url)?.tag ?? null;
    const url = tag ? urlDaTag.get(tag) : e.url;
    if (!url) continue;
    // `removidos` ganha de tudo. Na prática os dois não coexistem (o POST calcula
    // removidos como "gravado que não veio na lista"), mas deixar a regra
    // explícita evita que um estado torto ressuscite um take apagado.
    if (foiRemovido({ url, tag })) continue;
    const inicio = typeof e.inicio === "number" ? Math.max(e.inicio, 0) : 0;
    const fim =
      typeof e.fim === "number" ? e.fim
        : typeof e.segundos === "number" ? inicio + e.segundos
          : inicio + segundosDoTake(tag);
    out.push({
      tag,
      url,
      inicio,
      fim,
      manualCallout: typeof e.callout === "string" ? e.callout : null,
      manualSub: typeof e.subCallout === "string" ? e.subCallout : null,
    });
  }

  const jaNaLista = new Set(out.map((c) => c.tag ?? c.url));
  for (const t of gravados) {
    if (jaNaLista.has(t.tag ?? t.url) || foiRemovido(t)) continue;
    out.push({ tag: t.tag, url: t.url, inicio: 0, fim: segundosDoTake(t.tag), manualCallout: null, manualSub: null });
  }
  return out;
}

/** Espelho de video_takes a partir da lista canônica. */
export function espelhoVideoTakes(takes: CapturaRegistro[]): string[] {
  return ordenarTakes(takes).map((t) => t.url);
}

/**
 * Aplica um upsert por tag na lista de takes.
 * `origem: "auto"` (decupagem) nunca sobrescreve um take "manual" — o vendedor
 * gravou aquilo à mão, a máquina não passa por cima. `forcar` ignora a regra.
 */
export function upsertTake(
  takes: CapturaRegistro[],
  novo: { tag: string; url: string; origem?: CapturaOrigem },
  opts: { forcar?: boolean } = {}
): { takes: CapturaRegistro[]; aplicado: boolean } {
  const tag = normalizarTag(novo.tag);
  const lista = [...takes];
  const idx = lista.findIndex((t) => normalizarTag(t.tag) === tag);
  if (idx >= 0) {
    const atual = lista[idx];
    const manualProtegido = novo.origem === "auto" && atual.origem === "manual" && !opts.forcar;
    if (manualProtegido) return { takes: lista, aplicado: false };
    lista[idx] = { tag, url: novo.url, origem: novo.origem ?? atual.origem ?? "manual" };
  } else {
    lista.push({ tag, url: novo.url, origem: novo.origem ?? "manual" });
  }
  return { takes: ordenarTakes(lista), aplicado: true };
}

/**
 * Grava a lista canônica + o espelho num único update.
 * Devolve o marketing_capturas final pra UI refletir sem refetch.
 */
export async function persistirTakes(
  veiculoId: string,
  capturas: MarketingCapturas,
  takes: CapturaRegistro[],
  extras: Record<string, any> = {}
): Promise<MarketingCapturas> {
  const ordenados = ordenarTakes(takes);
  const novas: MarketingCapturas = { ...capturas, takes: ordenados };
  const { error } = await supabaseAdmin
    .from("veiculos")
    .update({ ...extras, marketing_capturas: novas, video_takes: espelhoVideoTakes(ordenados) })
    .eq("id", veiculoId);
  if (error) throw new Error(error.message);
  return novas;
}

/**
 * Uma URL só pode sair do R2 quando NINGUÉM mais aponta pra ela. Com a decupagem
 * de um vídeo único, N slots podem referenciar o mesmo arquivo-fonte, e o
 * marketing_reel_edit também guarda urls. Apagar sem checar mata os outros slots.
 */
export function urlAindaEmUso(
  url: string,
  takesRestantes: CapturaRegistro[],
  reelEdit: any
): boolean {
  if (takesRestantes.some((t) => t.url === url)) return true;
  const clips = Array.isArray(reelEdit?.clips) ? reelEdit.clips : [];
  return clips.some((c: any) => c?.url === url);
}
