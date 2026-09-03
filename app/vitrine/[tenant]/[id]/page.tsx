import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { toVideoUrl } from "@/lib/r2-url";
import VitrineDetalheClient from "./VitrineDetalheClient";
import VitrineIndisponivel from "../../VitrineIndisponivel";
import { assinaturaAtiva } from "@/lib/assinatura";
import { resolveGaragem } from "@/lib/vitrine-tenant";
import MetaPixel from "@/components/MetaPixel";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Estoque em tempo real — sem ISR.
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ tenant: string; id: string }>;
}

// resolveGaragem/GARAGE_COLS moram em lib/vitrine-tenant.ts — esta era a
// TERCEIRA cópia (lista, feed de catálogo e aqui). Coluna nova no SELECT
// precisava ser lembrada em três lugares; a que faltasse virava undefined em
// silêncio, não erro.

const fmtBRL = (v: number | null | undefined) =>
  v == null ? "" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tenant, id } = await params;
  const { data } = await supabaseAdmin
    .from("veiculos")
    .select("marca, modelo, versao, ano_modelo, preco_sugerido, capa_marketing_url, fotos")
    .eq("id", id)
    .maybeSingle();

  if (!data) return { title: "Veículo não encontrado" };

  const titulo = `${data.marca ?? ""} ${data.modelo ?? ""} ${data.versao ?? ""} ${data.ano_modelo ?? ""}`.replace(/\s+/g, " ").trim();
  const preco = fmtBRL(data.preco_sugerido);
  const imagem = data.capa_marketing_url ?? data.fotos?.[0] ?? null;

  const garagem = await resolveGaragem(tenant);
  const dominio = (garagem?.dominio_custom as string | undefined)?.trim();
  const canonical = dominio ? `https://${dominio}/${id}` : undefined;

  return {
    title: titulo,
    description: `${titulo}${preco ? ` por ${preco}` : ""}. Confira fotos, vídeo e ficha completa. Atendimento na hora pelo WhatsApp.`,
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: {
      title: `${titulo}${preco ? ` • ${preco}` : ""}`,
      description: "Fale com a loja agora pelo WhatsApp — sem formulário.",
      ...(canonical ? { url: canonical } : {}),
      // Sem width/height fixos: a foto do carro raramente é 1200x630; declarar
      // dimensão errada faz o WhatsApp/Facebook rejeitar a imagem do card.
      images: imagem ? [{ url: imagem, alt: titulo }] : [],
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
    .maybeSingle();

  if (error) console.error("❌ vitrine/[tenant]/[id] error:", error);
  if (!veiculo) notFound();

  const garagem = await resolveGaragem(tenant);
  // Carro tem que pertencer ao tenant da URL — senão dá pra renderizar carro de
  // outra loja com a marca/WhatsApp desta (furo herdado da versão antiga).
  if (!garagem || veiculo.user_id !== garagem.user_id) notFound();

  // Assinatura inativa → vitrine fora do ar (mesmo comportamento da listagem).
  if (!assinaturaAtiva(garagem)) {
    return <VitrineIndisponivel nomeEmpresa={garagem.nome_empresa} />;
  }

  const { data: relacionados } = await supabaseAdmin
    .from("veiculos")
    .select("id, marca, modelo, versao, ano_modelo, preco_sugerido, capa_marketing_url, fotos, video_url, quilometragem_estimada, combustivel, cambio, segundo_dono, vistoriado, vistoria_cautelar, abaixo_fipe, de_repasse")
    .eq("user_id", veiculo.user_id)
    .eq("status_venda", "DISPONIVEL")
    .neq("id", id)
    .order("created_at", { ascending: false })
    .limit(4);

  const whatsapp = garagem?.whatsapp_agente ?? garagem?.whatsapp ?? process.env.NEXT_PUBLIC_ZAPI_PHONE ?? "";
  const videoUrl = veiculo.video_url ? toVideoUrl(veiculo.video_url) : null;

  // JSON-LD Vehicle + Offer
  const nome = [veiculo.marca, veiculo.modelo, veiculo.versao].filter(Boolean).join(" ");
  const imagem = veiculo.capa_marketing_url ?? veiculo.fotos?.[0] ?? null;
  const disponivel = veiculo.status_venda === "DISPONIVEL";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Vehicle",
    name: nome,
    ...(veiculo.marca ? { brand: { "@type": "Brand", name: veiculo.marca } } : {}),
    ...(veiculo.modelo ? { model: veiculo.modelo } : {}),
    ...(veiculo.ano_modelo ? { modelDate: String(veiculo.ano_modelo), vehicleModelDate: String(veiculo.ano_modelo) } : {}),
    ...(veiculo.cor ? { color: veiculo.cor } : {}),
    ...(veiculo.combustivel ? { fuelType: veiculo.combustivel } : {}),
    ...(veiculo.quilometragem_estimada
      ? { mileageFromOdometer: { "@type": "QuantitativeValue", value: veiculo.quilometragem_estimada, unitCode: "KMT" } }
      : {}),
    ...(imagem ? { image: imagem } : {}),
    ...(veiculo.preco_sugerido
      ? {
          offers: {
            "@type": "Offer",
            priceCurrency: "BRL",
            price: veiculo.preco_sugerido,
            availability: disponivel ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
            ...(garagem?.nome_empresa ? { seller: { "@type": "AutoDealer", name: garagem.nome_empresa } } : {}),
          },
        }
      : {}),
  };

  return (
    <>
      <MetaPixel
        pixelId={garagem?.meta_pixel_id}
        viewContent={{
          id: veiculo.id,
          nome: [veiculo.marca, veiculo.modelo].filter(Boolean).join(" "),
          valor: veiculo.preco_sugerido ?? null,
        }}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <VitrineDetalheClient
        veiculo={veiculo}
        videoUrl={videoUrl}
        relacionados={relacionados ?? []}
        nomeEmpresa={garagem?.nome_empresa ?? ""}
        whatsapp={whatsapp}
        logoUrl={(garagem?.vitrine_tema?.logo_url as string | undefined)?.trim() || garagem?.logo_url || null}
        tenant={tenant}
        vitrineTema={garagem?.vitrine_tema ?? null}
        loja={{
          cidade: garagem?.cidade ?? null,
          estado: garagem?.estado ?? null,
          endereco: garagem?.endereco ?? null,
          enderecoComplemento: garagem?.endereco_complemento ?? null,
          horario: garagem?.horario_funcionamento ?? null,
          telefone: garagem?.telefone_loja ?? null,
        }}
      />
    </>
  );
}
