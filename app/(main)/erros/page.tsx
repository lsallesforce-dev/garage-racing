"use client";

import { useEffect, useState } from "react";
import { AlertCircle, RefreshCcw, Trash2, ChevronLeft, ChevronRight } from "lucide-react";

interface ErroWebhook {
  id: string;
  tenant_user_id: string;
  phone: string | null;
  message_id: string | null;
  etapa: string;
  erro: string;
  created_at: string;
}

const ETAPA_COR: Record<string, string> = {
  gemini:        "bg-purple-100 text-purple-700",
  processamento: "bg-red-100 text-red-700",
  avisa_send:    "bg-orange-100 text-orange-700",
  embedding:     "bg-blue-100 text-blue-700",
};

function etapaCor(etapa: string) {
  return ETAPA_COR[etapa] ?? "bg-gray-100 text-gray-600";
}

export default function ErrosPage() {
  const [erros, setErros] = useState<ErroWebhook[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [limpando, setLimpando] = useState(false);
  const PAGE_SIZE = 50;

  async function carregar(p = 0) {
    setLoading(true);
    try {
      const res = await fetch(`/api/erros?page=${p}`);
      const json = await res.json();
      setErros(json.erros ?? []);
      setTotal(json.total ?? 0);
      setPage(p);
    } finally {
      setLoading(false);
    }
  }

  async function limparTodos() {
    if (!confirm("Apagar todos os erros registrados? Esta ação não pode ser desfeita.")) return;
    setLimpando(true);
    await fetch("/api/erros", { method: "DELETE" });
    await carregar(0);
    setLimpando(false);
  }

  useEffect(() => { carregar(0); }, []);

  const totalPaginas = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 max-w-5xl mx-auto flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black uppercase tracking-tight text-gray-900 flex items-center gap-2">
            <AlertCircle size={18} className="text-red-500" /> Log de Erros
          </h1>
          <p className="text-[11px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
            Falhas no pipeline de mensagens WhatsApp
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => carregar(page)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-black uppercase tracking-widest bg-gray-100 hover:bg-gray-200 rounded-xl transition-all text-gray-600 disabled:opacity-50"
          >
            <RefreshCcw size={12} className={loading ? "animate-spin" : ""} /> Atualizar
          </button>
          {total > 0 && (
            <button
              onClick={limparTodos}
              disabled={limpando}
              className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-black uppercase tracking-widest bg-red-50 hover:bg-red-100 rounded-xl transition-all text-red-600 disabled:opacity-50"
            >
              <Trash2 size={12} /> Limpar tudo
            </button>
          )}
        </div>
      </div>

      {/* Contador */}
      <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
        {total === 0 ? "Nenhum erro registrado" : `${total} erro${total !== 1 ? "s" : ""} no total`}
      </div>

      {/* Tabela */}
      {erros.length === 0 && !loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-300">
          <AlertCircle size={40} />
          <p className="text-sm font-bold uppercase tracking-widest">Tudo limpo por aqui</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {erros.map((e) => (
            <div key={e.id} className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col gap-2 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${etapaCor(e.etapa)}`}>
                    {e.etapa}
                  </span>
                  {e.phone && (
                    <span className="text-[10px] font-bold text-gray-500">📱 {e.phone}</span>
                  )}
                </div>
                <span className="text-[9px] font-bold text-gray-300 whitespace-nowrap">
                  {new Date(e.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </div>
              <pre className="text-[10px] text-gray-600 bg-gray-50 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed max-h-32">
                {e.erro}
              </pre>
              {e.message_id && (
                <span className="text-[9px] text-gray-300 font-mono">msg_id: {e.message_id}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Paginação */}
      {totalPaginas > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => carregar(page - 1)}
            disabled={page === 0}
            className="p-2 rounded-xl bg-gray-100 hover:bg-gray-200 transition-all disabled:opacity-30"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
            {page + 1} / {totalPaginas}
          </span>
          <button
            onClick={() => carregar(page + 1)}
            disabled={page >= totalPaginas - 1}
            className="p-2 rounded-xl bg-gray-100 hover:bg-gray-200 transition-all disabled:opacity-30"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
