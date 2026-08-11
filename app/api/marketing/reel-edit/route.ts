// GET/POST /api/marketing/reel-edit — edição manual do reel (estilo CapCut):
// a CAPA (foto, título, logo, tempo) + duração de cada take + a legenda (callout)
// que aparece sobre ele.
// GET devolve as linhas já preenchidas (edição salva OU defaults) pra UI renderizar.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { SHOT_TAKES, ordenarTakes, segundosDoTake, type MarketingCapturas } from "@/lib/marketing-shotlist";
import { calloutsDoVeiculo, resolverCallout } from "@/lib/reel-callouts";
import { lerCalloutsSalvos } from "@/lib/reel-callouts-ia";
import { anoLabelDe, cfgFromRow, cleanMarca, cleanModelo } from "@/lib/marketing-kit";

export const dynamic = "force-dynamic";

const DEFAULT_SEG = 2.2;
const CAPA_SEG_PADRAO = 2.5; // = DUR.intro (75f @30fps) do remotion/theme.ts
const LABEL_TAKE: Record<string, string> = Object.fromEntries(SHOT_TAKES.map((s) => [s.tag, s.label]));

interface LinhaEdit {
  tag: string | null;
  label: string;   // rótulo do ângulo (referência interna)
  url: string;
  inicio: number;  // corte de início (segundo em que o clipe começa)
  fim: number;     // corte de fim (segundo em que o clipe termina)
  callout: string; // legenda editável
  subCallout: string; // sublegenda menor, abaixo do callout (editável, opcional)
}

export async function GET(req: NextRequest) {
  const veiculoId = req.nextUrl.searchParams.get("veiculoId");
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  const { data: veiculo } = await supabaseAdmin
    .from("veiculos")
    // Uma literal só: o supabase-js infere o tipo do row lendo esta string, e
    // concatenar com `+` faz a inferência desistir (row vira GenericStringError).
    .select("user_id, marca, modelo, versao, ano, ano_modelo, fotos, marketing_capturas, video_takes, marketing_reel_edit, opcionais, pontos_fortes_venda")
    .eq("id", veiculoId)
    .single();
  if (!veiculo) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

  const capturas: MarketingCapturas = veiculo.marketing_capturas ?? {};
  // Todos os takes gravados no carro (ordem da shot list), pra label/preview.
  const gravados: { url: string; tag: string | null }[] = (capturas.takes?.length)
    ? ordenarTakes(capturas.takes).map((t) => ({ url: t.url, tag: t.tag }))
    : (veiculo.video_takes ?? []).map((url: string) => ({ url, tag: null }));

  const callouts = calloutsDoVeiculo(veiculo);
  // Legendas por take geradas da ficha. Query própria porque a coluna vem da
  // migration 040, aplicada à mão: se ela não existir, isso devolve null e o
  // editor cai no rodízio antigo em vez de derrubar a rota inteira.
  const calloutsSalvos = await lerCalloutsSalvos(veiculoId);
  const salvos: any[] = Array.isArray(veiculo.marketing_reel_edit?.clips) ? veiculo.marketing_reel_edit.clips : [];

  const labelDe = (tag: string | null, idx: number) => (tag ? LABEL_TAKE[tag] ?? "Take" : `Take ${idx + 1}`);

  let linhas: LinhaEdit[];
  if (salvos.length) {
    // Existe edição salva: ela manda (respeita ordem, deletes, cortes). Como o
    // take deletado continua em marketing_capturas.takes, NÃO reanexamos os
    // gravados que faltam — senão o delete "voltaria". Só o que está no edit sai.
    linhas = salvos
      .filter((e) => typeof e?.url === "string")
      .map((e, i) => {
        // A url pode repetir (decupagem: N slots do mesmo arquivo-fonte), então a
        // tag salva no clip manda; o find por url é só retrocompat de edição antiga.
        const tag = typeof e.tag === "string" ? e.tag : gravados.find((t) => t.url === e.url)?.tag ?? null;
        const inicio = typeof e.inicio === "number" ? e.inicio : 0;
        const fim =
          typeof e.fim === "number" ? e.fim
            : typeof e.segundos === "number" ? inicio + e.segundos
              : inicio + segundosDoTake(tag);
        const r = resolverCallout({
          manual: typeof e.callout === "string" ? e.callout : null,
          tag, idx: i, salvos: calloutsSalvos, lista: callouts,
        });
        return {
          tag,
          label: labelDe(tag, i),
          url: e.url,
          inicio,
          fim,
          callout: r.callout,
          subCallout: typeof e.subCallout === "string" && e.subCallout ? e.subCallout : r.subCallout,
        };
      });
  } else {
    // Sem edição salva: lista todos os takes com defaults.
    linhas = gravados.map((t, i) => {
      const r = resolverCallout({ tag: t.tag, idx: i, salvos: calloutsSalvos, lista: callouts });
      return {
        tag: t.tag,
        label: labelDe(t.tag, i),
        url: t.url,
        inicio: 0,
        fim: segundosDoTake(t.tag),
        callout: r.callout,
        subCallout: r.subCallout,
      };
    });
  }

  const trilha = typeof veiculo.marketing_reel_edit?.trilha === "string" ? veiculo.marketing_reel_edit.trilha : "animado";
  const transicao = typeof veiculo.marketing_reel_edit?.transicao === "string" ? veiculo.marketing_reel_edit.transicao : "fade";

  // --- CAPA -----------------------------------------------------------------
  // O editor recebe os valores JÁ RESOLVIDOS (edição salva ou o automático que o
  // Remotion aplicaria), pra caixa de texto nunca aparecer vazia mostrando uma
  // capa que na verdade tem título. Junto vão as fotos candidatas pra troca.
  const { data: cfgRows } = await supabaseAdmin
    .from("config_garage")
    .select("*")
    .eq("user_id", veiculo.user_id)
    .order("created_at", { ascending: false })
    .limit(1);
  const cfg = cfgFromRow(cfgRows?.[0] ?? null);

  const fotosCapturadas = (capturas.fotos ?? []).map((f) => f.url);
  // Set preserva a ordem de inserção: as capturas guiadas vêm antes das fotos do anúncio.
  const fotos = [...new Set([...fotosCapturadas, ...((veiculo.fotos as string[]) ?? [])])].filter(Boolean).slice(0, 40);
  const fotoPadrao = capturas.fotos?.find((f) => f.tag === "frente-3-4")?.url ?? fotos[0] ?? null;

  const capaSalva = veiculo.marketing_reel_edit?.capa ?? null;
  const capa = {
    fotoUrl: (typeof capaSalva?.fotoUrl === "string" && capaSalva.fotoUrl) || fotoPadrao,
    titulo:
      typeof capaSalva?.titulo === "string"
        ? capaSalva.titulo
        : `${cleanMarca(veiculo.marca)} ${cleanModelo(veiculo.modelo)}`.trim().toUpperCase(),
    subtitulo:
      typeof capaSalva?.subtitulo === "string"
        ? capaSalva.subtitulo
        : [veiculo.versao, anoLabelDe(veiculo)].filter(Boolean).join(" • ").toUpperCase(),
    // cfg.fotoComMarca = a foto JÁ tem marca d'água → o Remotion não sobrepõe o logo.
    mostrarLogo: typeof capaSalva?.mostrarLogo === "boolean" ? capaSalva.mostrarLogo : !cfg.fotoComMarca,
    segundos: typeof capaSalva?.segundos === "number" ? capaSalva.segundos : CAPA_SEG_PADRAO,
  };
  const logoUrl = supabaseAdmin.storage
    .from("configuracoes")
    .getPublicUrl(`logos/${veiculo.user_id}.png`).data.publicUrl;

  return NextResponse.json({ clips: linhas, trilha, transicao, capa, fotos, logoUrl });
}

const TRILHAS_OK = new Set([
  "animado", "elegante", "emocional",
  "acao-esportiva", "blues-rock", "country-blues", "familia-alegre", "groove-energetico",
  "magnolia-town", "reels-marketing", "rock-alegre", "rock-classico", "rock-estrada",
  "rock-esportivo", "rock-impulso", "rock-inspirador", "rock-motivacional", "rock-power",
  "rock-vibrante", "nenhuma",
]);

const TRANSICOES_OK = new Set(["fade", "corte", "deslizar", "zoom", "desfoque"]);

export async function POST(req: NextRequest) {
  const { veiculoId, clips, trilha, transicao, capa } = await req.json();
  if (!veiculoId || !Array.isArray(clips)) {
    return NextResponse.json({ error: "veiculoId e clips obrigatórios" }, { status: 400 });
  }
  if (clips.length === 0) {
    return NextResponse.json({ error: "O reel precisa de pelo menos um take" }, { status: 400 });
  }

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  // O que a legenda AUTOMÁTICA diria hoje, take a take.
  //
  // Sem isso o editor congela o automático como se fosse edição manual: o GET
  // devolve a legenda já resolvida pra caixa de texto, o vendedor clica em
  // Salvar sem tocar nela, e ela volta pra cá como "manual" — que tem a maior
  // precedência em resolverCallout(). Foi o que aconteceu com o Tucson: os 10
  // clipes ficaram com o rodízio por índice gravado (clipe 9 = opcional [8],
  // "TRAVAS ELÉTRICAS COM" no take do farol), e "Gerar legendas da ficha" não
  // conseguia mais vencer. Só texto DIFERENTE do automático é edição de verdade.
  const { data: vAtual } = await supabaseAdmin
    .from("veiculos")
    .select("opcionais, pontos_fortes_venda, preco_sugerido, cor, marketing_reel_edit")
    .eq("id", veiculoId)
    .single();
  const listaAuto = calloutsDoVeiculo(vAtual ?? {});
  const calloutsSalvos = await lerCalloutsSalvos(veiculoId);
  const mesmoTexto = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

  // Sanitiza. A ORDEM do array é a ordem final dos clipes (reorder). url = fonte.
  const limpos = clips
    .slice(0, 20)
    .filter((c: any) => typeof c?.url === "string" && c.url.startsWith("https://"))
    .map((c: any, i: number) => {
      const inicio = Math.max(Number(c?.inicio) || 0, 0);
      // fim ao menos 1s depois do início; máx 8s de trecho
      const fimBruto = Number(c?.fim);
      const fim = Number.isFinite(fimBruto)
        ? Math.min(Math.max(fimBruto, inicio + 1), inicio + 15)
        : inicio + DEFAULT_SEG;

      const tag = typeof c?.tag === "string" ? c.tag : null;
      const auto = resolverCallout({ tag, idx: i, salvos: calloutsSalvos, lista: listaAuto });
      const calloutTxt = String(c?.callout ?? "").trim().slice(0, 40);
      const subTxt = String(c?.subCallout ?? "").trim().slice(0, 60);

      return {
        tag,
        url: c.url,
        inicio,
        fim,
        // "" = siga o automático. Guardar o texto igual ao automático o
        // fossilizaria e a legenda nunca mais acompanharia a ficha.
        callout: mesmoTexto(calloutTxt, auto.callout) ? "" : calloutTxt,
        subCallout: mesmoTexto(subTxt, auto.subCallout) ? "" : subTxt,
      };
    });

  const trilhaOk = typeof trilha === "string" && TRILHAS_OK.has(trilha) ? trilha : "animado";
  const transicaoOk = typeof transicao === "string" && TRANSICOES_OK.has(transicao) ? transicao : "fade";

  // Capa. O update troca o jsonb inteiro, então quem não manda `capa` (chamada
  // antiga) precisa ter a capa salva preservada — senão salvar os takes apagaria
  // a edição da capa em silêncio.
  let capaOk: Record<string, unknown> | null = null;
  if (capa && typeof capa === "object") {
    const seg = Number(capa.segundos);
    capaOk = {
      fotoUrl: typeof capa.fotoUrl === "string" && capa.fotoUrl.startsWith("https://") ? capa.fotoUrl : null,
      titulo: String(capa.titulo ?? "").trim().slice(0, 30),
      subtitulo: String(capa.subtitulo ?? "").trim().slice(0, 40),
      mostrarLogo: capa.mostrarLogo !== false,
      segundos: Number.isFinite(seg) ? Math.min(Math.max(seg, 1), 6) : CAPA_SEG_PADRAO,
    };
  } else {
    capaOk = (vAtual as any)?.marketing_reel_edit?.capa ?? null;
  }

  const { error: dbErr } = await supabaseAdmin
    .from("veiculos")
    .update({
      marketing_reel_edit: { clips: limpos, trilha: trilhaOk, transicao: transicaoOk, capa: capaOk },
    })
    .eq("id", veiculoId);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
