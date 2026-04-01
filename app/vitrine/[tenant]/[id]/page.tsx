import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import VitrineDetalheClient from "./VitrineDetalheClient";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface Props {
  params: Promise<{ tenant: string; id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { data } = await supabaseAdmin
    .from("veiculos")
    .select("marca, modelo, versao, ano_modelo, preco_sugerido, capa_marketing_url, fotos")
    .eq("id", id)
    .single();

  if (!data) return { title: "Veículo não encontrado" };

  const titulo = `${data.marca} ${data.modelo} ${data.versao ?? ""} ${data.ano_modelo ?? ""}`.trim();
  const preco = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(data.preco_sugerido ?? 0);
  const imagem = data.capa_marketing_url ?? data.fotos?.[0] ?? null;

  return {
    title: `${titulo} — AutoZap`,
    description: `${titulo} por ${preco}. Confira fotos, vídeo e detalhes completos.`,
    openGraph: {
      title: `${titulo} • ${preco}`,
      description: "Estoque verificado com análise de IA. Clique e fale com o consultor agora.",
      images: imagem ? [{ url: imagem, width: 1200, height: 630 }] : [],
      type: "website",
    },
  };
}

export default async function VitrineDetalhePage({ params }: Props) {
  const { tenant, id } = await params;

  const { data: veiculo, error } = await supabaseAdmin
    .from("veiculos")
    .select("*")
    .eq("id", id)
    .single();

  if (error) console.error("❌ vitrine/[tenant]/[id] error:", error);
  if (!veiculo) notFound();

  let { data: garagem } = await supabaseAdmin
    .from("config_garage")
    .select("nome_empresa, whatsapp, whatsapp_agente, logo_url")
    .eq("vitrine_slug", tenant)
    .single();

  if (!garagem) {
    const { data } = await supabaseAdmin
      .from("config_garage")
      .select("nome_empresa, whatsapp, whatsapp_agente, logo_url")
      .eq("webhook_token", tenant)
      .single();
    garagem = data;
  }

  const relacionadosQuery = supabaseAdmin
    .from("veiculos")
    .select("id, marca, modelo, versao, ano_modelo, preco_sugerido, capa_marketing_url, fotos")
    .eq("status_venda", "DISPONIVEL")
    .neq("id", id)
    .limit(3);

  if (veiculo.user_id) relacionadosQuery.eq("user_id", veiculo.user_id);
  const { data: relacionados } = await relacionadosQuery;

  return (
    <VitrineDetalheClient
      veiculo={veiculo}
      relacionados={relacionados ?? []}
      nomeEmpresa={garagem?.nome_empresa ?? "AutoZap"}
      whatsapp={garagem?.whatsapp_agente ?? garagem?.whatsapp ?? process.env.NEXT_PUBLIC_ZAPI_PHONE ?? ""}
      logoUrl={garagem?.logo_url ?? null}
      tenant={tenant}
    />
  );
}
