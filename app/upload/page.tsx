"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Vehicle } from "@/types/vehicle";
import { supabase } from "@/lib/supabase";

export default function UploadPage() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [resultadoAnalise, setResultadoAnalise] = useState<Vehicle | null>(null);
  const router = useRouter();

  // 1. Função de Download (Lógica de Engenharia)
  const downloadVideo = async (url: string, filename: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename || 'inspecao-garage-racing.mp4';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Erro ao baixar vídeo:", error);
    }
  };

  // 🏗️ Lógica de Upload para o Supabase
  const handleFileUpload = async (file: File) => {
    if (!file) return;
    setVideoFile(file);
    setIsAnalyzing(true);
    setResultadoAnalise(null);

    try {
      // 1. Subir para o nosso Proxy de Upload (Bypass de Signature/RLS)
      const formData = new FormData();
      formData.append("file", file);

      const uploadResponse = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      const uploadData = await uploadResponse.json();
      const videoUrl = uploadData.videoUrl;

      if (!uploadResponse.ok || !videoUrl) {
        console.error("Upload error:", uploadData.error);
        alert("Erro no upload: " + (uploadData.error || "Erro desconhecido"));
        return;
      }

      // 3. Chamar sua API de análise com a nova URL que o backend devolveu
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          videoUrl: videoUrl, 
          vendedorId: "00000000-0000-0000-0000-000000000000" // Fake UID para teste
        })
      });

      const data = await response.json();
      if (data.success) {
        setResultadoAnalise(data.data[0] as Vehicle);
      } else {
        alert("Erro na análise: " + data.error);
      }
    } catch (error) {
      console.error("Processing error:", error);
      alert("Erro ao processar o vídeo");
    } finally {
      setIsAnalyzing(false);
    }
  };



  return (
    <main className="flex-1 p-6 md:p-12 max-w-4xl mx-auto w-full">
      <header className="mb-12">
        <h1 className="text-4xl font-black tracking-tighter text-white mb-2">ANÁLISE DE ESTOQUE</h1>
        <p className="text-slate-500 uppercase tracking-widest text-xs font-bold">Garage Premium Intelligence</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Formulário de Input */}
        <div className="space-y-6">
          <section className="bg-card p-8 border border-white/5 rounded-2xl shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <span className="w-2 h-2 bg-primary rounded-full animate-ping"></span>
              PROCESSAR VÍDEO
            </h2>
            
            {/* 1. O Novo Input de Arquivo (No lugar do campo de texto) */}
            <div className="space-y-4">
              <label className="block cursor-pointer">
                <span className="sr-only">Escolher vídeo</span>
                <div className={`flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-2xl transition-all group ${
                  isAnalyzing 
                  ? "border-slate-800 bg-slate-900/50 cursor-wait" 
                  : "border-white/10 bg-[#161616] hover:border-primary/50 cursor-pointer"
                }`}>
                  <input 
                    type="file" 
                    accept="video/*" 
                    capture="environment" // <-- Força abrir a câmera no celular
                    className="hidden" 
                    onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])} 
                    disabled={isAnalyzing}
                  />
                  
                  {isAnalyzing ? (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                      <p className="text-sm font-bold text-primary animate-pulse uppercase tracking-[0.2em]">Analisando...</p>
                    </div>
                  ) : (
                    <>
                      <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-slate-400 group-hover:text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <p className="text-sm text-slate-400 font-bold uppercase tracking-widest text-center px-6">
                        Tocar para gravar<br />ou subir vídeo
                      </p>
                    </>
                  )}
                </div>
              </label>
              
              {videoFile && (
                <div className="bg-white/5 border border-white/10 p-3 rounded-lg flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest truncate">
                    📍 {videoFile.name}
                  </p>
                </div>
              )}
            </div>

            {/* 2. O Componente de Botão (Injetar na UI) */}
            {resultadoAnalise && (
              <div className="mt-6 p-4 border-t border-white/5 flex gap-3">
                <button
                  type="button"
                  onClick={() => resultadoAnalise.video_url && downloadVideo(resultadoAnalise.video_url, `GARAGE_${resultadoAnalise.modelo}.mp4`)}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#161616] border border-white/10 hover:bg-white/5 text-white rounded-lg transition-all font-medium text-sm"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  DOWNLOAD VÍDEO
                </button>
                
                <button
                  type="button"
                  onClick={() => {
                    setVideoFile(null);
                    setResultadoAnalise(null);
                  }}
                  className="px-4 py-3 bg-red-600/10 border border-red-600/20 text-red-500 hover:bg-red-600/20 rounded-lg transition-all"
                  title="Limpar Resultado"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>
              </div>
            )}

            <div className="mt-8 p-4 border-t border-white/5 pt-6 space-y-4">
               {/* Botão de teste temporário */}
               {!resultadoAnalise && !isAnalyzing && (
                 <button 
                   type="button"
                   onClick={() => setResultadoAnalise({
                     id: "test",
                     marca: "BMW",
                     modelo: "M3 Competition",
                     versao: "G80",
                     ano_modelo: 2024,
                     preco_sugerido: 850000,
                     quilometragem_estimada: 1200,
                     pontos_fortes_venda: ["Único dono", "Cor individual", "Revisado"],
                     video_url: "https://v1.zdassets.com/hc/theme_assets/123/1/test_video.mp4",
                     vendedor_id: "0"
                   })}
                   className="w-full py-2 bg-white/5 border border-white/10 rounded-lg text-[10px] text-slate-500 uppercase font-bold hover:bg-white/10 transition-all"
                 >
                   Simular Resultado (Teste de UI)
                 </button>
               )}

               <div className="flex items-start gap-4 text-slate-500">
                  <div className="bg-white/5 p-3 rounded-lg text-slate-400">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <rect x="3" y="4" width="18" height="16" rx="2" strokeWidth="2" />
                      <line x1="7" y1="8" x2="17" y2="8" strokeWidth="2" />
                      <line x1="7" y1="12" x2="17" y2="12" strokeWidth="2" />
                      <line x1="7" y1="16" x2="13" y2="16" strokeWidth="2" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white uppercase mb-1">Dica de Especialista</p>
                    <p className="text-[10px] leading-tight opacity-60">Vídeos de 30-60 segundos com áudio nítido do vendedor geram os melhores insights para o Gemini 1.5 Pro.</p>
                  </div>
               </div>
            </div>
          </section>
        </div>

        {/* Resultados */}
        <div className="space-y-6">
          {resultadoAnalise ? (
            <section className="bg-card border-l-4 border-accent p-8 border border-white/5 rounded-2xl animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-accent font-black text-2xl tracking-tight">{resultadoAnalise.marca} {resultadoAnalise.modelo}</h3>
                  <p className="text-slate-400 font-bold text-sm tracking-widest uppercase">{resultadoAnalise.versao} | {resultadoAnalise.ano_modelo}</p>
                </div>
                <div className="bg-accent/10 border border-accent/20 px-3 py-1 rounded-full">
                  <span className="text-accent text-[10px] font-black uppercase">Pronto</span>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-slate-500 text-xs font-bold uppercase tracking-widest">Preço Sugerido</span>
                  <span className="text-white font-mono font-bold">
                    R$ {resultadoAnalise.preco_sugerido?.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-slate-500 text-xs font-bold uppercase tracking-widest">KM Estimada</span>
                  <span className="text-white font-mono font-bold">{resultadoAnalise.quilometragem_estimada} KM</span>
                </div>
              </div>

              <div className="mt-8">
                <h4 className="text-[10px] font-black text-accent uppercase tracking-[0.2em] mb-3">Argumentos de Venda</h4>
                <div className="flex flex-wrap gap-2">
                  {resultadoAnalise.pontos_fortes_venda?.map((ponto: string, i: number) => (
                    <span key={i} className="bg-white/5 text-[10px] text-slate-300 px-3 py-1.5 rounded-lg border border-white/10">
                      {ponto}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-8 flex flex-col gap-3">
                <button 
                  onClick={() => resultadoAnalise.video_url && downloadVideo(resultadoAnalise.video_url, `GARAGE_${resultadoAnalise.modelo}.mp4`)}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all text-sm font-bold text-gray-300 uppercase tracking-widest"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download do Vídeo
                </button>

                <button 
                  onClick={() => router.push("/dashboard")}
                  className="w-full py-4 border border-white/10 rounded-xl font-bold text-slate-400 hover:bg-white/5 hover:text-white transition-all text-sm uppercase tracking-widest"
                >
                  Ver no Estoque Completo
                </button>
              </div>
            </section>
          ) : (
            <div className="h-full min-h-[400px] border-2 border-dashed border-white/5 rounded-2xl flex flex-col items-center justify-center text-center p-12">
              <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
              </div>
              <h3 className="text-slate-600 font-bold uppercase tracking-[0.2em] text-xs">Aguardando Processamento</h3>
              <p className="text-slate-800 text-[10px] max-w-[200px] mt-2 font-medium">Os resultados da IA aparecerão aqui assim que o vídeo for analisado.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
