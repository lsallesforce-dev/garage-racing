// lib/portal/query.ts
// Camada de LEITURA do portal /carros sobre o banco que já existe.
// Não muta nada, não enriquece, não cria tabela: só lê `veiculos` + `config_garage`,
// filtra o que é publicável e normaliza os campos free-text para exibição/facets.
//
// Regra de inclusão (clientes reais, sem demo/lixo):
//   config_garage.plano <> 'demo' AND plano_ativo = true
//   veiculos.status_venda = 'DISPONIVEL' AND preco_sugerido > 0 AND tem foto

import { supabaseAdmin } from "@/lib/supabase-admin";
import { normalizeMarca, normalizeCategoria, normalizeCombustivel, normalizeCidade } from "./normalize";

export interface PortalCarro {
  id: string;
  marca: string | null;       // normalizada
  modelo: string | null;
  versao: string | null;
  ano: number | null;
  preco: number | null;
  km: number | null;
  combustivel: string | null; // normalizado
  cambio: string | null;
  cor: string | null;
  categoria: string | null;   // normalizada
  foto: string | null;        // capa_marketing_url ?? fotos[0]
  temVideo: boolean;
  cidade: string | null;      // title-case
  uf: string | null;
  selos: {
    vistoriado: boolean;
    cautelar: boolean;
    unicoDono: boolean;
    abaixoFipe: boolean;
    repasse: boolean;
  };
  loja: { nome: string | null; slug: string | null; whatsapp: string | null };
}

interface LojaInfo { nome: string | null; slug: string | null; whatsapp: string | null }

// Busca o estoque publicável do portal, já normalizado e com a info da loja.
export async function getPortalEstoque(): Promise<PortalCarro[]> {
  // 1) Tenants elegíveis (clientes reais, fora do demo). Dedup por user_id —
  //    config_garage pode ter mais de uma linha por user (ver CLAUDE.md).
  const { data: lojas } = await supabaseAdmin
    .from("config_garage")
    .select("user_id, nome_empresa, vitrine_slug, whatsapp, whatsapp_agente")
    .neq("plano", "demo")
    .eq("plano_ativo", true);

  const lojaMap = new Map<string, LojaInfo>();
  for (const l of (lojas ?? []) as any[]) {
    if (!l.user_id || lojaMap.has(l.user_id)) continue;
    lojaMap.set(l.user_id, {
      nome: l.nome_empresa ?? null,
      slug: l.vitrine_slug ?? null,
      whatsapp: (l.whatsapp_agente || l.whatsapp) ?? null,
    });
  }

  const userIds = [...lojaMap.keys()];
  if (userIds.length === 0) return [];

  // 2) Carros publicáveis desses tenants.
  const { data: veics } = await supabaseAdmin
    .from("veiculos")
    .select(
      `id, marca, modelo, versao, ano, ano_modelo, ano_fabricacao, preco_sugerido,
       quilometragem_estimada, combustivel, cambio, cor, categoria, capa_marketing_url,
       fotos, video_url, municipio_origem, uf_origem,
       vistoriado, vistoria_cautelar, segundo_dono, abaixo_fipe, de_repasse, user_id`
    )
    .in("user_id", userIds)
    .eq("status_venda", "DISPONIVEL")
    .gt("preco_sugerido", 0)
    .order("created_at", { ascending: false });

  const out: PortalCarro[] = [];
  for (const v of (veics ?? []) as any[]) {
    const foto: string | null =
      v.capa_marketing_url ?? (Array.isArray(v.fotos) && v.fotos.length > 0 ? v.fotos[0] : null);
    if (!foto) continue; // exige foto — nada de card sem imagem

    out.push({
      id: v.id,
      marca: normalizeMarca(v.marca),
      modelo: v.modelo ?? null,
      versao: v.versao ?? null,
      ano: v.ano_modelo ?? v.ano_fabricacao ?? v.ano ?? null,
      preco: v.preco_sugerido ?? null,
      km: v.quilometragem_estimada ?? null,
      combustivel: normalizeCombustivel(v.combustivel),
      cambio: v.cambio ?? null,
      cor: v.cor ?? null,
      categoria: normalizeCategoria(v.categoria),
      foto,
      temVideo: !!v.video_url,
      cidade: normalizeCidade(v.municipio_origem),
      uf: v.uf_origem ?? null,
      selos: {
        vistoriado: !!v.vistoriado,
        cautelar: !!v.vistoria_cautelar,
        unicoDono: v.segundo_dono === false,
        abaixoFipe: !!v.abaixo_fipe,
        repasse: !!v.de_repasse,
      },
      loja: lojaMap.get(v.user_id)!,
    });
  }

  return out;
}
