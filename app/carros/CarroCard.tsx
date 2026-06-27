// Card de veículo reutilizável (server-safe — sem hooks). Usado nas landing
// pages de SEO. A vitrine principal tem sua própria cópia (client) — dedupe depois.
import Link from "next/link";
import type { PortalCarro } from "@/lib/portal/query";
import { MapPin, Gauge, Fuel, Cog, Video, ShieldCheck, BadgeCheck, TrendingDown, MessageCircle } from "lucide-react";

const brl = (v: number | null) =>
  v == null
    ? "Sob consulta"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
const km = (v: number | null) => (v == null ? null : `${new Intl.NumberFormat("pt-BR").format(v)} km`);

export default function CarroCard({ c }: { c: PortalCarro }) {
  const titulo = [c.marca, c.modelo].filter(Boolean).join(" ") || c.modelo || "Veículo";
  const local = [c.cidade, c.uf].filter(Boolean).join(" · ");
  const msg = encodeURIComponent(
    `Olá! Vi o ${[c.marca, c.modelo, c.ano].filter(Boolean).join(" ")} no portal AutoZap e tenho interesse. Ainda está disponível?`
  );
  const wa = c.loja.whatsapp ? `https://wa.me/${c.loja.whatsapp.replace(/\D/g, "")}?text=${msg}` : null;

  return (
    <article className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col">
      <Link href={`/carros/${c.id}`} className="relative aspect-[4/3] bg-gray-100 overflow-hidden block">
        {c.foto && (
          <>
            <img src={c.foto} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-70" />
            <img src={c.foto} alt={titulo} loading="lazy" className="absolute inset-0 w-full h-full object-contain" />
          </>
        )}
        <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5">
          {c.temVideo && (
            <span className="flex items-center gap-1 bg-red-600 text-white px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow">
              <Video size={9} className="fill-white" /> Vídeo
            </span>
          )}
          {c.selos.abaixoFipe && (
            <span className="flex items-center gap-1 bg-[#22c55e] text-white px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow">
              <TrendingDown size={9} /> Abaixo da FIPE
            </span>
          )}
        </div>
        <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5">
          {(c.selos.vistoriado || c.selos.cautelar) && (
            <span className="flex items-center gap-1 bg-white/90 backdrop-blur text-gray-700 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest">
              <ShieldCheck size={9} className="text-[#22c55e]" /> Vistoriado
            </span>
          )}
          {c.selos.unicoDono && (
            <span className="flex items-center gap-1 bg-blue-600 text-white px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest">
              <BadgeCheck size={9} /> Único Dono
            </span>
          )}
        </div>
      </Link>

      <div className="p-5 flex flex-col flex-1">
        <Link href={`/carros/${c.id}`}>
          <h2 className="text-[17px] font-black uppercase italic tracking-tight leading-none text-gray-900 hover:text-red-600 transition">{titulo}</h2>
        </Link>
        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1.5 line-clamp-1">
          {[c.versao, c.ano].filter(Boolean).join(" • ") || "—"}
        </p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[11px] text-gray-500 font-semibold">
          {km(c.km) && <span className="flex items-center gap-1"><Gauge size={11} /> {km(c.km)}</span>}
          {c.combustivel && <span className="flex items-center gap-1"><Fuel size={11} /> {c.combustivel}</span>}
          {c.cambio && <span className="flex items-center gap-1"><Cog size={11} /> {c.cambio}</span>}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-50">
          <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Preço</p>
          <p className="text-2xl font-black tracking-tighter text-gray-900">{brl(c.preco)}</p>
        </div>

        <div className="mt-3 flex items-center justify-between text-[10px] text-gray-400 font-bold uppercase tracking-wider">
          <span className="truncate">{c.loja.nome ?? "Revenda verificada"}</span>
          {local && <span className="flex items-center gap-1 shrink-0"><MapPin size={10} /> {local}</span>}
        </div>

        {wa ? (
          <a href={wa} target="_blank" rel="noopener noreferrer"
            className="mt-4 flex items-center justify-center gap-2 bg-[#22c55e] hover:bg-[#16a34a] text-white py-3 rounded-xl font-black uppercase text-[10px] tracking-widest transition active:scale-[0.98]">
            <MessageCircle size={14} /> Falar com a loja
          </a>
        ) : (
          <div className="mt-4 text-center text-[10px] font-black uppercase tracking-widest text-gray-300 py-3">
            Contato indisponível
          </div>
        )}
      </div>
    </article>
  );
}
