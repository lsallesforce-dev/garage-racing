"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PortalCarro, PortalCarroDetalhe } from "@/lib/portal/query";
import {
  ChevronLeft, MapPin, Gauge, Fuel, Cog, Palette, Play, Video, ShieldCheck,
  BadgeCheck, TrendingDown, MessageCircle, Check, X, Calculator, Settings2,
} from "lucide-react";

const brl = (v: number | null) =>
  v == null
    ? "Sob consulta"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
const km = (v: number | null) => (v == null ? null : `${new Intl.NumberFormat("pt-BR").format(v)} km`);

export default function CarroDetalhe({ c, relacionados }: { c: PortalCarroDetalhe; relacionados: PortalCarro[] }) {
  // mídia selecionada: índice da foto, ou "video"
  const [sel, setSel] = useState<number | "video">(0);
  const [showFin, setShowFin] = useState(false);

  const titulo = [c.marca, c.modelo].filter(Boolean).join(" ") || c.modelo || "Veículo";
  const local = [c.cidade, c.uf].filter(Boolean).join(" · ");
  const msg = encodeURIComponent(
    `Olá! Vi o ${[c.marca, c.modelo, c.ano].filter(Boolean).join(" ")} no portal AutoZap e tenho interesse. Ainda está disponível?`
  );
  const wa = c.loja.whatsapp ? `https://wa.me/${c.loja.whatsapp.replace(/\D/g, "")}?text=${msg}` : null;

  // FIPE: só mostra "abaixo da FIPE" se houver valor de FIPE acima do preço
  const economiaFipe = useMemo(() => {
    if (!c.valorFipe || !c.preco || c.valorFipe <= c.preco) return null;
    const pct = Math.round(((c.valorFipe - c.preco) / c.valorFipe) * 100);
    return { valor: c.valorFipe - c.preco, pct };
  }, [c.valorFipe, c.preco]);

  const ficha: [string, string | null][] = [
    ["Marca", c.marca],
    ["Modelo", c.modelo],
    ["Versão", c.versao],
    ["Ano", c.ano ? String(c.ano) : null],
    ["Quilometragem", km(c.km)],
    ["Combustível", c.combustivel],
    ["Câmbio", c.cambio],
    ["Cor", c.cor],
    ["Motor", c.motor],
    ["Potência", c.potenciaCv ? `${c.potenciaCv} cv` : null],
    ["Carroceria", c.categoria],
    ["Proprietários", c.qtdProprietarios ? String(c.qtdProprietarios) : null],
    ["Tabela FIPE", c.valorFipe ? brl(c.valorFipe) : null],
  ];
  const fichaPreenchida = ficha.filter(([, v]) => v);

  return (
    <div className="max-w-7xl mx-auto px-5 py-6">
      {/* Voltar */}
      <Link href="/carros" className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-900 transition mb-5">
        <ChevronLeft size={14} /> Voltar aos carros
      </Link>

      <div className="grid lg:grid-cols-12 gap-8">
        {/* ── COLUNA MÍDIA ── */}
        <div className="lg:col-span-7">
          {/* Mídia principal */}
          <div className="relative aspect-[4/3] rounded-3xl overflow-hidden bg-gray-100 border border-gray-100">
            {sel === "video" && c.videoUrl ? (
              <video src={c.videoUrl} controls autoPlay playsInline className="absolute inset-0 w-full h-full object-contain bg-black" />
            ) : (
              <>
                <img src={c.fotos[sel as number] ?? c.foto ?? ""} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-70" />
                <img src={c.fotos[sel as number] ?? c.foto ?? ""} alt={titulo} className="absolute inset-0 w-full h-full object-contain" />
              </>
            )}
            {/* Selos sobre a mídia */}
            <div className="absolute top-4 left-4 flex flex-wrap gap-1.5">
              {economiaFipe && (
                <span className="flex items-center gap-1 bg-[#22c55e] text-white px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow">
                  <TrendingDown size={11} /> {economiaFipe.pct}% abaixo da FIPE
                </span>
              )}
              {c.selos.repasse && (
                <span className="bg-[#161616] text-white px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow">
                  Repasse
                </span>
              )}
            </div>
          </div>

          {/* Thumbnails */}
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {c.videoUrl && (
              <button
                onClick={() => setSel("video")}
                className={`relative shrink-0 w-24 h-20 rounded-xl overflow-hidden border-2 grid place-items-center bg-gray-900 ${
                  sel === "video" ? "border-red-500" : "border-transparent"
                }`}
              >
                <img src={c.foto ?? ""} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" />
                <span className="relative w-8 h-8 rounded-full bg-red-600 grid place-items-center">
                  <Play size={13} className="text-white fill-white" />
                </span>
              </button>
            )}
            {c.fotos.map((f, i) => (
              <button
                key={i}
                onClick={() => setSel(i)}
                className={`shrink-0 w-24 h-20 rounded-xl overflow-hidden border-2 transition ${
                  sel === i ? "border-red-500" : "border-transparent hover:border-gray-300"
                }`}
              >
                <img src={f} alt={`${titulo} foto ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>

        {/* ── COLUNA INFO (sticky) ── */}
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-24">
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              {c.temVideo && <Chip icon={<Video size={10} className="fill-current" />} className="bg-red-600 text-white">Vídeo</Chip>}
              {(c.selos.vistoriado || c.selos.cautelar) && <Chip icon={<ShieldCheck size={10} />} className="bg-white text-gray-700 border border-gray-200">Vistoriado</Chip>}
              {c.selos.unicoDono && <Chip icon={<BadgeCheck size={10} />} className="bg-blue-600 text-white">Único Dono</Chip>}
            </div>

            <h1 className="text-3xl font-black uppercase italic tracking-tight leading-none text-gray-900">{titulo}</h1>
            <p className="text-[11px] text-gray-400 font-bold uppercase tracking-widest mt-2">
              {[c.versao, c.ano].filter(Boolean).join(" • ") || "—"}
            </p>

            {/* Specs rápidas */}
            <div className="grid grid-cols-2 gap-2 mt-5">
              <Spec icon={<Gauge size={14} />} label="KM" value={km(c.km) ?? "—"} />
              <Spec icon={<Fuel size={14} />} label="Combustível" value={c.combustivel ?? "—"} />
              <Spec icon={<Cog size={14} />} label="Câmbio" value={c.cambio ?? "—"} />
              <Spec icon={<Palette size={14} />} label="Cor" value={c.cor ?? "—"} />
            </div>

            {/* Preço */}
            <div className="mt-6 bg-[#161616] text-white rounded-2xl p-5">
              <p className="text-[9px] font-black uppercase tracking-widest text-white/50 mb-1">Preço à vista</p>
              <p className="text-4xl font-black tracking-tighter">{brl(c.preco)}</p>
              {economiaFipe && (
                <p className="text-[12px] text-[#22c55e] font-bold mt-1.5">
                  {brl(economiaFipe.valor)} abaixo da tabela FIPE
                </p>
              )}
            </div>

            {/* CTAs */}
            <div className="mt-4 flex flex-col gap-2.5">
              {wa ? (
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 bg-[#22c55e] hover:bg-[#16a34a] text-white py-4 rounded-2xl font-black uppercase text-[12px] tracking-widest transition active:scale-[0.98]"
                >
                  <MessageCircle size={16} /> Falar com a loja agora
                </a>
              ) : (
                <div className="text-center text-[11px] font-black uppercase tracking-widest text-gray-300 py-4">
                  Contato indisponível
                </div>
              )}
              <button
                onClick={() => setShowFin(true)}
                className="flex items-center justify-center gap-2 bg-white border border-gray-200 hover:border-gray-300 text-gray-800 py-3.5 rounded-2xl font-black uppercase text-[11px] tracking-widest transition"
              >
                <Calculator size={15} /> Simular financiamento
              </button>
            </div>

            {/* Loja */}
            <div className="mt-5 flex items-center justify-between text-[11px] text-gray-500 font-bold uppercase tracking-wider border-t border-gray-100 pt-4">
              <span className="truncate">{c.loja.nome ?? "Revenda verificada"}</span>
              {local && <span className="flex items-center gap-1 shrink-0"><MapPin size={11} /> {local}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ── FICHA + OPCIONAIS + PONTOS FORTES ── */}
      <div className="grid lg:grid-cols-12 gap-8 mt-12">
        <div className="lg:col-span-7 flex flex-col gap-8">
          {/* Ficha técnica */}
          <section>
            <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
              <Settings2 size={13} /> Ficha técnica
            </h2>
            <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
              {fichaPreenchida.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-5 py-3">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400">{k}</span>
                  <span className="text-sm font-bold text-gray-800 text-right">{v}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Pontos fortes */}
          {c.pontosFortes.length > 0 && (
            <section>
              <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-4">Destaques</h2>
              <ul className="grid sm:grid-cols-2 gap-2">
                {c.pontosFortes.map((p, i) => (
                  <li key={i} className="flex items-start gap-2 bg-white rounded-xl border border-gray-100 px-4 py-3 text-sm text-gray-700">
                    <Check size={15} className="text-[#22c55e] shrink-0 mt-0.5" /> {p}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {c.detalhesInspecao && (
            <section>
              <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-4">Laudo / inspeção</h2>
              <p className="bg-white rounded-2xl border border-gray-100 p-5 text-sm text-gray-600 leading-relaxed whitespace-pre-line">
                {c.detalhesInspecao}
              </p>
            </section>
          )}
        </div>

        {/* Opcionais */}
        <div className="lg:col-span-5">
          {c.opcionais.length > 0 && (
            <section>
              <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-4">Opcionais</h2>
              <div className="flex flex-wrap gap-2">
                {c.opcionais.map((o, i) => (
                  <span key={i} className="bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-full text-[12px] font-semibold">
                    {o}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* ── RELACIONADOS ── */}
      {relacionados.length > 0 && (
        <section className="mt-16">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-5">
            Mais carros da {c.loja.nome ?? "loja"}
          </h2>
          <div className="grid gap-5 grid-cols-2 lg:grid-cols-4">
            {relacionados.map((r) => (
              <Link key={r.id} href={`/carros/${r.id}`} className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all group">
                <div className="relative aspect-[4/3] bg-gray-100 overflow-hidden">
                  {r.foto && (
                    <>
                      <img src={r.foto} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60" />
                      <img src={r.foto} alt={`${r.marca} ${r.modelo}`} loading="lazy" className="absolute inset-0 w-full h-full object-contain" />
                    </>
                  )}
                </div>
                <div className="p-3.5">
                  <p className="text-[13px] font-black uppercase italic tracking-tight text-gray-900 truncate group-hover:text-red-600 transition">
                    {[r.marca, r.modelo].filter(Boolean).join(" ")}
                  </p>
                  <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">{r.ano ?? "—"}</p>
                  <p className="text-base font-black tracking-tighter text-gray-900 mt-2">{brl(r.preco)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── MODAL FINANCIAMENTO ── */}
      {showFin && <ModalFinanciamento c={c} wa={wa} onClose={() => setShowFin(false)} />}
    </div>
  );
}

// ─── Subcomponentes ───────────────────────────────────────────────────────────
function Chip({ children, icon, className }: { children: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${className ?? ""}`}>
      {icon} {children}
    </span>
  );
}

function Spec({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-gray-400 mb-1">{icon}<span className="text-[8px] font-black uppercase tracking-widest">{label}</span></div>
      <p className="text-sm font-bold text-gray-800 truncate">{value}</p>
    </div>
  );
}

function ModalFinanciamento({ c, wa, onClose }: { c: PortalCarroDetalhe; wa: string | null; onClose: () => void }) {
  const preco = c.preco ?? 0;
  const [entrada, setEntrada] = useState("");
  const [parcelas, setParcelas] = useState("48");
  const entradaNum = parseFloat(entrada) || 0;
  const saldo = Math.max(preco - entradaNum, 0);
  const valorParcela = saldo / (parseInt(parcelas) || 1);

  const msg = encodeURIComponent(
    `Olá! Simulei o ${[c.marca, c.modelo, c.ano].filter(Boolean).join(" ")} no Portal AutoZap: entrada de ${brl(entradaNum)}, ${parcelas}x de ~${brl(valorParcela)}. Podemos conversar?`
  );
  const waSim = c.loja.whatsapp ? `https://wa.me/${c.loja.whatsapp.replace(/\D/g, "")}?text=${msg}` : wa;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-md p-7 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-5">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Simulação de financiamento</p>
            <h3 className="text-lg font-black uppercase italic tracking-tight text-gray-900">{[c.marca, c.modelo].filter(Boolean).join(" ")}</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 bg-gray-100 rounded-full grid place-items-center hover:bg-gray-200 transition"><X size={14} /></button>
        </div>

        <div className="bg-gray-50 rounded-2xl p-4 mb-5">
          <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Valor do veículo</p>
          <p className="text-2xl font-black tracking-tighter text-gray-900">{brl(preco)}</p>
        </div>

        <div className="space-y-4 mb-5">
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-500 block mb-2">Entrada (R$)</label>
            <input type="number" placeholder="Ex: 15000" value={entrada} onChange={(e) => setEntrada(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500" />
          </div>
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-500 block mb-2">Parcelas</label>
            <div className="grid grid-cols-6 gap-1.5">
              {[12, 24, 36, 48, 60, 72].map((n) => (
                <button key={n} onClick={() => setParcelas(String(n))}
                  className={`py-2 rounded-lg text-[11px] font-black transition ${
                    parcelas === String(n) ? "bg-gray-900 text-white" : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                  }`}>
                  {n}x
                </button>
              ))}
            </div>
          </div>
        </div>

        {saldo > 0 && (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-4 mb-5">
            <p className="text-[8px] font-black uppercase tracking-widest text-red-400 mb-0.5">Estimativa de parcela</p>
            <p className="text-3xl font-black tracking-tighter text-red-600">{brl(valorParcela)}<span className="text-sm font-bold text-red-400"> /mês</span></p>
            <p className="text-[9px] text-red-400 mt-1">Simulação sem juros. Taxa final sujeita à análise de crédito.</p>
          </div>
        )}

        {waSim && (
          <a href={waSim} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full bg-[#22c55e] hover:bg-[#16a34a] text-white py-4 rounded-2xl font-black uppercase tracking-widest text-[11px] transition active:scale-[0.98]">
            <MessageCircle size={16} /> Enviar simulação no WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}
