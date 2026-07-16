"use client";

// Aba Sistema — saúde dos serviços, upload de músicas de fundo (R2) e link
// da vitrine pública. MusicasPanel movido intacto do page.tsx.

import { useRef, useState } from "react";
import { Zap, Music, ExternalLink, Loader2, CheckCircle, Upload } from "lucide-react";
import { Health, ServiceDot } from "./types";

// ─── Upload Músicas ───────────────────────────────────────────────────────────

const MUSICAS = [
  { nome: "animado", emoji: "🔥", label: "Animado" },
  { nome: "elegante", emoji: "✨", label: "Elegante" },
  { nome: "emocional", emoji: "🎬", label: "Emocional" },
] as const;

function MusicasPanel({ secret }: { secret: string }) {
  const [estados, setEstados] = useState<Record<string, "idle" | "uploading" | "done" | "error">>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function handleUpload(nome: string, file: File) {
    setEstados(e => ({ ...e, [nome]: "uploading" }));
    try {
      const res = await fetch("/api/admin/upload-musica", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ nome }),
      });
      if (!res.ok) throw new Error();
      const { signedUrl } = await res.json();
      const put = await fetch(signedUrl, { method: "PUT", body: file, headers: { "Content-Type": "audio/mpeg" } });
      if (!put.ok) throw new Error();
      setEstados(e => ({ ...e, [nome]: "done" }));
    } catch {
      setEstados(e => ({ ...e, [nome]: "error" }));
    }
  }

  return (
    <div className="flex flex-wrap gap-3">
      {MUSICAS.map(({ nome, emoji, label }) => {
        const estado = estados[nome] ?? "idle";
        return (
          <div key={nome}>
            <input ref={el => { inputRefs.current[nome] = el; }} type="file" accept=".mp3" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(nome, f); }}
            />
            <button onClick={() => inputRefs.current[nome]?.click()} disabled={estado === "uploading"}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition disabled:opacity-50 ${
                estado === "done" ? "bg-green-50 text-green-700 border border-green-200" :
                estado === "error" ? "bg-red-50 text-red-600 border border-red-200" :
                "bg-gray-900 text-white hover:bg-red-600"
              }`}>
              {estado === "uploading" ? <Loader2 size={11} className="animate-spin" /> :
               estado === "done" ? <CheckCircle size={11} /> : <Upload size={11} />}
              {emoji} {label}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Aba ──────────────────────────────────────────────────────────────────────

export default function SistemaTab({ health, secret }: { health: Health | null; secret: string }) {
  return (
    <div className="flex flex-col gap-6">

      {/* Saúde */}
      {health && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
            <Zap size={11} /> Saúde dos Serviços
          </p>
          <div className="flex flex-wrap gap-6">
            {[
              { label: "Redis",    key: "redis"    },
              { label: "Supabase", key: "supabase" },
              { label: "Avisa",    key: "avisa"    },
            ].map(({ label, key }) => {
              const s = health[key as keyof Health];
              return (
                <div key={key} className="flex items-center gap-2">
                  <ServiceDot status={s.status} />
                  <span className="text-[11px] font-black uppercase tracking-widest text-gray-700">{label}</span>
                  <span className="text-[10px] text-gray-400">{s.latency_ms}ms</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Músicas */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
          <Music size={11} /> Músicas de Fundo (R2)
        </p>
        <MusicasPanel secret={secret} />
      </div>

      {/* Link garagens */}
      <div className="bg-gray-900 rounded-2xl p-6 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Vitrine Pública</p>
          <p className="text-white font-black">autozap.digital/garagens</p>
        </div>
        <a href="/garagens" target="_blank"
          className="flex items-center gap-2 px-5 py-3 bg-red-600 text-white font-black uppercase text-[10px] tracking-widest rounded-xl hover:bg-red-700 transition">
          <ExternalLink size={13} /> Abrir
        </a>
      </div>

    </div>
  );
}
