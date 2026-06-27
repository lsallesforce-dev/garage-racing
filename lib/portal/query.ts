// lib/portal/query.ts
// Camada de LEITURA do portal /carros sobre o banco que já existe.
// Não muta nada, não enriquece, não cria tabela: só lê `veiculos` + `config_garage`,
// filtra o que é publicável e normaliza os campos free-text para exibição/facets.
//
// Regra de inclusão (clientes reais, sem demo/lixo):
//   config_garage.plano <> 'demo' AND plano_ativo = true
//   veiculos.status_venda = 'DISPONIVEL' AND preco_sugerido > 0 AND tem foto

import { supabaseAdmin } from "@/lib/supabase-admin";
import { toVideoUrl } from "@/lib/r2-url";
import { normalizeMarca, normalizeCategoria, normalizeCombustivel, normalizeCidade, slugify } from "./normalize";

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

// ─── Detalhe de um carro (página /carros/[id]) ───────────────────────────────
export interface PortalCarroDetalhe extends PortalCarro {
  fotos: string[];           // galeria completa (capa primeiro)
  videoUrl: string | null;   // resolvido p/ proxy /api/r2
  opcionais: string[];
  pontosFortes: string[];
  motor: string | null;
  potenciaCv: number | null;
  condicao: string | null;
  qtdProprietarios: number | null;
  valorFipe: number | null;
  anoFabricacao: number | null;
  detalhesInspecao: string | null;
}

// Colunas SEGURAS p/ exibição pública — nada de placa/chassi/renavam/custos/NF.
const SELECT_DETALHE =
  `id, marca, modelo, versao, ano, ano_modelo, ano_fabricacao, preco_sugerido,
   quilometragem_estimada, combustivel, cambio, cor, categoria, capa_marketing_url,
   fotos, video_url, municipio_origem, uf_origem, vistoriado, vistoria_cautelar,
   segundo_dono, abaixo_fipe, de_repasse, opcionais, pontos_fortes_venda, motor,
   potencia_cv, condicao, qtd_proprietarios, valor_fipe, detalhes_inspecao, user_id`;

export async function getPortalCarroDetalhe(id: string): Promise<PortalCarroDetalhe | null> {
  if (!id || !/^[0-9a-fA-F-]{36}$/.test(id)) return null; // valida UUID

  const { data } = await supabaseAdmin
    .from("veiculos")
    .select(SELECT_DETALHE)
    .eq("id", id)
    .eq("status_venda", "DISPONIVEL")
    .maybeSingle();
  if (!data) return null;
  const v = data as any;

  // Tenant tem que ser cliente real (não-demo, ativo) — senão não é publicável.
  const { data: lojas } = await supabaseAdmin
    .from("config_garage")
    .select("nome_empresa, vitrine_slug, whatsapp, whatsapp_agente, plano, plano_ativo")
    .eq("user_id", v.user_id);
  const lojaRow = (lojas ?? []).find((l: any) => l.plano !== "demo" && l.plano_ativo);
  if (!lojaRow) return null;

  const foto: string | null =
    v.capa_marketing_url ?? (Array.isArray(v.fotos) && v.fotos.length > 0 ? v.fotos[0] : null);
  if (!foto) return null;

  const fotosArr: string[] = Array.isArray(v.fotos) ? v.fotos.filter(Boolean) : [];
  const galeria =
    v.capa_marketing_url && !fotosArr.includes(v.capa_marketing_url)
      ? [v.capa_marketing_url, ...fotosArr]
      : fotosArr.length > 0
      ? fotosArr
      : [foto];

  return {
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
    loja: {
      nome: lojaRow.nome_empresa ?? null,
      slug: lojaRow.vitrine_slug ?? null,
      whatsapp: (lojaRow.whatsapp_agente || lojaRow.whatsapp) ?? null,
    },
    fotos: galeria,
    videoUrl: v.video_url ? toVideoUrl(v.video_url) : null,
    opcionais: Array.isArray(v.opcionais) ? v.opcionais.filter(Boolean) : [],
    pontosFortes: Array.isArray(v.pontos_fortes_venda) ? v.pontos_fortes_venda.filter(Boolean) : [],
    motor: v.motor ?? null,
    potenciaCv: v.potencia_cv ?? null,
    condicao: v.condicao ?? null,
    qtdProprietarios: v.qtd_proprietarios ?? null,
    valorFipe: v.valor_fipe ?? null,
    anoFabricacao: v.ano_fabricacao ?? null,
    detalhesInspecao: v.detalhes_inspecao ?? null,
  };
}

// Carros relacionados (mesma loja, exclui o atual). Usa o estoque publicável.
export async function getPortalRelacionados(carro: PortalCarroDetalhe, limite = 4): Promise<PortalCarro[]> {
  const todos = await getPortalEstoque();
  return todos.filter((c) => c.loja.nome === carro.loja.nome && c.id !== carro.id).slice(0, limite);
}

// ─── Landing pages de SEO (/carros/[marca]/[modelo]/[cidade]) ─────────────────
// Modelo curto = 1ª palavra do modelo verboso ("CAPTUR Intense 2.0..." → "Captur").
export function modeloCurtoStr(modelo?: string | null): string | null {
  if (!modelo) return null;
  const w = modelo.trim().split(/\s+/)[0];
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : null;
}

export interface PortalLanding {
  marca: string;
  modelo: string | null;
  cidade: string | null;
  carros: PortalCarro[];
  precoMin: number | null;
}

// Resolve uma landing pelos slugs. Retorna null se NÃO houver estoque real
// (anti-página-fina: o Google pune doorway pages vazias).
export async function getPortalLanding(
  marcaSlug: string,
  modeloSlug?: string,
  cidadeSlug?: string
): Promise<PortalLanding | null> {
  if (!marcaSlug) return null;
  const todos = await getPortalEstoque();

  let cars = todos.filter((c) => c.marca && slugify(c.marca) === marcaSlug);
  if (cars.length === 0) return null;
  const marca = cars[0].marca!;

  let modelo: string | null = null;
  if (modeloSlug) {
    cars = cars.filter((c) => {
      const mc = modeloCurtoStr(c.modelo);
      return mc && slugify(mc) === modeloSlug;
    });
    if (cars.length === 0) return null;
    modelo = modeloCurtoStr(cars[0].modelo);
  }

  let cidade: string | null = null;
  if (cidadeSlug) {
    cars = cars.filter((c) => c.cidade && slugify(c.cidade) === cidadeSlug);
    if (cars.length === 0) return null;
    cidade = cars[0].cidade;
  }

  const precoMin = cars.reduce<number | null>(
    (min, c) => (c.preco != null && (min == null || c.preco < min) ? c.preco : min),
    null
  );
  return { marca, modelo, cidade, carros: cars, precoMin };
}

// Enumera TODAS as combinações de landing com estoque real — pro sitemap.
// Cada item já tem ≥1 carro por construção (sem páginas fina/vazia).
export async function getPortalLandingPaths(): Promise<string[]> {
  const todos = await getPortalEstoque();
  const set = new Set<string>();
  for (const c of todos) {
    if (!c.marca) continue;
    const m = slugify(c.marca);
    if (!m) continue;
    set.add(m);
    const mc = modeloCurtoStr(c.modelo);
    if (mc) {
      const mm = `${m}/${slugify(mc)}`;
      set.add(mm);
      if (c.cidade) set.add(`${mm}/${slugify(c.cidade)}`);
    }
  }
  return [...set];
}
