"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Vehicle } from "@/types/vehicle";
import { supabase } from "@/lib/supabase";
import {
  Upload, Video, Info, CheckCircle, Download,
  ArrowRight, Instagram, Loader2, Zap,
} from "lucide-react";
import Link from "next/link";

type InputMode = "dispositivo" | "instagram";

export default function UploadPage() {
  const [mode, setMode] = useState<InputMode>("dispositivo");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [resultadoAnalise, setResultadoAnalise] = useState<Vehicle | null>(null);
  const [uploadStep, setUploadStep] = useState<string>("");
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Instagram
  const [igUrl, setIgUrl] = useState("");
  const [igStep, setIgStep] = useState<"idle" | "baixando" | "analisando" | "erro">("idle");
  const [igErro, setIgErro] = useState("");

  const router = useRouter();

  // ── Helpers ──────────────────────────────────────────────────────────────

  const downloadVideo = async (url: string, filename: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename || "inspecao-garage-racing.mp4";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Erro ao baixar vídeo:", error);
    }
  };

  const analisarVideoUrl = async (videoUrl: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    const vendedorId = user?.id || "00000000-0000-0000-0000-000000000000";

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl, vendedorId }),
    });

    const data = await response.json();
    if (data.success) {
      setResultadoAnalise(data.data[0] as Vehicle);
    } else {
      throw new Error(data.error || "Falha na análise");
    }
  };

  // ── Modo Dispositivo ──────────────────────────────────────────────────────

  const handleFileUpload = async (file: File) => {
    if (!file) return;
    setVideoFile(file);
    setIsAnalyzing(true);
    setResultadoAnalise(null);
    setUploadError(null);

    try {
      // 1. Pede signed URL ao servidor
      setUploadStep("Preparando upload...");

      // Garante Content-Type válido — celulares Android podem retornar "" ou "application/octet-stream"
      const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
      const mimeMap: Record<string, string> = {
        mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
        mkv: "video/x-matroska", webm: "video/webm", "3gp": "video/3gpp",
      };
      const fileType = (file.type && file.type !== "application/octet-stream")
        ? file.type
        : (mimeMap[ext] ?? "video/mp4");

      const metaRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, fileType }),
      });

      const metaData = await metaRes.json();
      if (!metaRes.ok || !metaData.signedUrl) {
        throw new Error(metaData.error || "Erro ao obter URL de upload");
      }

      // 2. Upload direto com retry (backoff exponencial: 1s, 2s, 4s)
      setUploadStep("Enviando arquivo...");
      let uploadOk = false;
      let lastError = "";

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (attempt > 1) {
            const waitSec = attempt - 1;
            setUploadStep(`Tentativa ${attempt}/3 — aguardando ${waitSec}s...`);
            await new Promise((r) => setTimeout(r, waitSec * 1000));
            setUploadStep(`Tentativa ${attempt}/3 — enviando...`);
          }

          const uploadRes = await fetch(metaData.signedUrl, {
            method: "PUT",
            headers: { "Content-Type": fileType },
            body: file,
          });

          if (uploadRes.ok) {
            uploadOk = true;
            break;
          }
          lastError = `HTTP ${uploadRes.status}: ${uploadRes.statusText}`;
        } catch (err: any) {
          lastError = err.message || "Erro de rede";
        }
      }

      if (!uploadOk) {
        throw new Error(`Upload falhou após 3 tentativas. Último erro: ${lastError}`);
      }

      // 3. Análise com Gemini Vision (pode demorar 2-5 min para vídeos grandes)
      setUploadStep("Analisando vídeo com IA... (pode levar alguns minutos)");
      await analisarVideoUrl(metaData.publicUrl);
      setUploadStep("");
    } catch (error: any) {
      console.error("Processing error:", error);
      setUploadError(error.message);
      setUploadStep("");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ── Modo Instagram ────────────────────────────────────────────────────────

  const handleImportarIG = async () => {
    if (!igUrl.trim()) return;

    setIgStep("baixando");
    setIgErro("");
    setResultadoAnalise(null);

    try {
      // 1. Baixar vídeo do Instagram para o Supabase
      const igRes = await fetch("/api/tools/ig-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: igUrl.trim() }),
      });

      const igData = await igRes.json();
      if (!igData.success) throw new Error(igData.error || "Falha no download");

      // 2. Analisar o vídeo com IA (mesmo fluxo do upload manual)
      setIgStep("analisando");
      await analisarVideoUrl(igData.url);

      setIgStep("idle");
      setIgUrl("");
    } catch (error: any) {
      setIgStep("erro");
      setIgErro(error.message);
    }
  };

  const isLoading = isAnalyzing || igStep === "baixando" || igStep === "analisando";

  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAnalyzing) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (isAnalyzing) return;
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("video/")) {
      handleFileUpload(file);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="flex-1 p-10 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <header className="mb-12">
          <h1 className="text-3xl font-black uppercase tracking-tighter text-gray-900 italic">
            Nova Análise
          </h1>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
            Garage Premium Intelligence
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">

          {/* ── COLUNA ESQUERDA: INPUT ── */}
          <div className="space-y-8">
            <section className="bg-white p-10 border border-gray-100 rounded-[2.5rem] shadow-sm">

              {/* Tabs */}
              <div className="flex gap-2 mb-8 bg-gray-50 p-1.5 rounded-2xl">
                <button
                  onClick={() => { setMode("dispositivo"); setIgStep("idle"); setIgErro(""); }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    mode === "dispositivo"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  <Video size={13} /> Dispositivo
                </button>
                <button
                  onClick={() => { setMode("instagram"); setVideoFile(null); }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    mode === "instagram"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  <Instagram size={13} /> Instagram
                </button>
              </div>

              {/* ── TAB: DISPOSITIVO ── */}
              {mode === "dispositivo" && (
                <div className="space-y-6">
                  <label className="block cursor-pointer">
                    <div
                      onDragOver={handleDragOver}
                      onDragEnter={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={`flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-3xl transition-all group ${
                        isAnalyzing
                          ? "border-gray-100 bg-gray-50 cursor-wait"
                          : isDragOver
                            ? "border-red-600 bg-red-50 scale-[1.01]"
                            : "border-gray-100 bg-gray-50/50 hover:border-red-600/30 hover:bg-white"
                      }`}
                    >
                      <input
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                        disabled={isAnalyzing}
                      />

                      {isAnalyzing ? (
                        <div className="flex flex-col items-center gap-4 px-6 text-center">
                          <div className="w-10 h-10 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                          <p className="text-[10px] font-black text-red-600 uppercase tracking-widest animate-pulse">
                            {uploadStep || "Processando Inteligência..."}
                          </p>
                        </div>
                      ) : uploadError ? (
                        <div className="flex flex-col items-center gap-3 px-6 text-center">
                          <p className="text-[10px] font-black text-red-600 uppercase tracking-widest">
                            Falha no upload
                          </p>
                          <p className="text-[9px] text-gray-400 leading-relaxed">{uploadError}</p>
                          <button
                            type="button"
                            onClick={() => setUploadError(null)}
                            className="text-[9px] font-black uppercase tracking-widest text-red-600 underline"
                          >
                            Tentar novamente
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-6 shadow-sm transition-all ${isDragOver ? "bg-red-600 scale-110" : "bg-white group-hover:scale-110"}`}>
                            <Video className={`w-8 h-8 transition-colors ${isDragOver ? "text-white" : "text-gray-400 group-hover:text-red-600"}`} />
                          </div>
                          <p className={`text-[10px] font-black uppercase tracking-widest text-center px-10 leading-relaxed ${isDragOver ? "text-red-600" : "text-gray-400"}`}>
                            {isDragOver ? "Solte para enviar" : <>Arraste ou clique para<br />enviar vídeo</>}
                          </p>
                        </>
                      )}
                    </div>
                  </label>

                  {videoFile && (
                    <div className="bg-white border border-gray-100 p-4 rounded-2xl flex items-center gap-4">
                      <div className="w-2 h-2 bg-green-500 rounded-full" />
                      <p className="text-[10px] text-gray-600 font-black uppercase tracking-widest truncate">
                        📍 {videoFile.name}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ── TAB: INSTAGRAM ── */}
              {mode === "instagram" && (
                <div className="space-y-6">
                  {/* Área de input */}
                  <div className="flex flex-col items-center justify-center w-full min-h-48 border-2 border-dashed border-pink-200/60 rounded-3xl bg-gradient-to-br from-purple-50/30 to-pink-50/30 p-8 gap-5">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center shadow-lg">
                      <Instagram size={24} className="text-white" />
                    </div>

                    {isLoading ? (
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 size={22} className="animate-spin text-pink-500" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-pink-600 animate-pulse">
                          {igStep === "baixando"
                            ? "Baixando vídeo do Instagram..."
                            : "Analisando com IA..."}
                        </p>
                      </div>
                    ) : (
                      <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest text-center leading-relaxed">
                        Cole a URL de um Reel<br />ou post público
                      </p>
                    )}
                  </div>

                  <input
                    type="url"
                    value={igUrl}
                    onChange={(e) => {
                      setIgUrl(e.target.value);
                      setIgErro("");
                      setIgStep("idle");
                    }}
                    placeholder="https://www.instagram.com/reel/XXXXXX/"
                    disabled={isLoading}
                    className="w-full bg-gray-50 rounded-2xl border border-gray-100 px-5 py-4 text-sm font-medium text-gray-900 placeholder:text-gray-300 outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-400/10 transition-all disabled:opacity-50"
                  />

                  {igStep === "erro" && (
                    <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-3">
                      <p className="text-[10px] font-black uppercase text-red-600 tracking-widest">
                        ✗ {igErro}
                      </p>
                    </div>
                  )}

                  <button
                    onClick={handleImportarIG}
                    disabled={isLoading || !igUrl.trim()}
                    className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-black uppercase italic tracking-widest rounded-2xl hover:opacity-90 transition-all shadow-lg shadow-pink-500/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                  >
                    {isLoading ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <Zap size={18} />
                    )}
                    {isLoading
                      ? igStep === "baixando"
                        ? "Baixando..."
                        : "Analisando..."
                      : "Importar e Analisar"}
                  </button>
                </div>
              )}

              {/* Dica (só aparece no modo dispositivo) */}
              {mode === "dispositivo" && (
                <div className="mt-10 pt-10 border-t border-gray-50">
                  <div className="flex items-start gap-4 text-gray-400">
                    <div className="bg-gray-50 p-4 rounded-2xl text-red-600 flex-shrink-0">
                      <Info className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-900 uppercase mb-2">
                        Dica de Engenharia
                      </p>
                      <p className="text-[10px] leading-relaxed font-bold uppercase opacity-60">
                        Vídeos de 30-60 segundos geram os melhores insights estruturais.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {mode === "instagram" && (
                <div className="mt-6 pt-6 border-t border-gray-50">
                  <div className="flex items-start gap-4 text-gray-400">
                    <div className="bg-gray-50 p-4 rounded-2xl text-pink-500 flex-shrink-0">
                      <Info className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-900 uppercase mb-2">
                        Como funciona
                      </p>
                      <p className="text-[10px] leading-relaxed font-bold uppercase opacity-60">
                        O vídeo é baixado, salvo no pátio digital e analisado pela IA automaticamente. Funciona com Reels públicos.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* ── COLUNA DIREITA: RESULTADO ── */}
          <div className="space-y-8">
            {resultadoAnalise ? (
              <section className="bg-white border-l-8 border-red-600 p-10 border border-gray-100 rounded-[2.5rem] shadow-sm animate-in fade-in slide-in-from-right-4 duration-500">
                <div className="flex justify-between items-start mb-10">
                  <div>
                    <h3 className="text-3xl font-black text-gray-900 tracking-tight italic uppercase">
                      {resultadoAnalise.marca} {resultadoAnalise.modelo}
                    </h3>
                    <p className="text-gray-400 font-bold text-[10px] tracking-widest uppercase mt-2">
                      {resultadoAnalise.versao} | {resultadoAnalise.ano_modelo}
                    </p>
                  </div>
                  <div className="bg-green-50 px-4 py-2 rounded-full flex items-center gap-2 flex-shrink-0">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="text-green-600 text-[10px] font-black uppercase">
                      Analisado
                    </span>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="flex justify-between border-b border-gray-50 pb-4">
                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-widest">
                      Preço Sugerido
                    </span>
                    <span className="text-red-600 font-mono font-black text-xl">
                      R${" "}
                      {resultadoAnalise.preco_sugerido
                        ? resultadoAnalise.preco_sugerido.toLocaleString("pt-BR")
                        : "0,00"}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-gray-50 pb-4">
                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-widest">
                      Quilometragem
                    </span>
                    <span className="text-gray-900 font-mono font-black text-xl">
                      {resultadoAnalise.quilometragem_estimada?.toLocaleString("pt-BR") || "0"} KM
                    </span>
                  </div>
                </div>

                <div className="mt-10">
                  <h4 className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-3">
                    <span className="w-1 h-3 bg-red-600 rounded-full" />
                    Argumentos IA
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {resultadoAnalise.pontos_fortes_venda?.map((ponto, i) => (
                      <span
                        key={i}
                        className="bg-gray-50 text-[9px] text-gray-600 px-4 py-2 rounded-xl border border-gray-100 font-bold"
                      >
                        {ponto}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-10 flex flex-col gap-4">
                  <button
                    onClick={() =>
                      resultadoAnalise.video_url &&
                      downloadVideo(
                        resultadoAnalise.video_url,
                        `GARAGE_${resultadoAnalise.modelo}.mp4`
                      )
                    }
                    className="flex items-center justify-center gap-3 px-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl hover:bg-gray-100 transition-all text-[10px] font-black text-gray-600 uppercase tracking-widest shadow-sm"
                  >
                    <Download className="w-4 h-4" />
                    Download Vídeo
                  </button>

                  <Link
                    href="/estoque"
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
                <h3 className="text-gray-400 font-black uppercase tracking-widest text-[10px]">
                  Aguardando Processamento
                </h3>
                <p className="text-gray-900 text-[10px] max-w-[250px] mt-4 font-bold uppercase tracking-widest leading-relaxed opacity-40">
                  Os resultados da IA aparecerão aqui assim que o vídeo for analisado.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
