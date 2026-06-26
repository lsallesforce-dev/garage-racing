import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPortalCarroDetalhe, getPortalRelacionados } from "@/lib/portal/query";
import CarroDetalhe from "./CarroDetalhe";

export const revalidate = 300;

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital").replace(/\/+$/, "");
const brl = (v: number | null) =>
  v == null ? "" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const c = await getPortalCarroDetalhe(id);
  if (!c) return { title: "Veículo não encontrado" };

  const titulo = [c.marca, c.modelo, c.ano].filter(Boolean).join(" ");
  const desc = `${titulo}${c.preco ? " por " + brl(c.preco) : ""} na ${c.loja.nome ?? "revenda verificada"}. ` +
    `Fotos${c.temVideo ? ", vídeo" : ""}, ficha completa e atendimento na hora pelo WhatsApp.`;

  return {
    title: titulo,
    description: desc,
    alternates: { canonical: `/carros/${id}` },
    openGraph: {
      type: "website",
      url: `${SITE_URL}/carros/${id}`,
      title: `${titulo}${c.preco ? " • " + brl(c.preco) : ""}`,
      description: desc,
      ...(c.foto ? { images: [{ url: c.foto, width: 1200, height: 630, alt: titulo }] } : {}),
    },
  };
}

export default async function CarroPage({ params }: Props) {
  const { id } = await params;
  const c = await getPortalCarroDetalhe(id);
  if (!c) notFound();

  const relacionados = await getPortalRelacionados(c);
  const titulo = [c.marca, c.modelo, c.ano].filter(Boolean).join(" ");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Car",
    name: titulo,
    ...(c.fotos.length ? { image: c.fotos } : {}),
    ...(c.marca ? { brand: { "@type": "Brand", name: c.marca } } : {}),
    ...(c.cor ? { color: c.cor } : {}),
    ...(c.combustivel ? { fuelType: c.combustivel } : {}),
    ...(c.cambio ? { vehicleTransmission: c.cambio } : {}),
    ...(c.ano ? { modelDate: String(c.ano) } : {}),
    ...(c.km != null ? { mileageFromOdometer: { "@type": "QuantitativeValue", value: c.km, unitCode: "KMT" } } : {}),
    ...(c.preco
      ? {
          offers: {
            "@type": "Offer",
            price: c.preco,
            priceCurrency: "BRL",
            availability: "https://schema.org/InStock",
            ...(c.loja.nome ? { seller: { "@type": "AutoDealer", name: c.loja.nome } } : {}),
          },
        }
      : {}),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <CarroDetalhe c={c} relacionados={relacionados} />
    </>
  );
}
