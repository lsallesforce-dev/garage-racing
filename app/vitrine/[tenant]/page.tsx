import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import VitrineClient from "./VitrineClient";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Rendering 100% dinâmico — "estoque em tempo real" é o argumento de venda.
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ tenant: string }>;
}

const GARAGE_COLS =
  "user_id, nome_empresa, whatsapp, whatsapp_agente, logo_url, vitrine_tema, dominio_custom, cidade, estado, endereco, endereco_complemento, horario_funcionamento, telefone_loja";

// Resolve o tenant por vitrine_slug (curto) ou webhook_token (links antigos compartilhados).
async function resolveGaragem(tenant: string) {
  const bySlug = await supabaseAdmin
    .from("config_garage")
    .select(GARAGE_COLS)
    .eq("vitrine_slug", tenant)
    .order("created_at", { ascending: false })
    .limit(1);
  if (bySlug.data?.[0]) return bySlug.data[0] as any;

  const byToken = await supabaseAdmin
    .from("config_garage")
    .select(GARAGE_COLS)
    .eq("webhook_token", tenant)
    .order("created_at", { ascending: false })
    .limit(1);
  return (byToken.data?.[0] as any) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tenant } = await params;
  const garagem = await resolveGaragem(tenant);

  const nome = garagem?.nome_empresa ?? "Vitrine";
  const local = [garagem?.cidade, garagem?.estado].filter(Boolean).join(" - ");
  const desc =
    `Estoque disponível da ${nome}${local ? ` em ${local}` : ""}. Veículos com fotos, vídeo e atendimento na hora pelo WhatsApp.`;

  let ogImage: string | null =
    (garagem?.vitrine_tema?.capa_url as string | undefined)?.trim() || garagem?.logo_url || null;
  if (!ogImage && garagem?.user_id) {
    const { data: carro } = await supabaseAdmin
      .from("veiculos")
      .select("capa_marketing_url, fotos")
      .eq("user_id", garagem.user_id)
      .eq("status_venda", "DISPONIVEL")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    ogImage = carro?.capa_marketing_url ?? carro?.fotos?.[0] ?? null;
  }

  const dominio = (garagem?.dominio_custom as string | undefined)?.trim();
  const canonical = dominio ? `https://${dominio}` : undefined;

  return {
    title: `${nome} — Estoque`,
    description: desc,
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: {
      title: `${nome} — Estoque`,
      description: desc,
      ...(canonical ? { url: canonical } : {}),
      // Sem width/height fixos: a imagem é dinâmica (capa/logo/foto, cada uma de
      // um tamanho). Declarar 1200x630 quando a real é outra (ex: capa 1600x496)
      // faz o crawler do WhatsApp/Facebook rejeitar o card. Deixa ler a real.
      ...(ogImage ? { images: [{ url: ogImage, alt: nome }] } : {}),
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${nome} — Estoque`,
      description: desc,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

export default async function VitrineTenantPage({ params }: Props) {
  const { tenant } = await params;
  const garagem = await resolveGaragem(tenant);
  if (!garagem) notFound();

  const { data: estoque } = await supabaseAdmin
    .from("veiculos")
    .select(
      "id, marca, modelo, versao, ano_modelo, preco_sugerido, capa_marketing_url, fotos, video_url, " +
        "segundo_dono, vistoriado, vistoria_cautelar, abaixo_fipe, de_repasse, " +
        "created_at, quilometragem_estimada, cambio, combustivel, cor, categoria, valor_fipe"
    )
    .eq("user_id", garagem.user_id)
    .eq("status_venda", "DISPONIVEL")
    .order("created_at", { ascending: false });

  const lista = estoque ?? [];
  const whatsapp = garagem.whatsapp_agente ?? garagem.whatsapp ?? process.env.NEXT_PUBLIC_ZAPI_PHONE ?? "";
  const dominio = (garagem.dominio_custom as string | undefined)?.trim() || null;
  // Logo da vitrine tem precedência sobre a logo geral da loja.
  const logoVitrine = (garagem.vitrine_tema?.logo_url as string | undefined)?.trim() || garagem.logo_url || null;

  // JSON-LD: AutoDealer com o estoque como ofertas.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AutoDealer",
    name: garagem.nome_empresa,
    ...(logoVitrine ? { logo: logoVitrine, image: logoVitrine } : {}),
    ...(dominio ? { url: `https://${dominio}` } : {}),
    ...(whatsapp ? { telephone: `+${whatsapp.replace(/\D/g, "")}` } : {}),
    ...(garagem.endereco || garagem.cidade
      ? {
          address: {
            "@type": "PostalAddress",
            ...(garagem.endereco ? { streetAddress: garagem.endereco } : {}),
            ...(garagem.cidade ? { addressLocality: garagem.cidade } : {}),
            ...(garagem.estado ? { addressRegion: garagem.estado } : {}),
            addressCountry: "BR",
          },
        }
      : {}),
    makesOffer: lista.slice(0, 50).map((c: any) => ({
      "@type": "Offer",
      priceCurrency: "BRL",
      ...(c.preco_sugerido ? { price: c.preco_sugerido } : {}),
      itemOffered: {
        "@type": "Car",
        name: [c.marca, c.modelo, c.versao].filter(Boolean).join(" "),
        ...(c.marca ? { brand: c.marca } : {}),
        ...(c.ano_modelo ? { modelDate: String(c.ano_modelo) } : {}),
      },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <VitrineClient
        tenant={tenant}
        nomeEmpresa={garagem.nome_empresa ?? ""}
        whatsapp={whatsapp}
        estoque={lista}
        logoUrl={logoVitrine}
        vitrineTema={garagem.vitrine_tema ?? null}
        loja={{
          cidade: garagem.cidade ?? null,
          estado: garagem.estado ?? null,
          endereco: garagem.endereco ?? null,
          enderecoComplemento: garagem.endereco_complemento ?? null,
          horario: garagem.horario_funcionamento ?? null,
          telefone: garagem.telefone_loja ?? null,
        }}
      />
    </>
  );
}
