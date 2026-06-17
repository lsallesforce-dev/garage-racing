// app/api/webmotors/publicar/route.ts
// Publica (ou atualiza) um veículo na Webmotors via API SOAP (.asmx).
//
// Fluxo:
//   1. Busca veículo + config do tenant (incluindo cnpj)
//   2. HashAutenticacao via SOAP (CNPJ + e-mail + senha) — sem OAuth
//   3. Carrega tabelas de domínio em paralelo (Marca, Cores, Combustível, Câmbio, Modalidade)
//   4. Resolve códigos (Marca → Modelo → Versão) via matchItem
//   5. IncluirCarro (novo) ou AlterarCarro (já publicado)
//   6. Loop de fotos: baixa URL → base64 → IncluirFoto
//   7. Atualiza status_webmotors + webmotors_id no banco

import { NextRequest, NextResponse } from "next/server";
import { requireVehicleOwner, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  getBearer,
  autenticar,
  obterMarca,
  obterModelo,
  obterVersao,
  obterCores,
  obterCombustivel,
  obterCambio,
  obterModalidade,
  matchItem,
  matchDominioWM,
  incluirCarro,
  alterarCarro,
  incluirFoto,
  type AnuncioWM,
} from "@/lib/webmotors-soap";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { veiculoId } = await req.json();
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const auth = await requireVehicleOwner(veiculoId);
  if (auth.error) return auth.error;
  const userId = getEffectiveUserId(auth.user!);

  // Busca veículo e config do tenant em paralelo
  const [{ data: v }, { data: cfgs }] = await Promise.all([
    supabaseAdmin
      .from("veiculos")
      .select(
        "marca, modelo, versao, ano_fabricacao, ano_modelo, preco_sugerido, quilometragem_estimada, combustivel, cambio, cor, placa, condicao, fotos, opcionais, webmotors_id"
      )
      .eq("id", veiculoId)
      .single(),
    supabaseAdmin
      .from("config_garage")
      .select("cnpj, webmotors_usuario, webmotors_senha")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const cfg = cfgs?.[0] ?? null;

  if (!v) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
  if (!cfg?.webmotors_usuario || !cfg?.webmotors_senha) {
    return NextResponse.json({ error: "Credenciais Webmotors não configuradas" }, { status: 400 });
  }
  if (!cfg.cnpj) {
    return NextResponse.json({ error: "CNPJ não configurado na conta" }, { status: 400 });
  }

  // ── Auth SOAP ─────────────────────────────────────────────────────────────
  let bearer: string;
  let hash: string;
  try {
    bearer = await getBearer(cfg.webmotors_usuario, cfg.webmotors_senha);
    // CNPJ enviado como armazenado (o manual/collection usa o formato com máscara, ex. 12.319.744/0001-52)
    hash = await autenticar(cfg.cnpj.trim(), cfg.webmotors_usuario, cfg.webmotors_senha, bearer);
  } catch (e: any) {
    console.error("❌ Webmotors auth SOAP:", e.message);
    return NextResponse.json({ error: `Falha na autenticação Webmotors: ${e.message}` }, { status: 502 });
  }

  // ── Tabelas de domínio (paralelo) ─────────────────────────────────────────
  let marcas, cores, combustiveis, cambios, modalidades;
  try {
    [marcas, cores, combustiveis, cambios, modalidades] = await Promise.all([
      obterMarca(hash, bearer),
      obterCores(hash, bearer),
      obterCombustivel(hash, bearer),
      obterCambio(hash, bearer),
      obterModalidade(hash, bearer),
    ]);
  } catch (e: any) {
    console.error("❌ Webmotors Obter* tabelas:", e.message);
    return NextResponse.json({ error: `Erro ao carregar tabelas Webmotors: ${e.message}` }, { status: 502 });
  }

  // ── Resolve Marca → Modelo → Versão ──────────────────────────────────────
  const marcaItem = matchItem(marcas, v.marca ?? "");
  if (!marcaItem) {
    return NextResponse.json({ error: `Marca "${v.marca}" não encontrada na Webmotors` }, { status: 422 });
  }

  let modelos, versoes;
  try {
    modelos = await obterModelo(hash, bearer, marcaItem.codigo);
    const modeloItem = matchItem(modelos, v.modelo ?? "");
    if (!modeloItem) {
      return NextResponse.json({ error: `Modelo "${v.modelo}" não encontrado para a marca "${v.marca}"` }, { status: 422 });
    }

    versoes = await obterVersao(hash, bearer, modeloItem.codigo);
    const versaoItem = matchItem(versoes, v.versao ?? v.modelo ?? "");

    const coreItem = matchDominioWM(cores, v.cor ?? "", "cor");
    const combItem = matchDominioWM(combustiveis, v.combustivel ?? "", "combustivel");
    const cambItem = matchDominioWM(cambios, v.cambio ?? "", "cambio");

    const isNovo = (v.condicao ?? "").toLowerCase().includes("nov");
    const modalidadeItem = isNovo
      ? (modalidades.find((m) => /nov/i.test(m.descricao)) ?? modalidades[0])
      : (modalidades.find((m) => /usad/i.test(m.descricao)) ?? modalidades[1] ?? modalidades[0]);

    const anuncio: AnuncioWM = {
      codigoAnuncio:    v.webmotors_id ?? "0",
      codigoModalidade: modalidadeItem?.codigo ?? "1",
      tipoAnuncio:      isNovo ? "N" : "U",
      codigoMarca:      marcaItem.codigo,
      codigoModelo:     modeloItem.codigo,
      codigoVersao:     versaoItem?.codigo ?? modelos[0]?.codigo ?? "0",
      anoModelo:        v.ano_modelo ?? v.ano_fabricacao ?? new Date().getFullYear(),
      anoFabricacao:    v.ano_fabricacao ?? v.ano_modelo ?? new Date().getFullYear(),
      km:               v.quilometragem_estimada ?? 0,
      placa:            v.placa ?? undefined,
      codigoCambio:     cambItem?.codigo ?? "0",
      nrPortas:         4,
      codigoCor:        coreItem?.codigo ?? "0",
      codigoCombustivel: combItem?.codigo ?? "0",
      // PrecoVenda = preço real ao consumidor (aparece na busca do site).
      // PrecoReal (preço de revenda/repasse B2B — só aparece no Correio WebMotors, manual *08)
      // DEVE ser diferente de PrecoVenda: enviá-los iguais retorna 22|78 ("preço de venda
      // inválido"). O exemplo oficial usa PrecoReal > PrecoVenda. Aplica +5% como âncora.
      precoVenda:       v.preco_sugerido ?? 0,
      precoReal:        Math.round((v.preco_sugerido ?? 0) * 1.05),
      // Descrição automática — anúncio sem Observacao é candidato ao erro 22|78.
      observacao: [
        `${v.marca ?? ""} ${v.modelo ?? ""}${v.versao ? " " + v.versao : ""}`.trim(),
        (v.ano_fabricacao || v.ano_modelo) ? `Ano ${v.ano_fabricacao ?? v.ano_modelo}/${v.ano_modelo ?? v.ano_fabricacao}` : "",
        v.quilometragem_estimada != null ? `${v.quilometragem_estimada} km` : "",
        v.cor ? `Cor ${v.cor}` : "",
        v.cambio ? `Câmbio ${v.cambio}` : "",
        "Agende sua visita!",
      ].filter(Boolean).join(". "),
    };

    // Diagnóstico: códigos resolvidos vs valores crus do veículo. A WM rejeita
    // campo a campo (CodigoRetorno=43|N); este resumo diz QUAL campo ficou "0"/sem match.
    // Lista opções reais da WM só p/ o campo que NÃO casou — revela o vocabulário correto.
    const ops = (itens: { descricao: string }[]) => itens.slice(0, 20).map((i) => i.descricao).join(", ");
    const diag =
      `[diag] cambio "${v.cambio ?? ""}"→${cambItem?.codigo ?? `0(SEM MATCH; opções WM: ${ops(cambios)})`} | ` +
      `cor "${v.cor ?? ""}"→${coreItem?.codigo ?? `0(SEM MATCH; opções WM: ${ops(cores)})`} | ` +
      `combustivel "${v.combustivel ?? ""}"→${combItem?.codigo ?? `0(SEM MATCH; opções WM: ${ops(combustiveis)})`} | ` +
      `versao "${v.versao ?? v.modelo ?? ""}"→${versaoItem?.codigo ?? "(SEM MATCH, usou fallback)"} | ` +
      `modalidade→${modalidadeItem?.codigo ?? "?"} | ` +
      `MODALIDADES DISPONÍVEIS: ${modalidades.map((m) => `${m.codigo}=${m.descricao}`).join(" / ")}`;

    // ── Publica ou atualiza ───────────────────────────────────────────────
    let codigoAnuncio: string;
    try {
      if (v.webmotors_id) {
        codigoAnuncio = await alterarCarro(hash, bearer, anuncio);
        console.log(`✅ Webmotors: AlterarCarro ${veiculoId} → anúncio ${codigoAnuncio}`);
      } else {
        codigoAnuncio = await incluirCarro(hash, bearer, anuncio);
        console.log(`✅ Webmotors: IncluirCarro ${veiculoId} → anúncio ${codigoAnuncio}`);
      }
    } catch (e: any) {
      console.error("❌ Webmotors IncluirCarro/AlterarCarro:", e.message, diag);
      return NextResponse.json({ error: `${e.message} — ${diag}` }, { status: 502 });
    }

    // ── Fotos (somente em inclusão nova; alteração mantém as existentes) ──
    const fotos: string[] = Array.isArray(v.fotos) ? v.fotos.filter(Boolean) : [];
    if (!v.webmotors_id && fotos.length > 0) {
      let fotosSent = 0;
      for (const url of fotos.slice(0, 30)) {
        try {
          const resp = await fetch(url);
          if (!resp.ok) continue;
          const buf = Buffer.from(await resp.arrayBuffer());
          const b64 = buf.toString("base64");
          const cod = await incluirFoto(hash, bearer, codigoAnuncio, b64);
          if (cod) fotosSent++;
        } catch (e: any) {
          console.warn(`⚠️ Webmotors: foto ${url} falhou —`, e.message);
        }
      }
      console.log(`📷 Webmotors: ${fotosSent}/${fotos.length} fotos enviadas — anúncio ${codigoAnuncio}`);
    }

    // ── Atualiza banco ────────────────────────────────────────────────────
    await supabaseAdmin
      .from("veiculos")
      .update({ status_webmotors: "publicado", webmotors_id: codigoAnuncio })
      .eq("id", veiculoId);

    return NextResponse.json({ success: true, codigoAnuncio });

  } catch (e: any) {
    console.error("❌ Webmotors publicar:", e.message);
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
