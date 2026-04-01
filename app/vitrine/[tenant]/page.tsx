import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import VitrineClient from "./VitrineClient";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface Props {
  params: Promise<{ tenant: string }>;
}

export default async function VitrineTenantPage({ params }: Props) {
  const { tenant } = await params;

  // Resolve tenant pelo webhook_token
  const { data: garagem } = await supabaseAdmin
    .from("config_garage")
    .select("user_id, nome_empresa, whatsapp")
    .eq("webhook_token", tenant)
    .single();

  if (!garagem) notFound();

  const { data: estoque } = await supabaseAdmin
    .from("veiculos")
    .select("id, marca, modelo, versao, ano_modelo, preco_sugerido, capa_marketing_url, fotos, video_url, segundo_dono")
    .eq("user_id", garagem.user_id)
    .eq("status_venda", "DISPONIVEL")
    .order("created_at", { ascending: false });

  return (
    <VitrineClient
      tenant={tenant}
      nomeEmpresa={garagem.nome_empresa}
      whatsapp={garagem.whatsapp ?? process.env.NEXT_PUBLIC_ZAPI_PHONE ?? ""}
      estoque={estoque ?? []}
    />
  );
}
