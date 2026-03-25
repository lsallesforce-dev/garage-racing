import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import VitrineDetalheClient from "./VitrineDetalheClient";

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Props {
  params: Promise<{ id: string }>;
}

// ─── OG Tags para anúncios e compartilhamento ─────────────────────────────────

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { data } = await supabaseServer
    .from("veiculos")
    .select("marca, modelo, versao, ano_modelo, preco_sugerido, capa_marketing_url, fotos")
    .eq("id", id)
    .single();

  if (!data) return { title: "Veículo não encontrado" };

  const titulo = `${data.marca} ${data.modelo} ${data.versao ?? ""} ${data.ano_modelo ?? ""}`.trim();
  const preco = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    data.preco_sugerido ?? 0
  );
  const imagem = data.capa_marketing_url ?? data.fotos?.[0] ?? null;

  return {
    title: `${titulo} — AutoZap`,
    description: `${titulo} por ${preco}. Confira fotos, vídeo e detalhes completos no Pátio Digital da AutoZap.`,
    openGraph: {
      title: `${titulo} • ${preco}`,
      description: "Estoque verificado com análise de IA. Clique e fale com o consultor agora.",
      images: imagem ? [{ url: imagem, width: 1200, height: 630 }] : [],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${titulo} • ${preco}`,
      images: imagem ? [imagem] : [],
    },
  };
}

// ─── Server Component — busca os dados ───────────────────────────────────────

export default async function VitrineDetalhePage({ params }: Props) {
  const { id } = await params;
  const { data: veiculo, error: veiculoError } = await supabaseServer
    .from("veiculos")
    .select("*")
    .eq("id", id)
    .single();

  if (veiculoError) console.error("❌ Supabase vitrine/[id] error:", veiculoError);
  if (!veiculo) notFound();

  // Busca outros carros disponíveis (exceto este)
  const { data: relacionados } = await supabaseServer
    .from("veiculos")
    .select("id, marca, modelo, versao, ano_modelo, preco_sugerido, capa_marketing_url, fotos")
    .eq("status_venda", "DISPONIVEL")
    .neq("id", id)
    .limit(3);

  return <VitrineDetalheClient veiculo={veiculo} relacionados={relacionados ?? []} />;
}
