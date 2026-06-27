import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import {
  getPortalCarroDetalhe, getPortalRelacionados, getPortalLanding,
  getPortalEstoque, modeloCurtoStr,
} from "@/lib/portal/query";
import { slugify } from "@/lib/portal/normalize";
import CarroDetalhe from "../CarroDetalhe";
import CarroCard from "../CarroCard";

export const revalidate = 300;

const SITE = (process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital").replace(/\/+$/, "");
const UUID = /^[0-9a-fA-F-]{36}$/;
const brl = (v: number | null) =>
  v == null ? "" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);

interface Props {
  params: Promise<{ slug: string[] }>;
}

const isDetail = (slug: string[]) => slug.length === 1 && UUID.test(slug[0]);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  // ── Detalhe (UUID) ─────────────────────────────────────────────────────────
  if (isDetail(slug)) {
    const c = await getPortalCarroDetalhe(slug[0]);
    if (!c) return { title: "Veículo não encontrado" };
    const titulo = [c.marca, c.modelo, c.ano].filter(Boolean).join(" ");
    const desc = `${titulo}${c.preco ? " por " + brl(c.preco) : ""} na ${c.loja.nome ?? "revenda verificada"}. ` +
      `Fotos${c.temVideo ? ", vídeo" : ""}, ficha completa e atendimento na hora pelo WhatsApp.`;
    return {
      title: titulo,
      description: desc,
      alternates: { canonical: `/carros/${slug[0]}` },
      openGraph: {
        type: "website", url: `${SITE}/carros/${slug[0]}`,
        title: `${titulo}${c.preco ? " • " + brl(c.preco) : ""}`, description: desc,
        ...(c.foto ? { images: [{ url: c.foto, width: 1200, height: 630, alt: titulo }] } : {}),
      },
    };
  }

  // ── Landing (marca / modelo / cidade) ──────────────────────────────────────
  const land = await getPortalLanding(slug[0], slug[1], slug[2]);
  if (!land) return { title: "Página não encontrada" };
  const nome = [land.marca, land.modelo].filter(Boolean).join(" ");
  const local = land.cidade ? ` em ${land.cidade}` : "";
  const title = `${nome} à venda${local}`;
  const desc = `${land.carros.length} ${nome}${local} de revendas verificadas` +
    `${land.precoMin ? ", a partir de " + brl(land.precoMin) : ""}. ` +
    `Seminovos e usados com fotos, vídeo e atendimento na hora pelo WhatsApp.`;
  const path = "/carros/" + slug.map((s) => s.toLowerCase()).join("/");
  return {
    title,
    description: desc,
    alternates: { canonical: path },
    openGraph: {
      type: "website", url: `${SITE}${path}`, title: `${title} | AutoZap`, description: desc,
      ...(land.carros[0]?.foto ? { images: [{ url: land.carros[0].foto, width: 1200, height: 630, alt: nome }] } : {}),
    },
  };
}

export default async function Page({ params }: Props) {
  const { slug } = await params;

  // ══ DETALHE ══
  if (isDetail(slug)) {
    const c = await getPortalCarroDetalhe(slug[0]);
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
        ? { offers: { "@type": "Offer", price: c.preco, priceCurrency: "BRL", availability: "https://schema.org/InStock",
            ...(c.loja.nome ? { seller: { "@type": "AutoDealer", name: c.loja.nome } } : {}) } }
        : {}),
    };
    return (
      <>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
        <CarroDetalhe c={c} relacionados={relacionados} />
      </>
    );
  }

  // ══ LANDING ══
  if (slug.length > 3) notFound();
  const land = await getPortalLanding(slug[0], slug[1], slug[2]);
  if (!land) notFound();

  const nome = [land.marca, land.modelo].filter(Boolean).join(" ");
  const local = land.cidade ? ` em ${land.cidade}` : "";
  const marcaSlug = slug[0].toLowerCase();
  const path = "/carros/" + slug.map((s) => s.toLowerCase()).join("/");

  // Links internos (crawlabilidade): modelos da marca + outras marcas.
  const todos = await getPortalEstoque();
  const modelosDaMarca = [...new Set(
    todos.filter((c) => c.marca === land.marca).map((c) => modeloCurtoStr(c.modelo)).filter(Boolean) as string[]
  )].sort();
  const outrasMarcas = [...new Set(todos.map((c) => c.marca).filter(Boolean) as string[])]
    .filter((m) => m !== land.marca).sort();

  // Breadcrumb
  const crumbs: { name: string; url: string }[] = [
    { name: "Carros", url: "/carros" },
    { name: land.marca, url: `/carros/${marcaSlug}` },
  ];
  if (land.modelo) crumbs.push({ name: land.modelo, url: `/carros/${marcaSlug}/${slugify(land.modelo)}` });
  if (land.cidade) crumbs.push({ name: land.cidade, url: path });

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: crumbs.map((cr, i) => ({
          "@type": "ListItem", position: i + 1, name: cr.name, item: `${SITE}${cr.url}`,
        })),
      },
      {
        "@type": "ItemList",
        name: `${nome} à venda${local}`,
        numberOfItems: land.carros.length,
        itemListElement: land.carros.slice(0, 24).map((c, i) => ({
          "@type": "ListItem", position: i + 1,
          item: {
            "@type": "Car",
            name: [c.marca, c.modelo, c.ano].filter(Boolean).join(" "),
            ...(c.foto ? { image: c.foto } : {}),
            ...(c.preco ? { offers: { "@type": "Offer", price: c.preco, priceCurrency: "BRL", availability: "https://schema.org/InStock" } } : {}),
          },
        })),
      },
    ],
  };

  return (
    <div className="max-w-7xl mx-auto px-5 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-5">
        {crumbs.map((cr, i) => (
          <span key={cr.url} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-gray-300">/</span>}
            {i < crumbs.length - 1 ? (
              <Link href={cr.url} className="hover:text-red-600 transition">{cr.name}</Link>
            ) : (
              <span className="text-gray-700">{cr.name}</span>
            )}
          </span>
        ))}
      </nav>

      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-black uppercase italic tracking-tight text-gray-900">
          {nome} à venda{local}
        </h1>
        <p className="mt-2 text-gray-500">
          <span className="font-bold text-gray-900">{land.carros.length}</span> {land.carros.length === 1 ? "veículo" : "veículos"} de revendas verificadas
          {land.precoMin ? <> · a partir de <span className="font-bold text-gray-900">{brl(land.precoMin)}</span></> : null}
        </p>
      </header>

      {/* Grid */}
      <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {land.carros.map((c) => <CarroCard key={c.id} c={c} />)}
      </div>

      {/* Links internos */}
      <div className="mt-12 pt-8 border-t border-gray-200 grid md:grid-cols-2 gap-8">
        {modelosDaMarca.length > 1 && (
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-3">Modelos {land.marca}</p>
            <div className="flex flex-wrap gap-2">
              {modelosDaMarca.map((m) => (
                <Link key={m} href={`/carros/${marcaSlug}/${slugify(m)}`}
                  className="px-3.5 py-1.5 rounded-full text-[12px] font-bold bg-white text-gray-600 border border-gray-200 hover:border-gray-400 transition">
                  {land.marca} {m}
                </Link>
              ))}
            </div>
          </div>
        )}
        {outrasMarcas.length > 0 && (
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-3">Outras marcas</p>
            <div className="flex flex-wrap gap-2">
              {outrasMarcas.map((m) => (
                <Link key={m} href={`/carros/${slugify(m)}`}
                  className="px-3.5 py-1.5 rounded-full text-[12px] font-bold bg-white text-gray-600 border border-gray-200 hover:border-gray-400 transition">
                  {m}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-10">
        <Link href="/carros" className="inline-flex items-center gap-2 text-[12px] font-black uppercase tracking-widest text-red-600 hover:text-red-700">
          Ver todo o estoque →
        </Link>
      </div>
    </div>
  );
}
