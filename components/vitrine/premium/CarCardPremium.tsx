"use client";

// Cards do layout premium: o card de grid e o card de DESTAQUE (o carro grande
// da faixa "Recém-chegados"). Compartilham os mesmos dados e os mesmos selos —
// só muda a proporção.
//
// Regra que vale pros dois: NENHUMA estimativa de parcela. O simulador de
// parcela saiu em 07/09 (commit c379051) porque, sem juros/IOF/tarifas, o número
// ancorava o cliente numa parcela que banco nenhum aprova. O caminho de
// financiamento é a FichaFinanciamento, que coleta o que o banco pede.

import Link from "next/link";
import { Car, Gauge, Fuel, Cog, Calendar, MessageCircle, Play, Sparkles, ShieldCheck } from "lucide-react";
import { fmtBRL, fmtKm, whatsappLink, selosDe } from "@/app/vitrine/theme";

export function msgInteresse(c: any, nomeEmpresa: string) {
  const titulo = [c.marca, c.modelo].filter(Boolean).join(" ") || "veículo";
  return `Olá! Vi o *${titulo}${c.ano_modelo ? " " + c.ano_modelo : ""}* na vitrine da ${nomeEmpresa} e tenho interesse. Ainda está disponível?`;
}

/** Specs com ícone — só as que o carro realmente tem preenchido. */
function specsDe(c: any) {
  return [
    c.ano_modelo ? { icon: <Calendar size={12} />, txt: String(c.ano_modelo) } : null,
    fmtKm(c.quilometragem_estimada) ? { icon: <Gauge size={12} />, txt: fmtKm(c.quilometragem_estimada)! } : null,
    c.combustivel ? { icon: <Fuel size={12} />, txt: c.combustivel } : null,
    c.cambio ? { icon: <Cog size={12} />, txt: c.cambio } : null,
  ].filter(Boolean) as { icon: React.ReactNode; txt: string }[];
}

function Foto({ c, titulo, className }: { c: any; titulo: string; className?: string }) {
  const img = c.capa_marketing_url ?? c.fotos?.[0];
  if (!img) {
    return (
      <div className={`w-full h-full flex items-center justify-center text-[var(--fg-faint)] ${className ?? ""}`}>
        <Car size={30} />
      </div>
    );
  }
  return (
    <>
      {/* fundo borrado: foto de carro raramente é 4:3 — sem isso sobra tarja branca */}
      <img src={img} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-70" />
      <img src={img} alt={titulo} loading="lazy" className={`absolute inset-0 w-full h-full object-contain transition-transform duration-500 ${className ?? ""}`} />
    </>
  );
}

interface CardProps {
  c: any;
  tenant: string;
  nomeEmpresa: string;
  whatsapp: string;
  novo?: boolean;
}

export function CarCardPremium({ c, tenant, nomeEmpresa, whatsapp, novo }: CardProps) {
  const titulo = [c.marca, c.modelo].filter(Boolean).join(" ") || "Veículo";
  const href = `/vitrine/${tenant}/${c.id}`;
  const selos = selosDe(c);
  const laudo = selos.find((s) => s.key === "vist");
  const outros = selos.filter((s) => s.key !== "vist");
  const specs = specsDe(c);

  return (
    <article className="group bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-sm hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 flex flex-col">
      <Link href={href} className="relative block aspect-[4/3] bg-[var(--surface-2)] overflow-hidden">
        <Foto c={c} titulo={titulo} className="group-hover:scale-[1.04]" />

        <div className="absolute top-2.5 left-2.5 flex flex-col items-start gap-1.5">
          {novo && (
            <span className="flex items-center gap-1 bg-[var(--brand)] text-[var(--brand-fg)] px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow">
              <Sparkles size={9} /> Recém-chegado
            </span>
          )}
          {c.video_url && (
            <span className="flex items-center gap-1 bg-black/75 text-white px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow backdrop-blur-sm">
              <Play size={8} className="fill-white" /> Vídeo
            </span>
          )}
        </div>

        {laudo && (
          <span className="absolute bottom-2.5 right-2.5 flex items-center gap-1 bg-white/95 text-emerald-700 px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-widest shadow-lg">
            <ShieldCheck size={10} /> Laudo cautelar
          </span>
        )}

        {outros.length > 0 && (
          <div className="absolute bottom-2.5 left-2.5 flex flex-wrap gap-1 max-w-[60%]">
            {outros.map((s) => (
              <span key={s.key} className={`${s.className} px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest`}>
                {s.label}
              </span>
            ))}
          </div>
        )}
      </Link>

      <div className="p-3.5 sm:p-4 flex flex-col flex-1">
        <Link href={href} className="block min-w-0">
          <h3 className="text-[13px] sm:text-[15px] font-black uppercase italic tracking-tight leading-tight truncate group-hover:text-[var(--brand)] transition-colors">
            {titulo}
          </h3>
          {c.versao && (
            <p className="text-[9px] sm:text-[10px] text-[var(--fg-faint)] font-bold uppercase tracking-widest mt-1 truncate">{c.versao}</p>
          )}

          {specs.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-2.5 text-[10px] sm:text-[11px] text-[var(--fg-muted)] font-semibold">
              {specs.map((s, i) => (
                <span key={i} className="flex items-center gap-1">{s.icon} {s.txt}</span>
              ))}
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-[var(--border)]">
            <p className="text-[8px] font-black uppercase tracking-widest text-[var(--fg-faint)] mb-0.5">Preço</p>
            <p className="text-lg sm:text-2xl font-black tracking-tighter">{fmtBRL(c.preco_sugerido)}</p>
          </div>
        </Link>

        <div className="mt-3 flex flex-col flex-1 justify-end gap-2">
          <a
            href={whatsappLink(whatsapp, msgInteresse(c, nomeEmpresa))}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white py-2.5 rounded-xl font-black uppercase text-[9px] sm:text-[10px] tracking-widest transition-colors"
          >
            <MessageCircle size={12} /> Chamar no WhatsApp
          </a>
          <Link
            href={href}
            className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-[var(--fg-faint)] hover:text-[var(--brand)] transition-colors w-full text-center"
          >
            Ver detalhes
          </Link>
        </div>
      </div>
    </article>
  );
}
