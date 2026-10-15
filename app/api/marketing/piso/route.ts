// POST /api/marketing/piso — restaura o piso e a calçada de UMA foto do veículo.
// { veiculoId, fotoUrl, acao?: "restaurar" | "aplicar" | "reverter" }
//
//   restaurar → roda o pipeline, sobe a versão restaurada e guarda o par
//               original→restaurada em marketing_capturas.piso (não mexe em fotos[])
//   aplicar   → troca a original pela restaurada em fotos[] (reversível)
//   reverter  → desfaz o aplicar
//   enviar    → { ..., imagem: <JPEG em base64> } — a versão já vem pronta de
//               fora (app local do piso, Downloads/piso-local, sem API de IA):
//               sobe, registra o par e já APLICA. Reverter desfaz igual.
//
// O original NUNCA é sobrescrito no storage — o par guardado é o que torna a
// troca reversível.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { restaurarPiso } from "@/lib/marketing-piso";
import type { MarketingCapturas, PisoRegistro } from "@/lib/marketing-shotlist";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Acao = "restaurar" | "aplicar" | "reverter" | "enviar";
const ACOES: Acao[] = ["restaurar", "aplicar", "reverter", "enviar"];

/** Teto do JPEG enviado. O corpo da função na Vercel morre em 4,5 MB e o
 *  base64 incha 33%: 3 MB de JPEG ≈ 4 MB de JSON. */
const MAX_ENVIO_BYTES = 3 * 1024 * 1024;

async function subirJpeg(veiculoId: string, buffer: Buffer): Promise<string> {
  const key = `marketing/${veiculoId}/piso-${Date.now()}.jpg`;
  const { error } = await supabaseAdmin.storage
    .from("fotos-veiculos")
    .upload(key, buffer, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`Upload falhou: ${error.message}`);
  return supabaseAdmin.storage.from("fotos-veiculos").getPublicUrl(key).data.publicUrl;
}

async function salvarCapturas(veiculoId: string, capturas: MarketingCapturas, fotos?: string[]) {
  const patch: Record<string, unknown> = { marketing_capturas: capturas };
  if (fotos) patch.fotos = fotos;
  const { error } = await supabaseAdmin.from("veiculos").update(patch).eq("id", veiculoId);
  if (error) throw new Error(`Não consegui salvar: ${error.message}`);
}

export async function POST(req: NextRequest) {
  try {
    const { veiculoId, fotoUrl, acao: acaoBruta, imagem } = await req.json();
    if (!veiculoId || !fotoUrl) {
      return NextResponse.json({ error: "veiculoId e fotoUrl obrigatórios" }, { status: 400 });
    }
    const acao: Acao = ACOES.includes(acaoBruta) ? acaoBruta : "restaurar";

    const { error: authError } = await requireVehicleOwner(veiculoId);
    if (authError) return authError;

    const { data: v } = await supabaseAdmin
      .from("veiculos")
      .select("marketing_capturas, fotos")
      .eq("id", veiculoId)
      .single();
    if (!v) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

    const capturas: MarketingCapturas = (v.marketing_capturas as MarketingCapturas) ?? {};
    const piso: PisoRegistro[] = Array.isArray(capturas.piso) ? [...capturas.piso] : [];
    const fotos: string[] = Array.isArray(v.fotos) ? [...v.fotos] : [];

    // ------------------------------------------------------------- aplicar
    if (acao === "aplicar" || acao === "reverter") {
      const i = piso.findIndex((p) => p.original === fotoUrl);
      if (i < 0) return NextResponse.json({ error: "Essa foto ainda não tem versão restaurada" }, { status: 404 });
      const reg = piso[i];
      const de = acao === "aplicar" ? reg.original : reg.restaurada;
      const para = acao === "aplicar" ? reg.restaurada : reg.original;
      const pos = fotos.indexOf(de);
      if (pos >= 0) fotos[pos] = para;
      else if (acao === "aplicar") fotos.unshift(para);
      piso[i] = { ...reg, aplicada: acao === "aplicar" };
      // A capa/carrossel do kit escolhem a foto pela lista ETIQUETADA
      // (capturas.fotos, ex: tag "frente-3-4"), não pela galeria fotos[] —
      // sem trocar aqui também, "Usar no anúncio" nunca refletia na capa
      // mesmo com o Regerar Kit disparado depois (achado 02/09).
      const capturasNovas: MarketingCapturas = {
        ...capturas,
        piso,
        fotos: (capturas.fotos ?? []).map((f) => (f.url === de ? { ...f, url: para } : f)),
      };
      await salvarCapturas(veiculoId, capturasNovas, fotos);
      return NextResponse.json({ ok: true, aplicada: acao === "aplicar", fotos });
    }

    // -------------------------------------------------------------- enviar
    if (acao === "enviar") {
      if (typeof imagem !== "string" || !imagem) {
        return NextResponse.json({ error: "imagem (JPEG em base64) obrigatória" }, { status: 400 });
      }
      const buffer = Buffer.from(imagem.replace(/^data:image\/jpeg;base64,/, ""), "base64");
      const ehJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      if (!ehJpeg) return NextResponse.json({ error: "A imagem precisa ser JPEG" }, { status: 400 });
      if (buffer.length > MAX_ENVIO_BYTES) {
        return NextResponse.json({ error: "Imagem acima de 3 MB" }, { status: 413 });
      }

      // A foto que o app baixou pode ser uma restaurada de antes (deste mesmo
      // fluxo ou do Kit): o "original" do registro continua sendo a crua.
      const anterior = piso.find((p) => p.original === fotoUrl || p.restaurada === fotoUrl);
      const original = anterior?.original ?? fotoUrl;
      let emUso = anterior?.aplicada ? anterior.restaurada : original;
      if (!fotos.includes(emUso) && fotos.includes(fotoUrl)) emUso = fotoUrl;

      let restaurada: string;
      try {
        restaurada = await subirJpeg(veiculoId, buffer);
      } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 502 });
      }

      const pos = fotos.indexOf(emUso);
      if (pos >= 0) fotos[pos] = restaurada;
      else fotos.unshift(restaurada);
      // Mesma troca na lista etiquetada — ver comentário do "aplicar".
      const capturasNovas: MarketingCapturas = {
        ...capturas,
        piso: [
          ...piso.filter((p) => p.original !== original),
          { original, restaurada, aplicada: true },
        ],
        fotos: (capturas.fotos ?? []).map((f) => (f.url === emUso ? { ...f, url: restaurada } : f)),
      };
      await salvarCapturas(veiculoId, capturasNovas, fotos);
      return NextResponse.json({ ok: true, original, restaurada, aplicada: true, fotos });
    }

    // ----------------------------------------------------------- restaurar
    const r = await restaurarPiso(fotoUrl);
    if (!r.editado) {
      return NextResponse.json({ editado: false, motivo: r.motivo ?? "Nada a corrigir" });
    }

    let restaurada: string;
    try {
      restaurada = await subirJpeg(veiculoId, r.buffer);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }

    // Regerar a mesma foto substitui o registro (e a `aplicada` volta a valer
    // pro par novo — senão o "reverter" apontaria pra uma URL órfã).
    const anterior = piso.find((p) => p.original === fotoUrl);
    const novo: PisoRegistro = { original: fotoUrl, restaurada, aplicada: false };
    const pisoNovo = [...piso.filter((p) => p.original !== fotoUrl), novo];

    // Se a versão antiga já estava aplicada em fotos[], aponta pra nova na hora —
    // deixar a URL velha lá é como o "kit antigo" some sem ninguém perceber.
    // Mesma troca precisa acontecer na lista etiquetada (ver comentário acima).
    let fotosNovas: string[] | undefined;
    let capturasFotos = capturas.fotos;
    if (anterior?.aplicada) {
      const pos = fotos.indexOf(anterior.restaurada);
      if (pos >= 0) {
        fotos[pos] = restaurada;
        fotosNovas = fotos;
        novo.aplicada = true;
        capturasFotos = (capturas.fotos ?? []).map((f) =>
          f.url === anterior.restaurada ? { ...f, url: restaurada } : f
        );
      }
    }

    await salvarCapturas(veiculoId, { ...capturas, piso: pisoNovo, fotos: capturasFotos }, fotosNovas);
    return NextResponse.json({ editado: true, original: fotoUrl, restaurada, tiles: r.tiles, aplicada: novo.aplicada });
  } catch (e: any) {
    console.error("❌ [api/marketing/piso]", e);
    return NextResponse.json({ error: e?.message ?? "Erro ao restaurar o piso" }, { status: 500 });
  }
}
