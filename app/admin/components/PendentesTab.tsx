"use client";

// Aba Pendentes — cadastros aguardando aprovação manual do admin.
// Comportamento movido intacto do page.tsx na reforma de UX.

import { useState } from "react";
import { Loader2, RefreshCw, CheckCircle } from "lucide-react";
import { Pendente } from "./types";

export default function PendentesTab({ pendentes, secret, onReload }: {
  pendentes: Pendente[];
  secret: string;
  onReload: () => void;
}) {
  const [aprovando, setAprovando] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">Cadastros Aguardando Aprovação</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">{pendentes.length} pendente{pendentes.length !== 1 ? "s" : ""}</p>
          </div>
          <button onClick={onReload}
            className="p-2 text-gray-400 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition">
            <RefreshCw size={15} />
          </button>
        </div>

        {pendentes.length === 0 ? (
          <div className="text-center py-12 text-gray-300 text-sm font-black uppercase tracking-widest">
            Nenhum cadastro pendente
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {pendentes.map(p => (
              <div key={p.user_id} className="flex items-center justify-between gap-4 p-4 bg-amber-50 border border-amber-100 rounded-2xl">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-gray-900 truncate">{p.nome_empresa || "Sem nome"}</p>
                  <p className="text-[11px] text-gray-500 truncate">{p.email}</p>
                  {p.whatsapp && (
                    <a href={`https://wa.me/55${p.whatsapp.replace(/\D/g,"")}`} target="_blank" rel="noreferrer"
                      className="text-[10px] text-green-600 font-bold hover:underline">
                      📱 {p.whatsapp}
                    </a>
                  )}
                  <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                    Cadastrado em {new Date(p.created_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <button
                  disabled={aprovando === p.user_id}
                  onClick={async () => {
                    setAprovando(p.user_id);
                    try {
                      const res = await fetch("/api/admin/aprovar", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
                        body: JSON.stringify({ user_id: p.user_id }),
                      });
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        alert(`Erro ao aprovar: ${err.error ?? res.status}`);
                      }
                    } catch (e) {
                      alert("Erro de rede ao aprovar");
                    } finally {
                      setAprovando(null);
                      onReload();
                    }
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors shrink-0">
                  {aprovando === p.user_id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                  Aprovar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
