"use client";

import { useState, useRef } from "react";
import { Upload, CheckCircle2, Loader2, ImageIcon, Trash2, Sparkles, FileImage } from "lucide-react";

type Mode = "auto" | "manual";

export default function ConfiguracoesPage() {
  const [mode, setMode] = useState<Mode>("manual");
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [originalPreview, setOriginalPreview] = useState<string | null>(null);
  const [processedPreview, setProcessedPreview] = useState<string | null>(null);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [currentLogo, setCurrentLogo] = useState<string | null>(
    typeof window !== "undefined" ? localStorage.getItem("garage_logo_url") : null
  );
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setOriginalFile(null);
    setOriginalPreview(null);
    setProcessedPreview(null);
    setProcessedBlob(null);
    setSaved(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    reset();

    const previewUrl = URL.createObjectURL(file);
    setOriginalFile(file);
    setOriginalPreview(previewUrl);
    setSaved(false);

    if (mode === "manual") {
      // Usa o arquivo original direto
      const blob = new Blob([await file.arrayBuffer()], { type: file.type });
      setProcessedPreview(previewUrl);
      setProcessedBlob(blob);
      return;
    }

    // mode === "auto": remove fundo
    setProcessing(true);
    try {
      const { removeBackground } = await import("@imgly/background-removal");
      const blob = await removeBackground(file, { model: "medium" });
      setProcessedPreview(URL.createObjectURL(blob));
      setProcessedBlob(blob);
    } catch (err) {
      console.error("Erro ao remover fundo:", err);
      const blob = new Blob([await file.arrayBuffer()], { type: file.type });
      setProcessedPreview(previewUrl);
      setProcessedBlob(blob);
    } finally {
      setProcessing(false);
    }
  };

  const handleModeChange = async (newMode: Mode) => {
    setMode(newMode);
    if (!originalFile) return;

    setSaved(false);
    setProcessedPreview(null);
    setProcessedBlob(null);

    if (newMode === "manual") {
      const blob = new Blob([await originalFile.arrayBuffer()], { type: originalFile.type });
      setProcessedPreview(URL.createObjectURL(blob));
      setProcessedBlob(blob);
      return;
    }

    setProcessing(true);
    try {
      const { removeBackground } = await import("@imgly/background-removal");
      const blob = await removeBackground(originalFile, { model: "medium" });
      setProcessedPreview(URL.createObjectURL(blob));
      setProcessedBlob(blob);
    } catch (err) {
      const blob = new Blob([await originalFile.arrayBuffer()], { type: originalFile.type });
      setProcessedPreview(URL.createObjectURL(blob));
      setProcessedBlob(blob);
    } finally {
      setProcessing(false);
    }
  };

  const handleSave = async () => {
    if (!processedBlob) return;
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("file", new File([processedBlob], "logo.png", { type: "image/png" }));

      const res = await fetch("/api/configuracoes/logo", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha no upload");

      const url = `${data.url}?t=${Date.now()}`;
      localStorage.setItem("garage_logo_url", url);
      setCurrentLogo(url);
      setSaved(true);
    } catch (err: any) {
      alert("Erro ao salvar logo: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveLogo = () => {
    if (!confirm("Remover logo atual? As próximas fotos serão enviadas sem marca.")) return;
    localStorage.removeItem("garage_logo_url");
    setCurrentLogo(null);
    reset();
  };

  return (
    <main className="flex-1 p-10 bg-[#efefed] min-h-screen">
      <header className="mb-10 pb-6 border-b border-gray-200">
        <h1 className="text-4xl font-black uppercase tracking-tighter italic text-gray-900">
          Configurações
        </h1>
        <p className="text-gray-400 uppercase tracking-widest text-[10px] font-bold mt-1">
          Garage Racing • Personalização do Pátio
        </p>
      </header>

      <div className="max-w-2xl">
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-1">
            Logo da Garagem
          </h2>
          <p className="text-[11px] text-gray-500 mb-6">
            Aplicada automaticamente como marca d'água em todas as fotos do estoque.
          </p>

          {/* Logo atual */}
          {currentLogo && !originalPreview && (
            <div className="mb-6 p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-center gap-4">
              <div className="w-24 h-16 flex items-center justify-center bg-gray-200 rounded-xl overflow-hidden">
                <img src={currentLogo} alt="Logo atual" className="max-w-full max-h-full object-contain" />
              </div>
              <div className="flex-1">
                <p className="text-[11px] font-black text-gray-700 uppercase tracking-wide">Logo ativa</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Sendo aplicada nas novas fotos</p>
              </div>
              <button
                onClick={handleRemoveLogo}
                className="text-gray-400 hover:text-red-500 transition-colors p-2 rounded-xl hover:bg-red-50"
              >
                <Trash2 size={16} />
              </button>
            </div>
          )}

          {/* Seletor de modo */}
          <div className="flex gap-3 mb-6">
            <button
              type="button"
              onClick={() => handleModeChange("manual")}
              className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-2xl border-2 text-left transition-all ${
                mode === "manual"
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-200 text-gray-500 hover:border-gray-300"
              }`}
            >
              <FileImage size={16} />
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest">PNG com fundo transparente</p>
                <p className={`text-[9px] mt-0.5 ${mode === "manual" ? "text-gray-400" : "text-gray-400"}`}>
                  Melhor qualidade — recomendado
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleModeChange("auto")}
              className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-2xl border-2 text-left transition-all ${
                mode === "auto"
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-200 text-gray-500 hover:border-gray-300"
              }`}
            >
              <Sparkles size={16} />
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest">Remover fundo automático</p>
                <p className="text-[9px] text-gray-400 mt-0.5">
                  Funciona com JPG/PNG — qualidade variável
                </p>
              </div>
            </button>
          </div>

          {/* Dica de tamanho (modo manual) */}
          {mode === "manual" && (
            <div className="mb-5 px-4 py-3 bg-blue-50 border border-blue-100 rounded-2xl">
              <p className="text-[10px] font-black text-blue-700 uppercase tracking-widest mb-1">
                Especificações recomendadas
              </p>
              <ul className="text-[10px] text-blue-600 space-y-0.5">
                <li>• Formato: <strong>PNG com fundo transparente</strong></li>
                <li>• Tamanho: <strong>mínimo 600 × 300 px</strong> (proporcional horizontal)</li>
                <li>• Resolução: <strong>72–150 dpi</strong> é suficiente</li>
                <li>• Fundo branco vai aparecer sobre as fotos — use transparente</li>
              </ul>
            </div>
          )}

          {/* Upload area */}
          <label className="block cursor-pointer">
            <div className="border-2 border-dashed border-gray-200 rounded-2xl p-8 flex flex-col items-center gap-3 hover:border-red-400 hover:bg-red-50/30 transition-all">
              <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                <Upload size={20} className="text-gray-400" />
              </div>
              <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">
                {currentLogo ? "Trocar logo" : "Enviar logo"}
              </p>
              <p className="text-[10px] text-gray-400 text-center">
                {mode === "manual" ? "PNG com fundo transparente" : "PNG ou JPG • fundo removido automaticamente"}
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
            />
          </label>

          {/* Preview */}
          {(originalPreview || processing) && (
            <div className="mt-6 grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Original</p>
                <div className="h-36 bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-center overflow-hidden">
                  {originalPreview
                    ? <img src={originalPreview} alt="Original" className="max-w-full max-h-full object-contain p-2" />
                    : <ImageIcon size={24} className="text-gray-300" />}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                  {mode === "auto" ? "Sem fundo" : "Logo final"}
                </p>
                <div className="h-36 bg-[repeating-conic-gradient(#e5e7eb_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] rounded-xl border border-gray-100 flex items-center justify-center overflow-hidden">
                  {processing ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 size={20} className="text-red-500 animate-spin" />
                      <p className="text-[9px] font-black uppercase text-gray-400">Removendo fundo...</p>
                    </div>
                  ) : processedPreview ? (
                    <img src={processedPreview} alt="Resultado" className="max-w-full max-h-full object-contain p-2" />
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* Prévia da marca d'água na foto */}
          {processedPreview && !processing && (
            <div className="mt-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Prévia na foto</p>
              <div className="relative h-40 bg-gray-800 rounded-xl overflow-hidden border border-gray-200">
                <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-[10px] font-bold uppercase tracking-widest">
                  [foto do veículo]
                </div>
                <img
                  src={processedPreview}
                  alt="Preview watermark"
                  className="absolute bottom-3 right-3 opacity-85"
                  style={{ width: "20%", maxWidth: 120 }}
                />
              </div>
            </div>
          )}

          {/* Botão salvar */}
          {processedBlob && !processing && (
            <button
              onClick={handleSave}
              disabled={saving || saved}
              className={`mt-6 w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest transition-all flex items-center justify-center gap-2 ${
                saved ? "bg-green-500 text-white" : "bg-gray-900 text-white hover:bg-red-600"
              }`}
            >
              {saving ? (
                <><Loader2 size={16} className="animate-spin" /> Salvando...</>
              ) : saved ? (
                <><CheckCircle2 size={16} /> Logo salva com sucesso!</>
              ) : (
                "Salvar logo"
              )}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
