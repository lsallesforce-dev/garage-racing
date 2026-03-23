"use client";

import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Upload, CheckCircle2, Loader2, ImageIcon, Trash2 } from "lucide-react";

export default function ConfiguracoesPage() {
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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setOriginalPreview(URL.createObjectURL(file));
    setProcessedPreview(null);
    setProcessedBlob(null);
    setSaved(false);
    setProcessing(true);

    try {
      const { removeBackground } = await import("@imgly/background-removal");
      const blob = await removeBackground(file);
      const url = URL.createObjectURL(blob);
      setProcessedPreview(url);
      setProcessedBlob(blob);
    } catch (err) {
      console.error("Erro ao remover fundo:", err);
      // fallback: usa a imagem original sem remoção de fundo
      const blob = new Blob([await file.arrayBuffer()], { type: file.type });
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
      const fileName = `logo.png`;
      const { error } = await supabase.storage
        .from("configuracoes")
        .upload(fileName, processedBlob, { upsert: true, contentType: "image/png" });

      if (error) throw error;

      const { data } = supabase.storage.from("configuracoes").getPublicUrl(fileName);
      const url = `${data.publicUrl}?t=${Date.now()}`;
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
    setOriginalPreview(null);
    setProcessedPreview(null);
    setProcessedBlob(null);
    setSaved(false);
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
        {/* Card Logo */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-1">
            Logo da Garagem
          </h2>
          <p className="text-[11px] text-gray-500 mb-6">
            Será aplicado automaticamente como marca d'água em todas as fotos do estoque.
            O fundo é removido automaticamente.
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
                title="Remover logo"
              >
                <Trash2 size={16} />
              </button>
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
                PNG, JPG ou SVG • Fundo removido automaticamente
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

          {/* Preview antes/depois */}
          {(originalPreview || processing) && (
            <div className="mt-6 grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Original</p>
                <div className="h-36 bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-center overflow-hidden">
                  {originalPreview ? (
                    <img src={originalPreview} alt="Original" className="max-w-full max-h-full object-contain p-2" />
                  ) : (
                    <ImageIcon size={24} className="text-gray-300" />
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Sem fundo</p>
                <div className="h-36 bg-[repeating-conic-gradient(#e5e7eb_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] rounded-xl border border-gray-100 flex items-center justify-center overflow-hidden">
                  {processing ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 size={20} className="text-red-500 animate-spin" />
                      <p className="text-[9px] font-black uppercase text-gray-400">Removendo fundo...</p>
                    </div>
                  ) : processedPreview ? (
                    <img src={processedPreview} alt="Sem fundo" className="max-w-full max-h-full object-contain p-2" />
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* Prévia da marca d'água */}
          {processedPreview && !processing && (
            <div className="mt-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">
                Prévia na foto
              </p>
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
                saved
                  ? "bg-green-500 text-white"
                  : "bg-gray-900 text-white hover:bg-red-600"
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
