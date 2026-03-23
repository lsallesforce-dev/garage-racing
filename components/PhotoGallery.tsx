"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { ImagePlus, Stamp } from "lucide-react";

interface PhotoGalleryProps {
  veiculoId: string;
  fotos?: string[];
  onPhotosUpdated: (newPhotos: string[]) => void;
}

// Aplica o logo no canto inferior direito via Canvas API (client-side, zero custo)
// Usa o logo salvo em localStorage ("garage_logo_url"), senão fallback para /logo.svg
function getLogoSrc(): string {
  try {
    return localStorage.getItem("garage_logo_url") || "/logo.svg";
  } catch {
    return "/logo.svg";
  }
}

async function loadImageElement(src: string): Promise<HTMLImageElement> {
  // Busca como blob para evitar bloqueio de CORS no Canvas
  let objectUrl = src;
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    objectUrl = URL.createObjectURL(blob);
  } catch {
    // fallback: tenta carregar diretamente
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = objectUrl;
  });
}

async function applyWatermark(file: File): Promise<Blob> {
  const logoSrc = getLogoSrc();
  const img = await loadImageElement(URL.createObjectURL(file));

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas não suportado");

  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  try {
    const logo = await loadImageElement(logoSrc);
    const logoW = Math.round(canvas.width * 0.2);
    const logoH = Math.round(logoW * (logo.height / (logo.width || 1)));
    const margin = Math.round(canvas.width * 0.025);
    ctx.globalAlpha = 0.82;
    ctx.drawImage(logo, canvas.width - logoW - margin, canvas.height - logoH - margin, logoW, logoH);
    ctx.globalAlpha = 1;
  } catch {
    // logo falhou — sobe foto sem marca
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Falha no canvas export"))),
      "image/jpeg",
      0.92
    )
  );
}

export const PhotoGallery = ({
  veiculoId,
  fotos = [],
  onPhotosUpdated,
}: PhotoGalleryProps) => {
  const [selectedPhoto, setSelectedPhoto] = useState(fotos[0] || "");
  const [isUploading, setIsUploading] = useState(false);
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setIsUploading(true);
    try {
      let uploadBlob: Blob = file;
      const ext = watermarkEnabled ? "jpg" : (file.name.split(".").pop() || "jpg");
      const fileName = `foto-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      if (watermarkEnabled) {
        uploadBlob = await applyWatermark(file);
      }

      const formData = new FormData();
      formData.append("file", new File([uploadBlob], fileName, { type: "image/jpeg" }));

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha no upload");

      const newPhotoUrl: string = data.videoUrl;
      const newPhotos = [...fotos, newPhotoUrl];

      const { error: dbError } = await supabase
        .from("veiculos")
        .update({ fotos: newPhotos })
        .eq("id", veiculoId);

      if (dbError) throw dbError;

      onPhotosUpdated(newPhotos);
      setSelectedPhoto(newPhotoUrl);
    } catch (error) {
      console.error("Upload error:", error);
      alert("Erro ao subir foto: " + (error instanceof Error ? error.message : "Erro desconhecido"));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeletePhoto = async (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    if (!confirm("Excluir esta foto?")) return;

    try {
      const newPhotos = fotos.filter((f) => f !== url);
      const { error } = await supabase
        .from("veiculos")
        .update({ fotos: newPhotos })
        .eq("id", veiculoId);
      if (error) throw error;

      const fileName = url.split("/").pop();
      if (fileName) {
        await supabase.storage.from("videos-estoque").remove([fileName]);
      }

      onPhotosUpdated(newPhotos);
      if (selectedPhoto === url) setSelectedPhoto(newPhotos[0] || "");
    } catch (error) {
      alert("Erro ao excluir foto");
    }
  };

  return (
    <div className="bg-[#111] p-6 rounded-3xl border border-white/5 shadow-2xl">
      {/* Header */}
      <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
        <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
          Galeria de Mídia
        </h3>

        <div className="flex items-center gap-3">
          {/* Toggle Marca d'água */}
          <button
            onClick={() => setWatermarkEnabled((v) => !v)}
            title={watermarkEnabled ? "Marca d'água ativa" : "Marca d'água desativada"}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[9px] font-black uppercase tracking-widest transition-all ${
              watermarkEnabled
                ? "border-red-600/60 text-red-500 bg-red-600/10"
                : "border-white/10 text-gray-600 hover:border-white/20"
            }`}
          >
            <Stamp size={11} />
            {watermarkEnabled ? "Marca Ativa" : "Sem Marca"}
          </button>

          {/* Botão upload */}
          <label
            className={`cursor-pointer flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full border transition-all ${
              isUploading
                ? "border-slate-800 text-slate-600 cursor-wait"
                : "border-red-600/50 text-red-500 hover:bg-red-600/10"
            }`}
          >
            {isUploading ? (
              <>
                <div className="w-3 h-3 border-2 border-red-600/40 border-t-red-500 rounded-full animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <ImagePlus size={12} />
                Adicionar Foto
              </>
            )}
            <input
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
              disabled={isUploading}
            />
          </label>
        </div>
      </div>

      {/* Foto principal */}
      <div className="w-full h-80 rounded-2xl border-4 border-red-600/30 overflow-hidden mb-4 relative bg-[#0a0a0a]">
        {fotos.length > 0 ? (
          <img
            src={selectedPhoto || fotos[0]}
            alt="Destaque"
            className="w-full h-full object-cover hover:scale-105 transition-transform duration-500 cursor-zoom-in"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4 text-gray-700">
              <ImagePlus size={28} />
            </div>
            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">
              Sem fotos no pátio
            </p>
            <p className="text-[9px] text-gray-700 uppercase font-bold max-w-[160px]">
              Clique em "Adicionar Foto" para iniciar a vitrine
            </p>
          </div>
        )}

        {isUploading && (
          <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
            {watermarkEnabled && (
              <p className="text-[9px] font-black text-red-500 uppercase tracking-widest">
                Aplicando marca d'água...
              </p>
            )}
          </div>
        )}
      </div>

      {/* Miniaturas */}
      <div className="grid grid-cols-5 gap-3">
        {fotos.map((foto, i) => (
          <div key={i} className="relative group/thumb">
            <button
              onClick={() => setSelectedPhoto(foto)}
              className={`w-full h-16 rounded-xl overflow-hidden border-2 transition-all ${
                selectedPhoto === foto
                  ? "border-red-600"
                  : "border-white/10 hover:border-red-600/50"
              }`}
            >
              <img
                src={foto}
                alt={`Miniatura ${i + 1}`}
                className="w-full h-full object-cover"
              />
            </button>
            <button
              onClick={(e) => handleDeletePhoto(e, foto)}
              className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center text-[9px] font-bold opacity-0 group-hover/thumb:opacity-100 transition-opacity hover:bg-red-700 shadow-lg z-10"
            >
              ✕
            </button>
          </div>
        ))}
        {fotos.length === 0 && (
          <div className="col-span-5 h-16 border-2 border-dashed border-white/5 rounded-xl flex items-center justify-center text-[10px] text-gray-600 font-bold uppercase tracking-widest">
            Nenhuma foto cadastrada
          </div>
        )}
      </div>
    </div>
  );
};
