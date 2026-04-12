import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import VitrineClient from "./VitrineClient";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface Props {
  params: Promise<{ tenant: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tenant } = await params;
  let garagem = (await supabaseAdmin.from("config_garage").select("nome_empresa").eq("vitrine_slug", tenant).maybeSingle()).data;
  if (!garagem) garagem = (await supabaseAdmin.from("config_garage").select("nome_empresa").eq("webhook_token", tenant).maybeSingle()).data;
  const nome = garagem?.nome_empresa ?? "Vitrine";
  return {
    title: `${nome} — Estoque`,
    description: `Confira o estoque disponível da ${nome}. Veículos verificados com análise de IA.`,
  };
}

export default async function VitrineTenantPage({ params }: Props) {
  const { tenant } = await params;

  // Resolve tenant por vitrine_slug (curto) ou webhook_token (legado)
  let { data: garagem } = await supabaseAdmin
    .from("config_garage")
    .select("user_id, nome_empresa, whatsapp, whatsapp_agente, logo_url")
    .eq("vitrine_slug", tenant)
    .single();

  if (!garagem) {
    const { data } = await supabaseAdmin
      .from("config_garage")
      .select("user_id, nome_empresa, whatsapp, whatsapp_agente, logo_url")
      .eq("webhook_token", tenant)
      .single();
    garagem = data;
  }

  if (!garagem) notFound();

  const { data: estoque } = await supabaseAdmin
    .from("veiculos")
    .select("id, marca, modelo, versao, ano_modelo, preco_sugerido, capa_marketing_url, fotos, video_url, segundo_dono, vistoriado, vistoria_cautelar, abaixo_fipe, de_repasse")
    .eq("user_id", garagem.user_id)
    .eq("status_venda", "DISPONIVEL")
    .order("created_at", { ascending: false });

  return (
    <VitrineClient
      tenant={tenant}
      nomeEmpresa={garagem.nome_empresa}
      whatsapp={garagem.whatsapp_agente ?? garagem.whatsapp ?? process.env.NEXT_PUBLIC_ZAPI_PHONE ?? ""}
      estoque={estoque ?? []}
      logoUrl={garagem.logo_url ?? null}
    />
  );
}
