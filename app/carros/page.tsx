import { getPortalEstoque } from "@/lib/portal/query";
import CarrosVitrine from "./CarrosVitrine";

// Estoque não muda a cada request — revalida a cada 5 min (ISR).
export const revalidate = 300;

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital").replace(/\/+$/, "");

export default async function CarrosPage() {
  const carros = await getPortalEstoque();
  const totalLojas = new Set(carros.map((c) => c.loja.nome).filter(Boolean)).size;

  // JSON-LD: lista dos primeiros carros pro Google entender que é um catálogo.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Carros à venda — AutoZap",
    numberOfItems: carros.length,
    itemListElement: carros.slice(0, 24).map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Car",
        name: [c.marca, c.modelo, c.ano].filter(Boolean).join(" "),
        ...(c.foto ? { image: c.foto } : {}),
        ...(c.km != null ? { mileageFromOdometer: { "@type": "QuantitativeValue", value: c.km, unitCode: "KMT" } } : {}),
        ...(c.preco
          ? { offers: { "@type": "Offer", price: c.preco, priceCurrency: "BRL", availability: "https://schema.org/InStock" } }
          : {}),
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <CarrosVitrine carros={carros} totalLojas={totalLojas} />
    </>
  );
}
