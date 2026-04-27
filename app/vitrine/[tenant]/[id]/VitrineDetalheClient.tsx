"use client";

import { useState } from "react";
import Link from "next/link";
import {
  MessageCircle, ChevronLeft, Play, Pause, Zap,
  CheckCircle2, Calendar, Palette, CreditCard, ArrowRight,
} from "lucide-react";

const WHATSAPP_DEFAULT = process.env.NEXT_PUBLIC_ZAPI_PHONE ?? "5521999999999";

function fmt(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function whatsappLink(numero: string, texto: string) {
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

// ─── Galeria ─────────────────────────────────────────────────────────────────

function Galeria({ fotos, capa }: { fotos: string[]; capa?: string }) {
  const todas = [...new Set([...(capa ? [capa] : []), ...(fotos ?? [])])];
  const [ativa, setAtiva] = useState(todas[0] ?? "");
  const [zoom, setZoom] = useState(false);

  if (todas.length === 0) return null;

  return (
    <div>
      <div
        className="relative w-full rounded-3xl overflow-hidden bg-gray-100 cursor-zoom-in shadow-sm"
        style={{ aspectRatio: "16/9" }}
        onClick={() => setZoom(true)}
      >
        <img src={ativa} alt="Foto do veículo" className="w-full h-full object-cover hover:scale-105 transition-transform duration-700" />
        <div className="absolute bottom-3 right-3 bg-black/50 backdrop-blur-sm px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest text-white">
          {todas.indexOf(ativa) + 1} / {todas.length}
        </div>
      </div>
      {todas.length > 1 && (
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {todas.map((foto, i) => (
            <button
              key={i}
              onClick={() => setAtiva(foto)}
              className={`flex-shrink-0 w-20 h-14 rounded-xl overflow-hidden border-2 transition-all ${
                ativa === foto ? "border-red-500" : "border-gray-200 hover:border-gray-400"
              }`}
            >
              <img src={foto} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {zoom && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4" onClick={() => setZoom(false)}>
          <img src={ativa} alt="" className="max-w-full max-h-full rounded-2xl object-contain" />
        </div>
      )}
    </div>
  );
}

// ─── Player de vídeo ──────────────────────────────────────────────────────────

function VideoPlayer({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);

  const toggle = () => {
    if (!videoEl) return;
    if (playing) { videoEl.pause(); setPlaying(false); }
    else { videoEl.play(); setPlaying(true); }
  };

  return (
    <div className="relative w-full rounded-3xl overflow-hidden bg-gray-900 shadow-xl" style={{ aspectRatio: "9/16", maxHeight: 560 }}>
      <video ref={setVideoEl} src={url} className="w-full h-full object-cover" playsInline loop onEnded={() => setPlaying(false)} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none" />
      <button onClick={toggle} className="absolute inset-0 flex items-center justify-center group">
        <div className={`w-16 h-16 rounded-full border-2 border-white/70 bg-black/30 backdrop-blur-sm flex items-center justify-center transition-all group-hover:scale-110 group-hover:border-white ${playing ? "opacity-0 group-hover:opacity-100" : "opacity-100"}`}>
          {playing ? <Pause size={20} className="text-white fill-white" /> : <Play size={20} className="text-white fill-white ml-1" />}
        </div>
      </button>
    </div>
  );
}

// ─── Card relacionado ─────────────────────────────────────────────────────────

function CardRelacionado({ carro, tenant }: { carro: any; tenant: string }) {
  const img = carro.capa_marketing_url ?? carro.fotos?.[0];
  return (
    <Link href={`/vitrine/${tenant}/${carro.id}`} className="group bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all block">
      <div className="aspect-video overflow-hidden bg-gray-100">
        {img
          ? <img src={img} alt={carro.modelo} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          : <div className="w-full h-full flex items-center justify-center text-gray-300"><Zap size={24} /></div>
        }
      </div>
      <div className="p-4">
        <p className="font-black uppercase italic text-sm tracking-tight text-gray-900 group-hover:text-red-600 transition-colors">
          {carro.marca} {carro.modelo}
        </p>
        <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
          {carro.versao} • {carro.ano_modelo}
        </p>
        <p className="font-black text-gray-900 mt-2 text-sm">{fmt(carro.preco_sugerido ?? 0)}</p>
      </div>
    </Link>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function VitrineDetalheClient({ veiculo, relacionados, nomeEmpresa, whatsapp, logoUrl, tenant }: { veiculo: any; relacionados: any[]; nomeEmpresa?: string; whatsapp?: string; logoUrl?: string | null; tenant: string }) {
  const titulo = `${veiculo.marca} ${veiculo.modelo}`.trim();
  const subtitulo = [veiculo.versao, veiculo.ano_modelo].filter(Boolean).join(" • ");
  const fotos: string[] = veiculo.fotos ?? [];
  const pontos: string[] = veiculo.pontos_fortes_venda ?? [];
  const vendido = veiculo.status_venda === "VENDIDO";
  const nomeGaragem = nomeEmpresa ?? "nossa loja";
  const numeroWhats = whatsapp || WHATSAPP_DEFAULT;
  const msgWhats = `Oi! Vi o *${titulo}${veiculo.versao ? " " + veiculo.versao : ""}${veiculo.ano_modelo ? " " + veiculo.ano_modelo : ""}* na vitrine da ${nomeGaragem} e tenho interesse. Ainda disponível?`;

  return (
    <div className="bg-gray-50 min-h-screen text-gray-900 font-sans">

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href={`/vitrine/${tenant}`} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-900 transition-colors">
            <ChevronLeft size={14} /> Voltar ao pátio
          </Link>
          <div className="flex items-center gap-2">
            {logoUrl ? (
              <img src={logoUrl} alt={nomeGaragem} className="h-10 w-auto object-contain" />
            ) : (
              <>
                <span className="text-lg font-black uppercase italic tracking-tighter text-gray-900">{nomeGaragem.split(" ")[0]}</span>
                {nomeGaragem.split(" ").length > 1 && (
                  <span className="text-lg font-black uppercase italic tracking-tighter text-red-600"> {nomeGaragem.split(" ").slice(1).join(" ")}</span>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">

          {/* ── Mídia ── */}
          <div className="space-y-4">
            {veiculo.video_url && <VideoPlayer url={veiculo.video_url} />}
            {fotos.length > 0 && <Galeria fotos={fotos} capa={veiculo.capa_marketing_url} />}
          </div>

          {/* ── Informações ── */}
          <div className="space-y-5">

            {vendido && (
              <span className="inline-block bg-gray-100 text-gray-500 text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full">
                Vendido
              </span>
            )}

            <div>
              <h1 className="text-5xl font-black uppercase italic tracking-tighter leading-none text-gray-900">
                {veiculo.marca}<br /><span className="text-red-600">{veiculo.modelo}</span>
              </h1>
              {subtitulo && (
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400 mt-3">{subtitulo}</p>
              )}
            </div>

            {/* Preço */}
            <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Preço de oportunidade</p>
              <p className="text-4xl font-black tracking-tighter text-gray-900">{fmt(veiculo.preco_sugerido ?? 0)}</p>
              {veiculo.parcelas && (
                <p className="text-[10px] font-bold text-gray-400 mt-1 flex items-center gap-1">
                  <CreditCard size={11} /> ou em até {veiculo.parcelas}
                </p>
              )}
            </div>

            {/* Specs */}
            {(veiculo.ano_modelo || veiculo.cor) && (
              <div className="grid grid-cols-2 gap-3">
                {veiculo.ano_modelo && (
                  <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center gap-3">
                    <div className="w-8 h-8 bg-red-50 rounded-xl flex items-center justify-center">
                      <Calendar size={14} className="text-red-500" />
                    </div>
                    <div>
                      <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Ano</p>
                      <p className="font-black text-sm text-gray-900">{veiculo.ano_modelo}</p>
                    </div>
                  </div>
                )}
                {veiculo.cor && (
                  <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center gap-3">
                    <div className="w-8 h-8 bg-red-50 rounded-xl flex items-center justify-center">
                      <Palette size={14} className="text-red-500" />
                    </div>
                    <div>
                      <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Cor</p>
                      <p className="font-black text-sm text-gray-900 capitalize">{veiculo.cor}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Pontos fortes */}
            {pontos.length > 0 && (
              <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-4">
                  ✦ Diferenciais do carro
                </p>
                <ul className="space-y-2.5">
                  {pontos.map((ponto, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <CheckCircle2 size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                      <span className="text-[11px] font-bold text-gray-600 leading-tight">{ponto}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Detalhes */}
            {veiculo.detalhes && (
              <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-3">Sobre este veículo</p>
                <p className="text-[11px] text-gray-500 leading-relaxed whitespace-pre-line">{veiculo.detalhes}</p>
              </div>
            )}

            {/* CTA */}
            {!vendido && (
              <div className="space-y-3">
                <a
                  href={whatsappLink(numeroWhats, msgWhats)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-3 w-full bg-green-500 hover:bg-green-400 text-white py-5 rounded-2xl font-black uppercase tracking-widest text-sm transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-green-200"
                >
                  <MessageCircle size={20} strokeWidth={2.5} />
                  Quero este veículo
                </a>
                <p className="text-center text-[9px] font-bold uppercase tracking-widest text-gray-400">
                  Resposta imediata via WhatsApp • Sem compromisso
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Relacionados ── */}
        {relacionados.length > 0 && (
          <div className="mt-20">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-6 h-0.5 bg-red-500" />
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Mais do pátio</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {relacionados.map((c) => <CardRelacionado key={c.id} carro={c} tenant={tenant} />)}
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="mt-16 pt-8 border-t border-gray-100 flex flex-col sm:flex-row justify-between items-center gap-3">
          <Link href={`/vitrine/${tenant}`} className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-900 transition-colors">
            <ChevronLeft size={11} /> Ver todo o estoque
          </Link>
          <p className="text-[9px] font-bold uppercase tracking-widest text-gray-300">© {new Date().getFullYear()} {nomeGaragem}</p>
        </div>
      </div>

    </div>
  );
}
