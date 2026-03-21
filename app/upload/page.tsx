"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Vehicle } from "@/types/vehicle";
import { supabase } from "@/lib/supabase";
import { Upload, Video, Info, CheckCircle, Download, Trash2, ArrowRight } from "lucide-react";
import Link from "next/link";

export default function UploadPage() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [resultadoAnalise, setResultadoAnalise] = useState<Vehicle | null>(null);
  const router = useRouter();

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

  const handleFileUpload = async (file: File) => {
    if (!file) return;
    setVideoFile(file);
    setIsAnalyzing(true);
    setResultadoAnalise(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const uploadResponse = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      const uploadData = await uploadResponse.json();
      const videoUrl = uploadData.videoUrl;

      if (!uploadResponse.ok || !videoUrl) {
        alert("Erro no upload: " + (uploadData.error || "Erro desconhecido"));
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      const vendedorId = user?.id || "00000000-0000-0000-0000-000000000000";

      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl, vendedorId })
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
    <main className="flex-1 p-10 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <header className="mb-12">
          <h1 className="text-3xl font-black uppercase tracking-tighter text-gray-900 italic">Nova Análise</h1>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Garage Premium Intelligence</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div className="space-y-8">
            <section className="bg-white p-10 border border-gray-100 rounded-[2.5rem] shadow-sm">
              <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-10 flex items-center gap-3">
                <span className="w-1.5 h-1.5 bg-red-600 rounded-full animate-ping"></span>
                Input de Vídeo
              </h2>
              
              <div className="space-y-6">
                <label className="block cursor-pointer">
                  <div className={`flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-3xl transition-all group ${
                    isAnalyzing 
                    ? "border-gray-100 bg-gray-50 cursor-wait" 
                    : "border-gray-100 bg-gray-50/50 hover:border-red-600/30 hover:bg-white cursor-pointer"
                  }`}>
                    <input 
                      type="file" 
                      accept="video/*" 
                      capture="environment" 
                      className="hidden" 
                      onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])} 
                      disabled={isAnalyzing}
                    />
                    
                    {isAnalyzing ? (
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-10 h-10 border-2 border-red-600 border-t-transparent rounded-full animate-spin"></div>
                        <p className="text-[10px] font-black text-red-600 uppercase tracking-widest animate-pulse">Processando Inteligência...</p>
                      </div>
                    ) : (
                      <>
                        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-6 shadow-sm group-hover:scale-110 transition-transform">
                          <Video className="w-8 h-8 text-gray-400 group-hover:text-red-600" />
                        </div>
                        <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest text-center px-10 leading-relaxed">
                          Arraste ou clique para<br />gravar inspeção
                        </p>
                      </>
                    )}
                  </div>
                </label>
                
                {videoFile && (
                  <div className="bg-white border border-gray-100 p-4 rounded-2xl flex items-center gap-4">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <p className="text-[10px] text-gray-600 font-black uppercase tracking-widest truncate">
                      📍 {videoFile.name}
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-10 pt-10 border-t border-gray-50 space-y-6">
                 <div className="flex items-start gap-4 text-gray-400">
                    <div className="bg-gray-50 p-4 rounded-2xl text-red-600">
                      <Info className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-900 uppercase mb-2">Dica de Engenharia</p>
                      <p className="text-[10px] leading-relaxed font-bold uppercase opacity-60">Vídeos de 30-60 segundos geram os melhores insights estruturais.</p>
                    </div>
                 </div>
              </div>
            </section>
          </div>

          <div className="space-y-8">
            {resultadoAnalise ? (
              <section className="bg-white border-l-8 border-red-600 p-10 border border-gray-100 rounded-[2.5rem] shadow-sm animate-in fade-in slide-in-from-right-4 duration-500">
                <div className="flex justify-between items-start mb-10">
                  <div>
                    <h3 className="text-3xl font-black text-gray-900 tracking-tight italic uppercase">{resultadoAnalise.marca} {resultadoAnalise.modelo}</h3>
                    <p className="text-gray-400 font-bold text-[10px] tracking-widest uppercase mt-2">{resultadoAnalise.versao} | {resultadoAnalise.ano_modelo}</p>
                  </div>
                  <div className="bg-green-50 px-4 py-2 rounded-full flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="text-green-600 text-[10px] font-black uppercase">Analizado</span>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="flex justify-between border-b border-gray-50 pb-4">
                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-widest">Preço Sugerido</span>
                    <span className="text-red-600 font-mono font-black text-xl">
                      R$ {resultadoAnalise.preco_sugerido ? resultadoAnalise.preco_sugerido.toLocaleString('pt-BR') : '0,00'}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-gray-50 pb-4">
                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-widest">Quilometragem</span>
                    <span className="text-gray-900 font-mono font-black text-xl">
                      {resultadoAnalise.quilometragem_estimada?.toLocaleString('pt-BR') || '0'} KM
                    </span>
                  </div>
                </div>

                <div className="mt-10">
                  <h4 className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-3">
                    <span className="w-1 h-3 bg-red-600 rounded-full"></span>
                    Argumentos IA
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {resultadoAnalise.pontos_fortes_venda?.map((ponto: string, i: number) => (
                      <span key={i} className="bg-gray-50 text-[9px] text-gray-600 px-4 py-2 rounded-xl border border-gray-100 font-bold">
                        {ponto}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-10 flex flex-col gap-4">
                  <button 
                    onClick={() => resultadoAnalise.video_url && downloadVideo(resultadoAnalise.video_url, `GARAGE_${resultadoAnalise.modelo}.mp4`)}
                    className="flex items-center justify-center gap-3 px-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl hover:bg-gray-100 transition-all text-[10px] font-black text-gray-600 uppercase tracking-widest shadow-sm"
                  >
                    <Download className="w-4 h-4" />
                    Download Vídeo
                  </button>

                  <Link 
                    href="/dashboard"
                    className="flex items-center justify-center gap-3 w-full py-5 bg-gray-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-red-600 transition-all shadow-xl"
                  >
                    Ver no Estoque
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </section>
            ) : (
              <div className="h-full min-h-[500px] border-2 border-dashed border-gray-100 rounded-[2.5rem] bg-white/30 flex flex-col items-center justify-center text-center p-16">
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-8 shadow-inner">
                  <CheckCircle className="w-10 h-10 text-gray-200" />
                </div>
                <h3 className="text-gray-400 font-black uppercase tracking-widest text-[10px]">Aguardando Processamento</h3>
                <p className="text-gray-900 text-[10px] max-w-[250px] mt-4 font-bold uppercase tracking-widest leading-relaxed opacity-40">Os resultados da IA aparecerão aqui assim que o vídeo for analisado.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
