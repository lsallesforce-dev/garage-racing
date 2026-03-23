"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { Zap, MessageCircle, Play } from "lucide-react";

export default function VitrinePublica() {
  const [estoque, setEstoque] = useState<any[]>([]);

  useEffect(() => {
    supabase
      .from("veiculos")
      .select("id, marca, modelo, versao, ano_modelo, preco_sugerido, capa_marketing_url, fotos, video_url")
      .eq("status_venda", "DISPONIVEL")
      .order("created_at", { ascending: false })
      .then(({ data }) => { if (data) setEstoque(data); });
  }, []);

  const WHATSAPP = process.env.NEXT_PUBLIC_ZAPI_PHONE ?? "5521999999999";

  return (
    <div className="bg-gray-50 min-h-screen text-gray-900 font-sans">

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl font-black uppercase italic tracking-tighter text-gray-900">Garage</span>
            <span className="text-xl font-black uppercase italic tracking-tighter text-red-600">Racing</span>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <div className="py-12 px-6 border-b border-gray-100 bg-white">
        <div className="max-w-7xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">
            Encontre seu próximo <span className="text-red-600">veículo</span>
          </h1>
          <p className="text-gray-500 text-sm max-w-md mx-auto">
            Cada veículo analisado e verificado. Vídeo completo, pontos fortes e atendimento imediato.
          </p>
        </div>
      </div>

      {/* ── Grid de carros ── */}
      <div className="max-w-7xl mx-auto px-6 py-12">
        {estoque.length > 0 ? (
          <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {estoque.map((carro) => {
              const img = carro.capa_marketing_url ?? carro.fotos?.[0];
              const preco = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(carro.preco_sugerido ?? 0);
              return (
                <Link
                  key={carro.id}
                  href={`/vitrine/${carro.id}`}
                  className="bg-white rounded-3xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group block"
                >
                  {/* Imagem */}
                  <div className="relative aspect-video overflow-hidden bg-gray-100">
                    {img ? (
                      <img
                        src={img}
                        alt={carro.modelo}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300">
                        <Zap size={32} />
                      </div>
                    )}
                    {carro.video_url && (
                      <div className="absolute top-3 right-3 bg-red-600 text-white px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1 shadow-lg">
                        <Play size={8} className="fill-white" /> Vídeo
                      </div>
                    )}
                    <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm text-gray-700 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest">
                      Verificado
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-6">
                    <h2 className="text-xl font-black uppercase italic tracking-tight leading-none text-gray-900 group-hover:text-red-600 transition-colors">
                      {carro.marca} {carro.modelo}
                    </h2>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1.5">
                      {carro.versao ?? "—"} • {carro.ano_modelo ?? "—"}
                    </p>

                    <div className="mt-5 pt-5 border-t border-gray-50">
                      <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Preço</p>
                      <p className="text-2xl font-black tracking-tighter text-gray-900">{preco}</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="py-32 text-center border-2 border-dashed border-gray-200 rounded-3xl bg-white">
            <Zap size={32} className="mx-auto text-gray-300 mb-4" />
            <p className="text-xs font-black uppercase tracking-widest text-gray-400">
              Pátio sendo reabastecido…
            </p>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-100 py-8 text-center bg-white">
        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
          © 2026 Garage Racing • Pátio Digital de Elite
        </p>
      </footer>

      {/* ── FAB WhatsApp ── */}
      <div className="fixed bottom-6 right-6 z-50">
        <a
          href={`https://wa.me/${WHATSAPP}?text=Oi! Me ajuda a escolher um carro no pátio?`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 bg-green-500 hover:bg-green-400 text-white pl-4 pr-5 py-3.5 rounded-full shadow-2xl transition-all hover:scale-105 active:scale-95"
        >
          <MessageCircle size={18} strokeWidth={2.5} />
          <span className="font-black uppercase text-[9px] tracking-widest">Falar agora</span>
        </a>
      </div>
    </div>
  );
}
