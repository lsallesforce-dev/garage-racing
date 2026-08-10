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
  type CapturaOrigem,
  type CapturaRegistro,
  type MarketingCapturas,
} from "@/lib/marketing-shotlist";

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
