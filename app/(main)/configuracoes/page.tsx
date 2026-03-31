"use client";

import { useState, useRef, useEffect } from "react";
import { Upload, CheckCircle2, Loader2, ImageIcon, Trash2, Sparkles, FileImage, Save } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Mode = "auto" | "manual";

interface GarageConfig {
  id?: string;
  nome_empresa: string;
  nome_agente: string;
  endereco: string;
  whatsapp: string;
  logo_url: string | null;
  webhook_token?: string;
  nome_usuario?: string;
  cargo_usuario?: string;
}

export default function ConfiguracoesPage() {
  const [mode, setMode] = useState<Mode>("manual");
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [originalPreview, setOriginalPreview] = useState<string | null>(null);
  const [processedPreview, setProcessedPreview] = useState<string | null>(null);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [savedInfo, setSavedInfo] = useState(false);
  const [currentLogo, setCurrentLogo] = useState<string | null>(null);
  const [config, setConfig] = useState<GarageConfig>({
    nome_empresa: "",
    nome_agente: "",
    endereco: "",
    whatsapp: "",
    logo_url: null,
    webhook_token: "",
    nome_usuario: "",
    cargo_usuario: "",
  });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("config_garage")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ data, error }) => {
          if (error) console.error("❌ config_garage load error:", error);
          const row = data?.[0];
          if (row) {
            setConfig({
              id: row.id,
              nome_empresa: row.nome_empresa ?? "",
              nome_agente: row.nome_agente ?? "",
              endereco: row.endereco ?? "",
              whatsapp: row.whatsapp ?? "",
              logo_url: row.logo_url ?? null,
              webhook_token: row.webhook_token ?? "",
              nome_usuario: row.nome_usuario ?? "",
              cargo_usuario: row.cargo_usuario ?? "",
            });
            if (row.logo_url) {
              setCurrentLogo(row.logo_url);
              localStorage.setItem("garage_logo_url", row.logo_url);
            }
          }
        });
    });
  }, []);

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
      const blob = new Blob([await file.arrayBuffer()], { type: file.type });
      setProcessedPreview(previewUrl);
      setProcessedBlob(blob);
      return;
    }
    setProcessing(true);
    try {
      const { removeBackground } = await import("@imgly/background-removal");
      const blob = await removeBackground(file, { model: "isnet_fp16" });
      setProcessedPreview(URL.createObjectURL(blob));
      setProcessedBlob(blob);
    } catch {
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
      const blob = await removeBackground(originalFile, { model: "isnet_fp16" });
      setProcessedPreview(URL.createObjectURL(blob));
      setProcessedBlob(blob);
    } catch {
      const blob = new Blob([await originalFile.arrayBuffer()], { type: originalFile.type });
      setProcessedPreview(URL.createObjectURL(blob));
      setProcessedBlob(blob);
    } finally {
      setProcessing(false);
    }
  };

  const handleSaveLogo = async () => {
    if (!processedBlob) return;
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("file", new File([processedBlob], "logo.png", { type: "image/png" }));
      const res = await fetch("/api/configuracoes/logo", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha no upload");
      const url = `${data.url}?t=${Date.now()}`;
      // Salva logo_url no banco
      await supabase.from("config_garage").update({ logo_url: url }).eq("id", config.id!);
      localStorage.setItem("garage_logo_url", url);
      setCurrentLogo(url);
      setConfig(c => ({ ...c, logo_url: url }));
      setSaved(true);
    } catch (err: any) {
      alert("Erro ao salvar logo: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!confirm("Remover logo atual?")) return;
    await supabase.from("config_garage").update({ logo_url: null }).eq("id", config.id!);
    localStorage.removeItem("garage_logo_url");
    setCurrentLogo(null);
    setConfig(c => ({ ...c, logo_url: null }));
    reset();
  };

  const handleSaveInfo = async () => {
    setSavingInfo(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      // Usa upsert com onConflict para nunca criar duplicatas
      const { data, error } = await supabase
        .from("config_garage")
        .upsert(
          {
            ...(config.id ? { id: config.id } : {}),
            user_id: user.id,
            nome_empresa: config.nome_empresa,
            nome_agente: config.nome_agente,
            endereco: config.endereco,
            whatsapp: config.whatsapp,
            webhook_token: config.webhook_token || null,
            nome_usuario: config.nome_usuario || null,
            cargo_usuario: config.cargo_usuario || null,
          },
          { onConflict: "user_id" }
        )
        .select()
        .single();

      if (error) throw error;
      if (data && !config.id) setConfig(c => ({ ...c, id: data.id }));

      setSavedInfo(true);
      setTimeout(() => setSavedInfo(false), 3000);
    } catch (err: any) {
      alert("Erro ao salvar: " + err.message);
    } finally {
      setSavingInfo(false);
    }
  };

  return (
    <main className="flex-1 p-10 bg-[#efefed] min-h-screen">
      <header className="mb-10 pb-6 border-b border-gray-200">
        <h1 className="text-4xl font-black uppercase tracking-tighter italic text-gray-900">
          Configurações
        </h1>
        <p className="text-gray-400 uppercase tracking-widest text-[10px] font-bold mt-1">
          Personalização da Garagem
        </p>
      </header>

      <div className="max-w-2xl flex flex-col gap-6">

        {/* ── Informações da Garagem ── */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-1">
            Informações da Garagem
          </h2>
          <p className="text-[11px] text-gray-500 mb-6">
            Usadas pelo agente e na vitrine pública.
          </p>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Nome da Empresa
              </label>
              <input
                type="text"
                value={config.nome_empresa}
                onChange={e => setConfig(c => ({ ...c, nome_empresa: e.target.value }))}
                placeholder="Ex: Garage Racing"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Nome do Agente IA
              </label>
              <input
                type="text"
                value={config.nome_agente}
                onChange={e => setConfig(c => ({ ...c, nome_agente: e.target.value }))}
                placeholder="Ex: Lucas"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Endereço
              </label>
              <input
                type="text"
                value={config.endereco}
                onChange={e => setConfig(c => ({ ...c, endereco: e.target.value }))}
                placeholder="Ex: Rua das Garagens, 100 — São Paulo, SP"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                WhatsApp (com DDI)
              </label>
              <input
                type="text"
                value={config.whatsapp}
                onChange={e => setConfig(c => ({ ...c, whatsapp: e.target.value }))}
                placeholder="Ex: 5517991141010"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
            </div>

            <div className="flex flex-col gap-1.5 mt-2 bg-blue-50/50 p-4 border border-blue-100 rounded-2xl">
              <label className="text-[10px] font-black uppercase tracking-widest text-blue-800">
                Token do Webhook (Identificador do Cliente)
              </label>
              <input
                type="text"
                value={config.webhook_token || ""}
                onChange={e => setConfig(c => ({ ...c, webhook_token: e.target.value }))}
                placeholder="Ex: autozap ou aprove"
                className="bg-white border flex-1 border-blue-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
              />
              <p className="text-[10px] text-blue-600 mt-1">Configure na Avisa: <strong>https://[seu-dominio]/api/webhook/avisa?token={config.webhook_token || "SEU_TOKEN"}</strong></p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Seu Nome
              </label>
              <input
                type="text"
                value={config.nome_usuario || ""}
                onChange={e => setConfig(c => ({ ...c, nome_usuario: e.target.value }))}
                placeholder="Ex: Lucas Salles"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Cargo
              </label>
              <input
                type="text"
                value={config.cargo_usuario || ""}
                onChange={e => setConfig(c => ({ ...c, cargo_usuario: e.target.value }))}
                placeholder="Ex: Gerente de Pátio"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
            </div>

            <button
              onClick={handleSaveInfo}
              disabled={savingInfo || savedInfo}
              className={`mt-2 w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest transition-all flex items-center justify-center gap-2 ${
                savedInfo ? "bg-green-500 text-white" : "bg-gray-900 text-white hover:bg-red-600"
              }`}
            >
              {savingInfo ? (
                <><Loader2 size={16} className="animate-spin" /> Salvando...</>
              ) : savedInfo ? (
                <><CheckCircle2 size={16} /> Salvo com sucesso!</>
              ) : (
                <><Save size={14} /> Salvar informações</>
              )}
            </button>
          </div>
        </div>

        {/* ── Logo da Garagem ── */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-1">
            Logo da Garagem
          </h2>
          <p className="text-[11px] text-gray-500 mb-6">
            Aplicada automaticamente como marca d'água em todas as fotos do estoque.
          </p>

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

          <div className="flex gap-3 mb-6">
            <button type="button" onClick={() => handleModeChange("manual")}
              className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-2xl border-2 text-left transition-all ${
                mode === "manual" ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 text-gray-500 hover:border-gray-300"
              }`}
            >
              <FileImage size={16} />
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest">PNG com fundo transparente</p>
                <p className="text-[9px] mt-0.5 text-gray-400">Melhor qualidade — recomendado</p>
              </div>
            </button>
            <button type="button" onClick={() => handleModeChange("auto")}
              className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-2xl border-2 text-left transition-all ${
                mode === "auto" ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 text-gray-500 hover:border-gray-300"
              }`}
            >
              <Sparkles size={16} />
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest">Remover fundo automático</p>
                <p className="text-[9px] text-gray-400 mt-0.5">Funciona com JPG/PNG</p>
              </div>
            </button>
          </div>

          {mode === "manual" && (
            <div className="mb-5 px-4 py-3 bg-blue-50 border border-blue-100 rounded-2xl">
              <p className="text-[10px] font-black text-blue-700 uppercase tracking-widest mb-1">Especificações recomendadas</p>
              <ul className="text-[10px] text-blue-600 space-y-0.5">
                <li>• Formato: <strong>PNG com fundo transparente</strong></li>
                <li>• Tamanho: <strong>mínimo 600 × 300 px</strong></li>
                <li>• Fundo branco vai aparecer sobre as fotos — use transparente</li>
              </ul>
            </div>
          )}

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
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
          </label>

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

          {processedPreview && !processing && (
            <div className="mt-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Prévia na foto</p>
              <div className="relative h-40 bg-gray-800 rounded-xl overflow-hidden border border-gray-200">
                <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-[10px] font-bold uppercase tracking-widest">
                  [foto do veículo]
                </div>
                <img src={processedPreview} alt="Preview watermark"
                  className="absolute bottom-3 right-3 opacity-85"
                  style={{ width: "20%", maxWidth: 120 }}
                />
              </div>
            </div>
          )}

          {processedBlob && !processing && (
            <button
              onClick={handleSaveLogo}
              disabled={saving || saved}
              className={`mt-6 w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest transition-all flex items-center justify-center gap-2 ${
                saved ? "bg-green-500 text-white" : "bg-gray-900 text-white hover:bg-red-600"
              }`}
            >
              {saving ? (
                <><Loader2 size={16} className="animate-spin" /> Salvando...</>
              ) : saved ? (
                <><CheckCircle2 size={16} /> Logo salva com sucesso!</>
              ) : "Salvar logo"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
