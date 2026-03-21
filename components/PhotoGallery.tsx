import { useState } from "react";
import { supabase } from "@/lib/supabase";

interface PhotoGalleryProps {
  veiculoId: string;
  fotos?: string[];
  onPhotosUpdated: (newPhotos: string[]) => void;
}

export const PhotoGallery = ({ veiculoId, fotos = [], onPhotosUpdated }: PhotoGalleryProps) => {
  const [selectedPhoto, setSelectedPhoto] = useState(fotos[0] || "/placeholder-car.jpg");
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed");

      const newPhotoUrl = data.videoUrl; // O proxy retorna videoUrl para qualquer upload
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
    if (!confirm("Tem certeza que deseja excluir esta foto? 🗑️")) return;

    try {
      const newPhotos = fotos.filter(f => f !== url);
      
      const { error: dbError } = await supabase
        .from("veiculos")
        .update({ fotos: newPhotos })
        .eq("id", veiculoId);

      if (dbError) throw dbError;

      // Limpeza opcional do Storage (best effort)
      const fileName = url.split('/').pop();
      if (fileName) {
        await supabase.storage.from('videos-estoque').remove([fileName]);
      }

      onPhotosUpdated(newPhotos);
      if (selectedPhoto === url) {
        setSelectedPhoto(newPhotos[0] || "/placeholder-car.jpg");
      }
    } catch (error) {
      console.error("Delete error:", error);
      alert("Erro ao excluir foto");
    }
  };

  return (
    <div className="bg-[#111] p-6 rounded-3xl border border-white/5 shadow-2xl">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Galeria de Mídia</h3>
        <label className={`cursor-pointer text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full border transition-all ${
          isUploading ? "border-slate-800 text-slate-600 cursor-wait" : "border-red-600/50 text-red-500 hover:bg-red-600/10"
        }`}>
          {isUploading ? "Subindo..." : "+ Adicionar Fotos"}
          <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" disabled={isUploading} />
        </label>
      </div>
      
      {/* Foto Principal (Destaque) */}
      <div className="w-full h-80 rounded-2xl border-4 border-red-600/30 overflow-hidden mb-4 group cursor-zoom-in relative bg-[#0a0a0a]">
        {fotos.length > 0 ? (
          <img 
            src={selectedPhoto} 
            alt="Destaque Veículo" 
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-center p-8">
             <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4 text-gray-700">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
             </div>
             <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Sem Fotos no Pátio</p>
             <p className="text-[9px] text-gray-700 uppercase font-bold max-w-[150px]">Toque em "Adicionar Fotos" para iniciar a vitrine</p>
          </div>
        )}
        
        {isUploading && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-red-600 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
      </div>

      {/* Miniaturas (Thumbnails) */}
      <div className="grid grid-cols-5 gap-3">
        {fotos.map((foto, i) => (
          <div key={i} className="relative group/thumb">
            <button 
              onClick={() => setSelectedPhoto(foto)}
              className={`w-full h-16 rounded-xl overflow-hidden border-2 transition-all ${
                selectedPhoto === foto ? 'border-red-600' : 'border-white/10'
              } hover:border-red-600/50`}
            >
              <img src={foto} alt={`Miniatura ${i + 1}`} className="w-full h-full object-cover" />
            </button>
            <button 
              onClick={(e) => handleDeletePhoto(e, foto)}
              className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold opacity-0 group-hover/thumb:opacity-100 transition-opacity hover:bg-red-700 shadow-lg z-10"
              title="Excluir Foto"
            >
              ✕
            </button>
          </div>
        ))}
        {fotos.length === 0 && !isUploading && (
          <div className="col-span-5 h-16 border-2 border-dashed border-white/5 rounded-xl flex items-center justify-center text-[10px] text-gray-600 font-bold uppercase tracking-widest">
            Nenhuma foto cadastrada
          </div>
        )}
      </div>
    </div>
  );
};
