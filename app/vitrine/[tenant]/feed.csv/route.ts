// GET /vitrine/[tenant]/feed.csv — catálogo de veículos do tenant no formato de
// feed da Meta (Automotive Inventory Ads / Marketplace).
//
// A Meta busca esta URL sozinha, de hora em hora, e mantém o catálogo em dia —
// é o que permite anunciar o estoque INTEIRO sem uma campanha por carro, e sem
// depender da permissão `catalog_management` (que o app ainda não tem: o
// business da APROVE responde "(#100) not been approved to use this api").
//
// Fica sob /vitrine de propósito: o prefixo já é público no proxy.ts, então a
// rota não precisa mexer na allowlist de autenticação.
//
// ⚠️ FEED PÚBLICO: as colunas são escolhidas a dedo. NUNCA incluir placa,
// chassi, renavam, preco_compra, fornecedor ou documentos.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assinaturaAtiva } from "@/lib/assinatura";
import { resolveGaragem, baseVitrine } from "@/lib/vitrine-tenant";
import { normalizeMarca } from "@/lib/portal/normalize";
import { cleanModelo } from "@/lib/marketing-kit";
import { midiaDoVeiculo, COLUNAS_MIDIA } from "@/lib/veiculo-midia";
import { cell, csvLinha } from "@/lib/portal/csv";

export const revalidate = 600; // 10 min — mesma janela do /carros/feed.xml

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Colunas seguras para exposição pública (espelha SELECT_DETALHE de lib/portal/query.ts).
const COLUNAS =
  "id, marca, modelo, versao, ano, ano_modelo, cor, cambio, combustivel, " +
  "quilometragem_estimada, preco_sugerido, categoria, " +
  COLUNAS_MIDIA;

const CABECALHO = [
  "vehicle_id", "title", "description", "url", "make", "model", "year",
  "mileage.value", "mileage.unit", "price", "state_of_vehicle", "exterior_color",
  "transmission", "fuel_type", "body_style", "condition", "availability",
  "image[0].url", "address",
];

// Alguns cadastros trazem a marca dentro do modelo e deixam `marca` vazia
// (Strada, Argo, Toro, S10...). `make` é obrigatório no feed, então derivamos
// pela primeira palavra do modelo antes de descartar o carro.
const MARCA_POR_MODELO: Record<string, string> = {
  strada: "Fiat", argo: "Fiat", toro: "Fiat", uno: "Fiat", fiorino: "Fiat", cronos: "Fiat",
  onix: "Chevrolet", s10: "Chevrolet", tracker: "Chevrolet", cruze: "Chevrolet", spin: "Chevrolet",
  gol: "Volkswagen", polo: "Volkswagen", virtus: "Volkswagen", nivus: "Volkswagen", fox: "Volkswagen",
  hb20: "Hyundai", hb20s: "Hyundai", creta: "Hyundai", tucson: "Hyundai",
  kwid: "Renault", sandero: "Renault", duster: "Renault",
  compass: "Jeep", renegade: "Jeep",
  corolla: "Toyota", yaris: "Toyota", hilux: "Toyota",
  kicks: "Nissan", versa: "Nissan",
};

function marcaDoVeiculo(v: any): string | null {
  const direta = normalizeMarca(v?.marca);
  if (direta) return direta;
  const primeira = String(v?.modelo ?? "").trim().split(/\s+/)[0]?.toLowerCase();
  return primeira ? MARCA_POR_MODELO[primeira] ?? null : null;
}

// O `modelo` do cadastro costuma vir com a versão inteira grudada ("ONIX HATCH
// LT 1.0 12V TB Flex 5p Aut.") e a coluna `versao` repete boa parte disso. Sem
// limpar, o título sai "Chevrolet ONIX HATCH LT 1.0 12V TB Flex 5p Aut. LT 1.0
// Turbo Automático". cleanModelo (lib/marketing-kit) corta no primeiro token de
// motor/versão e devolve no máximo 2 palavras — é o mesmo tratamento que o kit
// de postagem já usa no título da capa.
function modeloLimpo(v: any, marca: string | null): string {
  const bruto = String(v?.modelo ?? "").trim();
  const semMarca = marca ? bruto.replace(new RegExp(`^${marca}\\s+`, "i"), "").trim() : bruto;
  return cleanModelo(semMarca) || semMarca || bruto;
}

// A escolha da imagem fica ISOLADA aqui. Vai a foto CRUA, e NÃO a capa do kit:
// o anúncio de catálogo desenha nome e preço por cima da imagem sozinho, então
// a arte do kit (que já traz preço, claim e logo) sairia com preço duplicado e
// texto em cima de texto — além do risco de o Commerce Manager reprovar item
// por imagem carregada de texto. A capa do kit segue sendo a imagem dos
// anúncios de UM carro e do post orgânico, onde nada é desenhado por cima.
function imagemDoFeed(v: any): string | null {
  return midiaDoVeiculo(v).fotoCrua;
}

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// A Meta valida transmission/fuel_type/body_style contra listas fechadas —
// texto livre ("flex", "Hatch") reprova o item. Os valores abaixo são os enums
// esperados; o que não casar vai como OTHER, que é aceito.
// As chaves saem dos valores REAIS do cadastro (conferidos no estoque da
// APROVE: "Pick-up", "PICK-UP", "CAMIONETE", "FURGÃO", "UTILITARIO", "CVT"...),
// não de uma lista teórica — por isso vários sinônimos por enum.
const CAMBIO_META: Record<string, string> = {
  automatico: "AUTOMATIC", automatica: "AUTOMATIC", cvt: "AUTOMATIC",
  automatizado: "AUTOMATIC", tiptronic: "AUTOMATIC",
  manual: "MANUAL", mecanico: "MANUAL",
};

const COMBUSTIVEL_META: Record<string, string> = {
  flex: "FLEX", gasolina: "GASOLINE", alcool: "FLEX", etanol: "FLEX",
  diesel: "DIESEL", eletrico: "ELECTRIC", hibrido: "HYBRID", gnv: "OTHER",
};

const CARROCERIA_META: Record<string, string> = {
  hatch: "HATCHBACK", hatchback: "HATCHBACK", sedan: "SEDAN", suv: "SUV",
  picape: "TRUCK", pickup: "TRUCK", "pick-up": "TRUCK", caminhonete: "TRUCK",
  camionete: "TRUCK", utilitario: "TRUCK",
  van: "VAN", furgao: "VAN", minivan: "MINIVAN", perua: "WAGON",
  conversivel: "CONVERTIBLE", cupe: "COUPE", coupe: "COUPE",
};

const enumMeta = (mapa: Record<string, string>, valor: unknown): string =>
  mapa[semAcento(String(valor ?? ""))] ?? "OTHER";

// "BRANCO"/"prata" no cadastro — normaliza pra não sair misturado no anúncio.
const tituloCaso = (s: unknown): string => {
  const t = String(s ?? "").trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
};


export async function GET(
  _req: Request,
  ctx: { params: Promise<{ tenant: string }> }
) {
  const { tenant } = await ctx.params;
  const garagem = await resolveGaragem(tenant);

  const vazio = () =>
    new NextResponse(CABECALHO.join(",") + "\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "public, max-age=600, s-maxage=600",
      },
    });

  // Tenant inexistente ou com assinatura vencida devolve feed VAZIO (cabeçalho
  // só), nunca 404/500: a Meta desativa um feed que responde erro, e nesse caso
  // o catálogo do lojista morreria por um lapso de cobrança.
  if (!garagem || !assinaturaAtiva(garagem)) return vazio();

  const { data: estoque } = await supabaseAdmin
    .from("veiculos")
    .select(COLUNAS)
    .eq("user_id", garagem.user_id)
    .eq("status_venda", "DISPONIVEL")
    .order("created_at", { ascending: false });

  const base = baseVitrine(garagem, tenant);
  // nome_empresa costuma vir com espaço sobrando ("APROVE MULTIMARCAS ") e ia
  // parar na descrição como "na APROVE MULTIMARCAS ."
  const loja = String(garagem.nome_empresa ?? "loja").trim() || "loja";
  const endereco = JSON.stringify({
    addr1: garagem.endereco ?? "",
    city: garagem.cidade ?? "",
    region: garagem.estado ?? "",
    country: "BR",
  });

  const linhas: string[] = [CABECALHO.join(",")];
  const pulados: string[] = [];

  // `as any[]`: o select é montado por concatenação, então o cliente tipado do
  // Supabase não consegue inferir as colunas e cai em GenericStringError.
  for (const v of (estoque ?? []) as any[]) {
    const marca = marcaDoVeiculo(v);
    const imagem = imagemDoFeed(v);
    const preco = Number(v?.preco_sugerido ?? 0);
    const ano = Number(v?.ano_modelo ?? v?.ano ?? 0);

    // Linha incompleta faz a Meta rejeitar o ITEM e sujar o relatório do
    // catálogo — melhor não emitir e avisar no log.
    if (!marca || !imagem || preco <= 0 || !ano) {
      pulados.push(`${v?.id} (${v?.marca ?? ""} ${v?.modelo ?? ""}: ${[
        !marca && "sem marca", !imagem && "sem foto", preco <= 0 && "sem preço", !ano && "sem ano",
      ].filter(Boolean).join(", ")})`);
      continue;
    }

    const modelo = modeloLimpo(v, marca);
    const titulo = [marca, modelo, v?.versao].filter(Boolean).join(" ").trim();
    const specs = [
      tituloCaso(v?.cambio), tituloCaso(v?.combustivel), tituloCaso(v?.cor),
      v?.quilometragem_estimada ? `${Number(v.quilometragem_estimada).toLocaleString("pt-BR")} km` : null,
    ].filter(Boolean).join(" | ");

    linhas.push(csvLinha([
      v.id,
      titulo.slice(0, 150),
      `${titulo}${specs ? ` — ${specs}` : ""}. Disponível na ${loja}.`.slice(0, 5000),
      `${base}/${v.id}`,
      marca,
      modelo,
      ano,
      Math.max(0, Math.round(Number(v?.quilometragem_estimada ?? 0))),
      "KM",
      `${preco.toFixed(2)} BRL`,
      "USED",
      tituloCaso(v?.cor),
      enumMeta(CAMBIO_META, v?.cambio),
      enumMeta(COMBUSTIVEL_META, v?.combustivel),
      enumMeta(CARROCERIA_META, v?.categoria),
      "excellent",
      "available",
      imagem,
      endereco,
    ]));
  }

  if (pulados.length) {
    console.warn(`⚠️ [feed.csv/${tenant}] ${pulados.length} veículo(s) fora do feed: ${pulados.join("; ")}`);
  }

  return new NextResponse(linhas.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "public, max-age=600, s-maxage=600",
      "Content-Disposition": `inline; filename="estoque-${tenant}.csv"`,
    },
  });
}
