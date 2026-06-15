"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Upload, Loader2, Trash2, Download } from "lucide-react";

interface Doc {
  id: string;
  nome: string;
  tamanho: number;
  enviado_em: string;
  url: string | null;
}

function fmtTamanho(b: number): string {
  return b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}

export function ArquivarDocumentos({ veiculoId }: { veiculoId: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch(`/api/veiculo/${veiculoId}/documentos`);
      const data = await res.json();
      if (res.ok) setDocs(data.documentos ?? []);
    } catch {
      /* silencioso — o card só não lista */
    } finally {
      setLoading(false);
    }
  }, [veiculoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const enviar = async (files: FileList) => {
    setErro(null);
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("files", f));
      const res = await fetch(`/api/veiculo/${veiculoId}/documentos`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Falha no upload");
        return;
      }
      await carregar();
    } catch {
      setErro("Falha de rede no upload");
    } finally {
      setUploading(false);
    }
  };

  const remover = async (docId: string) => {
    if (!confirm("Remover este documento? Esta ação não pode ser desfeita.")) return;
    const res = await fetch(`/api/veiculo/${veiculoId}/documentos`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId }),
    });
    if (res.ok) setDocs((prev) => prev.filter((d) => d.id !== docId));
  };

  return (
    <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-gray-900 flex items-center justify-center">
          <FileText size={18} className="text-white" />
        </div>
        <div>
          <h3 className="text-sm font-black uppercase italic tracking-tight text-gray-900">Arquivar Documentos</h3>
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">PDFs do veículo — guardados com segurança</p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) enviar(e.target.files);
          e.target.value = "";
        }}
      />

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-xs font-bold py-4 justify-center">
          <Loader2 size={14} className="animate-spin" /> Carregando...
        </div>
      ) : docs.length > 0 ? (
        <div className="space-y-2 mb-3">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-2xl">
              <div className="w-9 h-9 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <span className="text-[9px] font-black text-red-600">PDF</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-gray-900 truncate">{d.nome}</p>
                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">{fmtTamanho(d.tamanho)}</p>
              </div>
              {d.url && (
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 hover:bg-gray-200 rounded-xl transition-colors"
                  title="Abrir / baixar"
                >
                  <Download size={14} className="text-gray-500" />
                </a>
              )}
              <button
                onClick={() => remover(d.id)}
                className="p-2 hover:bg-red-50 rounded-xl transition-colors group"
                title="Remover"
              >
                <Trash2 size={14} className="text-gray-400 group-hover:text-red-500" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-full py-4 border-2 border-dashed border-gray-200 hover:border-gray-900 rounded-2xl flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-900 transition-all disabled:opacity-40"
      >
        {uploading ? (
          <>
            <Loader2 size={15} className="animate-spin text-red-500" /> Enviando...
          </>
        ) : (
          <>
            <Upload size={15} /> Enviar PDF
          </>
        )}
      </button>

      {erro && <p className="mt-3 text-xs font-bold text-red-600">{erro}</p>}
    </div>
  );
}
