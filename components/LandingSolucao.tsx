import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { LANDINGS, type Landing } from "@/lib/portal/landings";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital").replace(/\/+$/, "");

export function landingMetadata(l: Landing): Metadata {
  return {
    title: l.title,
    description: l.description,
    alternates: { canonical: `/${l.slug}` },
    openGraph: {
      type: "website",
      locale: "pt_BR",
      siteName: "AutoZap",
      url: `/${l.slug}`,
      title: l.title,
      description: l.description,
    },
  };
}

export function LandingSolucao({ landing: l }: { landing: Landing }) {
  // Conteúdo estático (lib/portal/landings.ts), sem input de usuário; ainda assim
  // escapamos "<" ao injetar via dangerouslySetInnerHTML, como na home.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "FAQPage",
        mainEntity: l.faq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "AutoZap", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: l.menu, item: `${SITE_URL}/${l.slug}` },
        ],
      },
    ],
  };
  const outras = LANDINGS.filter((x) => x.slug !== l.slug);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      {/* Hero */}
      <section className="bg-gray-900 text-white py-24 relative overflow-hidden">
        <div className="absolute bottom-0 left-1/3 w-[500px] h-[300px] bg-red-600/10 rounded-full blur-[100px]" />
        <div className="relative max-w-4xl mx-auto px-6 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-500 mb-4">{l.chamada}</p>
          <h1 className="text-4xl md:text-6xl font-black italic uppercase tracking-tighter mb-6 leading-none">
            {l.h1}
            <br />
            <span className="text-red-500">{l.h1Destaque}</span>
          </h1>
          <p className="text-gray-300 text-lg max-w-2xl mx-auto leading-relaxed">{l.intro}</p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/onboarding"
              className="inline-flex items-center gap-3 px-8 py-4 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-red-500 transition-all hover:gap-4 group"
            >
              Testar 30 dias grátis
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
              Sem cartão · sem fidelidade
            </span>
          </div>
        </div>
      </section>

      {/* Seções */}
      <section className="max-w-3xl mx-auto px-6 py-20 space-y-16">
        {l.secoes.map((s) => (
          <div key={s.titulo}>
            <h2 className="text-2xl md:text-3xl font-black italic uppercase tracking-tighter text-gray-900 mb-5">
              {s.titulo}
            </h2>
            <div className="space-y-4 text-gray-600 leading-relaxed">
              {s.paragrafos.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
            {s.itens && (
              <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {s.itens.map((i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-gray-700 font-medium">
                    <CheckCircle2 size={18} className="text-red-600 shrink-0 mt-0.5" />
                    {i}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>

      {/* FAQ */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-3xl mx-auto px-6">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-600 mb-3">Perguntas frequentes</p>
          <h2 className="text-3xl font-black italic uppercase tracking-tighter text-gray-900 mb-10">
            Dúvidas de quem está avaliando.
          </h2>
          <div className="space-y-4">
            {l.faq.map((f) => (
              <div key={f.q} className="bg-white rounded-2xl p-6 border border-gray-100">
                <h3 className="font-black text-gray-900 mb-2">{f.q}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Links cruzados */}
      <section className="max-w-3xl mx-auto px-6 py-20">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-600 mb-6">Veja também</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {outras.map((o) => (
            <Link
              key={o.slug}
              href={`/${o.slug}`}
              className="bg-gray-50 rounded-2xl p-5 border border-gray-100 hover:border-red-200 hover:shadow-lg transition-all"
            >
              <p className="font-black text-sm text-gray-900 uppercase italic mb-1">{o.menu}</p>
              <p className="text-xs text-gray-500 leading-relaxed">{o.chamada}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gray-900 text-white py-20">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-5xl font-black italic uppercase tracking-tighter mb-4 leading-none">
            Veja rodando na sua revenda.
          </h2>
          <p className="text-gray-400 mb-8 text-lg">
            30 dias grátis, com a nossa equipe fazendo a implantação junto com você.
          </p>
          <Link
            href="/onboarding"
            className="inline-flex items-center gap-3 px-8 py-4 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-red-500 transition-all hover:gap-4 group"
          >
            Começar agora
            <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </section>
    </>
  );
}
