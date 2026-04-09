"use client";

import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { ImagePlus, Stamp, GripVertical } from "lucide-react";

interface PhotoGalleryProps {
  veiculoId: string;
  fotos?: string[];
  logoUrl?: string | null;
  onPhotosUpdated: (newPhotos: string[]) => void;
}

const OUTPUT_W = 1280;
const OUTPUT_H = 720;

async function loadImageElement(src: string): Promise<HTMLImageElement> {
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

async function applyWatermark(file: File, logoUrl: string | null | undefined): Promise<Blob> {
  const img = await loadImageElement(URL.createObjectURL(file));

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas não suportado");

  canvas.width = OUTPUT_W;
  canvas.height = OUTPUT_H;

  const scale = Math.max(OUTPUT_W / img.width, OUTPUT_H / img.height);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const offsetX = (OUTPUT_W - drawW) / 2;
  const offsetY = (OUTPUT_H - drawH) / 2;
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

  if (logoUrl) {
    try {
      const logo = await loadImageElement(logoUrl);
      const logoW = Math.round(OUTPUT_W * 0.2);
      const logoH = Math.round(logoW * (logo.height / (logo.width || 1)));
      const margin = Math.round(OUTPUT_W * 0.025);
      ctx.globalAlpha = 0.82;
      ctx.drawImage(logo, OUTPUT_W - logoW - margin, OUTPUT_H - logoH - margin, logoW, logoH);
      ctx.globalAlpha = 1;
    } catch {
      // logo falhou — sobe foto sem marca
    }
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
  logoUrl,
  onPhotosUpdated,
}: PhotoGalleryProps) => {
  const [selectedPhoto, setSelectedPhoto] = useState(fotos[0] || "");
  const [uploadingCount, setUploadingCount] = useState(0);
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);

  // Drag and drop state
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const isUploading = uploadingCount > 0;

  async function uploadSingleFile(file: File): Promise<string> {
    const ext = watermarkEnabled ? "jpg" : (file.name.split(".").pop() || "jpg");
    const fileName = `foto-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const uploadBlob: Blob = watermarkEnabled ? await applyWatermark(file, logoUrl) : file;

    const metaRes = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName, fileType: "image/jpeg" }),
    });
    const metaData = await metaRes.json();
    if (!metaRes.ok || !metaData.signedUrl) throw new Error(metaData.error || "Falha ao obter URL");

    const uploadRes = await fetch(metaData.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: uploadBlob,
    });
    if (!uploadRes.ok) throw new Error("Falha no upload");

    return metaData.publicUrl as string;
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    e.target.value = "";

    setUploadingCount(files.length);

    const newUrls: string[] = [];
    for (const file of files) {
      try {
        const url = await uploadSingleFile(file);
        newUrls.push(url);
        setUploadingCount((c) => c - 1);
      } catch (err) {
        console.error("Erro ao subir foto:", err);
        setUploadingCount((c) => c - 1);
      }
    }

    if (newUrls.length === 0) return;

    const newPhotos = [...fotos, ...newUrls];
    const { error } = await supabase.from("veiculos").update({ fotos: newPhotos }).eq("id", veiculoId);
    if (error) { alert("Erro ao salvar fotos"); return; }

    onPhotosUpdated(newPhotos);
    if (!selectedPhoto) setSelectedPhoto(newUrls[0]);
  };

  const handleDeletePhoto = async (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    if (!confirm("Excluir esta foto?")) return;

    const newPhotos = fotos.filter((f) => f !== url);
    const { error } = await supabase.from("veiculos").update({ fotos: newPhotos }).eq("id", veiculoId);
    if (error) { alert("Erro ao excluir foto"); return; }

    const fileName = url.split("/").pop();
    if (fileName) await supabase.storage.from("videos-estoque").remove([fileName]);

    onPhotosUpdated(newPhotos);
    if (selectedPhoto === url) setSelectedPhoto(newPhotos[0] || "");
  };

  // ── Drag and drop reordering ──────────────────────────────────────────────

  const handleDragStart = (i: number) => {
    dragIndex.current = i;
  };

  const handleDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    setDragOverIndex(i);
  };

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    setDragOverIndex(null);
    if (dragIndex.current === null || dragIndex.current === dropIndex) return;

    const reordered = [...fotos];
    const [moved] = reordered.splice(dragIndex.current, 1);
    reordered.splice(dropIndex, 0, moved);
    dragIndex.current = null;

    onPhotosUpdated(reordered);
    setSelectedPhoto(reordered[0]);

    await supabase.from("veiculos").update({ fotos: reordered }).eq("id", veiculoId);
  };

  const handleDragEnd = () => {
    dragIndex.current = null;
    setDragOverIndex(null);
  };

  return (
    <div className="bg-[#e2e2de] p-6 rounded-3xl border border-gray-200/50">
      {/* Header */}
      <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
        <div>
          <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
            Galeria de Mídia
          </h3>
          {fotos.length > 0 && (
            <p className="text-[9px] text-gray-400 mt-0.5">
              Arraste as miniaturas para reordenar · A primeira é a capa
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setWatermarkEnabled((v) => !v)}
            title={watermarkEnabled ? "Marca d'água ativa" : "Marca d'água desativada"}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[9px] font-black uppercase tracking-widest transition-all ${
              watermarkEnabled
                ? "border-red-600/60 text-red-500 bg-red-50"
                : "border-gray-200 text-gray-400 hover:border-gray-300"
            }`}
          >
            <Stamp size={11} />
            {watermarkEnabled ? "Marca Ativa" : "Sem Marca"}
          </button>

          <label
            className={`cursor-pointer flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full border transition-all ${
              isUploading
                ? "border-gray-200 text-gray-400 cursor-wait"
                : "border-red-600/50 text-red-500 hover:bg-red-50"
            }`}
          >
            {isUploading ? (
              <>
                <div className="w-3 h-3 border-2 border-red-600/40 border-t-red-500 rounded-full animate-spin" />
                {uploadingCount > 1 ? `${uploadingCount} restantes...` : "Processando..."}
              </>
            ) : (
              <>
                <ImagePlus size={12} />
                Adicionar Fotos
              </>
            )}
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileUpload}
              className="hidden"
              disabled={isUploading}
            />
          </label>
        </div>
      </div>

      {/* Foto principal */}
      <div className="w-full h-80 rounded-2xl border-2 border-black/10 overflow-hidden mb-4 relative bg-[#d4d4d0]">
        {fotos.length > 0 ? (
          <img
            src={selectedPhoto || fotos[0]}
            alt="Destaque"
            className="w-full h-full object-cover hover:scale-105 transition-transform duration-500 cursor-zoom-in"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-gray-300">
              <ImagePlus size={28} />
            </div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">
              Sem fotos no pátio
            </p>
            <p className="text-[9px] text-gray-300 uppercase font-bold max-w-[160px]">
              Clique em "Adicionar Fotos" para iniciar a vitrine
            </p>
          </div>
        )}

        {isUploading && (
          <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-[9px] font-black text-white uppercase tracking-widest">
              {watermarkEnabled ? "Aplicando marca d'água..." : "Enviando..."}
              {uploadingCount > 1 ? ` (${uploadingCount} restantes)` : ""}
            </p>
          </div>
        )}
      </div>

      {/* Miniaturas com drag-and-drop */}
      <div className="grid grid-cols-5 gap-3">
        {fotos.map((foto, i) => (
          <div
            key={foto}
            draggable
            onDragStart={() => handleDragStart(i)}
            onDragOver={(e) => handleDragOver(e, i)}
            onDrop={(e) => handleDrop(e, i)}
            onDragEnd={handleDragEnd}
            className={`relative group/thumb transition-all ${
              dragOverIndex === i ? "scale-105 opacity-70" : ""
            }`}
          >
            {/* Badge CAPA na primeira foto */}
            {i === 0 && (
              <span className="absolute -top-1 -left-1 z-10 bg-red-600 text-white text-[7px] font-black uppercase px-1.5 py-0.5 rounded-full shadow">
                Capa
              </span>
            )}

            {/* Ícone de drag */}
            <div className="absolute top-1 left-1 z-10 opacity-0 group-hover/thumb:opacity-80 transition-opacity cursor-grab">
              <GripVertical size={12} className="text-white drop-shadow" />
            </div>

            <button
              onClick={() => setSelectedPhoto(foto)}
              className={`w-full h-16 rounded-xl overflow-hidden border-2 transition-all ${
                selectedPhoto === foto
                  ? "border-red-600"
                  : "border-gray-100 hover:border-red-400"
              }`}
            >
              <img
                src={foto}
                alt={`Miniatura ${i + 1}`}
                className="w-full h-full object-cover pointer-events-none"
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
          <div className="col-span-5 h-16 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center text-[10px] text-gray-300 font-bold uppercase tracking-widest">
            Nenhuma foto cadastrada
          </div>
        )}
      </div>
    </div>
  );
};
