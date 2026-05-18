"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Upload, CheckCircle2, Loader2, ImageIcon, Trash2, Sparkles, FileImage, Save, Copy, Eye, EyeOff, FileText, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";

declare global {
  interface Window {
    fbAsyncInit: () => void;
    FB: any;
  }
}

type Mode = "auto" | "manual";

interface NFConfig {
  regime_tributario: 1 | 2 | 3;
  inscricao_estadual: string;
  cep: string;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  telefone: string;
  certificado_senha: string;
  habilitado: boolean;
}

interface GarageConfig {
  id?: string;
  nome_empresa: string;
  nome_fantasia: string;
  cnpj: string;
  cidade: string;
  estado: string;
  nome_agente: string;
  endereco: string;
  endereco_complemento?: string;
  whatsapp: string;
  whatsapp_agente?: string;
  logo_url: string | null;
  vitrine_slug?: string;
  meta_phone_id?: string;
  meta_access_token?: string;
  meta_ads_token?: string;
  nome_usuario?: string;
  cargo_usuario?: string;
  tom_venda?: string;
  instrucoes_adicionais?: string;
  horario_funcionamento?: string;
  oferta_especial?: string;
  webmotors_usuario?: string;
  webmotors_senha?: string;
  nf_cep?: string;
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
  const [showToken, setShowToken] = useState(false);
  const [isAdminSession, setIsAdminSession] = useState(false);
  const [webhookToken, setWebhookToken] = useState("");
  const [olxConectado, setOlxConectado] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const searchParams = useSearchParams();
  const [copied, setCopied] = useState<string | null>(null);
  const [metaConnecting, setMetaConnecting] = useState(false);
  const [metaConnected, setMetaConnected] = useState(false);

  // Webmotors
  const [showWmSenha, setShowWmSenha] = useState(false);
  const [savingWm, setSavingWm] = useState(false);
  const [savedWm, setSavedWm] = useState(false);

  // Facebook Ads — conectar página + ad account
  const [metaAdsLoading, setMetaAdsLoading] = useState(false);
  const [metaAdsSaving, setMetaAdsSaving] = useState(false);
  const [metaAdsSaved, setMetaAdsSaved] = useState(false);
  const [metaAdsError, setMetaAdsError] = useState<string | null>(null);
  const [metaPaginas, setMetaPaginas] = useState<any[]>([]);
  const [metaAdAccounts, setMetaAdAccounts] = useState<any[]>([]);
  const [metaPaginaSalva, setMetaPaginaSalva] = useState<any | null>(null);
  const [selectedPageId, setSelectedPageId] = useState("");
  const [selectedAdAccountId, setSelectedAdAccountId] = useState("");
  const [config, setConfig] = useState<GarageConfig>({
    nome_empresa: "",
    nome_fantasia: "",
    cnpj: "",
    cidade: "",
    estado: "",
    nome_agente: "",
    endereco: "",
    endereco_complemento: "",
    whatsapp: "",
    whatsapp_agente: "",
    vitrine_slug: "",
    logo_url: null,
    meta_phone_id: "",
    meta_access_token: "",
    meta_ads_token: "",
    nome_usuario: "",
    cargo_usuario: "",
    tom_venda: "",
    instrucoes_adicionais: "",
    horario_funcionamento: "",
    oferta_especial: "",
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const pfxRef = useRef<HTMLInputElement>(null);
  const [plano, setPlano] = useState<string | null>(null);
  const [nfConfig, setNfConfig] = useState<NFConfig>({
    regime_tributario: 1,
    inscricao_estadual: "",
    cep: "",
    logradouro: "",
    numero: "",
    bairro: "",
    municipio: "",
    uf: "",
    telefone: "",
    certificado_senha: "",
    habilitado: false,
  });
  const [pfxBase64, setPfxBase64] = useState<string>("");
  const [pfxFileName, setPfxFileName] = useState<string>("");
  const [savingNF, setSavingNF] = useState(false);
  const [savedNF, setSavedNF] = useState(false);
  const [showNFSenha, setShowNFSenha] = useState(false);

  type Tab = "loja" | "portais" | "whatsapp" | "fiscal";
  const [activeTab, setActiveTab] = useState<Tab>("loja");

  // Carrega o Facebook SDK para Embedded Signup
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const savedUid = sessionStorage.getItem("autozap_admin_uid");
      setIsAdminSession(savedUid === user.id);
    });
  }, []);

  // SDK do Facebook — carregado só quando o usuário interage com a seção Meta
  // (antes estava no mount, bloqueando ~500ms em toda visita às configurações)
  const loadFacebookSDK = () => {
    if (document.getElementById("facebook-sdk")) return; // já carregado
    window.fbAsyncInit = function () {
      window.FB.init({
        appId: process.env.NEXT_PUBLIC_META_APP_ID!,
        autoLogAppEvents: true,
        xfbml: true,
        version: "v19.0",
      });
    };
    const script = document.createElement("script");
    script.id = "facebook-sdk";
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  };

  useEffect(() => {
    // Recebe phone_number_id do popup do Embedded Signup
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== "https://www.facebook.com") return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "WA_EMBEDDED_SIGNUP" && data.event === "FINISH") {
          setConfig(c => ({
            ...c,
            meta_phone_id: data.data?.phone_number_id || c.meta_phone_id,
          }));
        }
      } catch {}
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleMetaEmbeddedSignup = async () => {
    loadFacebookSDK();
    // Aguarda até 3s o SDK inicializar antes de prosseguir
    if (!window.FB) {
      await new Promise<void>(resolve => {
        const t0 = Date.now();
        const check = setInterval(() => {
          if (window.FB || Date.now() - t0 > 3000) { clearInterval(check); resolve(); }
        }, 100);
      });
    }
    if (!window.FB) { alert("SDK do Facebook ainda carregando, tente novamente."); return; }
    setMetaConnecting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setMetaConnecting(false); return; }

    const redirectUri = `${window.location.origin}/configuracoes`;

    window.FB.login(
      async (response: any) => {
        const code = response.authResponse?.code;
        if (!code) { setMetaConnecting(false); return; }
        try {
          const res = await fetch("/api/auth/meta/exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, redirectUri }),
          });
          const data = await res.json();
          if (res.ok) {
            setConfig(c => ({
              ...c,
              meta_access_token: data.access_token  || c.meta_access_token,
              meta_phone_id:     data.phone_number_id || c.meta_phone_id,
            }));
            setMetaConnected(true);
            setTimeout(() => setMetaConnected(false), 4000);
          } else {
            alert("Erro ao conectar: " + data.error);
          }
        } finally {
          setMetaConnecting(false);
        }
      },
      {
        config_id: process.env.NEXT_PUBLIC_META_CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "",
          sessionInfoVersion: "2",
        },
      },
    );
  };

  const carregarMetaAds = async () => {
    setMetaAdsLoading(true);
    setMetaAdsError(null);
    try {
      const res = await fetch("/api/meta/pagina?listar=1");
      if (!res.ok) {
        const e = await res.json();
        setMetaAdsError(e.error ?? "Erro ao carregar páginas");
        return;
      }
      const { paginas, adAccounts, error: apiErr } = await res.json();
      if (apiErr) { setMetaAdsError(apiErr); return; }
      setMetaPaginas(paginas ?? []);
      setMetaAdAccounts(adAccounts ?? []);
      if (paginas?.length) setSelectedPageId(paginas[0].id);
      if (adAccounts?.length) setSelectedAdAccountId(adAccounts[0].id);
    } catch {
      setMetaAdsError("Erro de conexão");
    } finally {
      setMetaAdsLoading(false);
    }
  };

  const salvarPaginaMeta = async () => {
    const pagina = metaPaginas.find((p) => p.id === selectedPageId);
    if (!pagina) return;
    setMetaAdsSaving(true);
    setMetaAdsError(null);
    try {
      const res = await fetch("/api/meta/pagina", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageId:           pagina.id,
          pageName:         pagina.name,
          pageAccessToken:  pagina.access_token,
          adAccountId:      selectedAdAccountId || null,
          instagramActorId: pagina.instagram_business_account?.id ?? null,
        }),
      });
      if (!res.ok) {
        const e = await res.json();
        setMetaAdsError(e.error ?? "Erro ao salvar");
        return;
      }
      setMetaPaginaSalva({ name: pagina.name, adAccountId: selectedAdAccountId });
      setMetaAdsSaved(true);
      setTimeout(() => setMetaAdsSaved(false), 3000);
    } finally {
      setMetaAdsSaving(false);
    }
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setCurrentUserId(user.id);
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
            if (row.webhook_token) setWebhookToken(row.webhook_token);
            if (row.olx_access_token) setOlxConectado(true);
            if (row.plano) setPlano(row.plano);
            if (row.nf_habilitado !== undefined) {
              setNfConfig({
                regime_tributario: row.nf_regime_tributario ?? 1,
                inscricao_estadual: row.nf_inscricao_estadual ?? "",
                cep: row.nf_cep ?? "",
                logradouro: row.nf_logradouro ?? "",
                numero: row.nf_numero_end ?? "",
                bairro: row.nf_bairro ?? "",
                municipio: row.nf_municipio ?? "",
                uf: row.nf_uf ?? "",
                telefone: "",
                certificado_senha: "",
                habilitado: row.nf_habilitado ?? false,
              });
            }
            setConfig({
              id: row.id,
              nome_empresa: row.nome_empresa ?? "",
              nome_fantasia: row.nome_fantasia ?? "",
              cnpj: row.cnpj ?? "",
              cidade: row.cidade ?? "",
              estado: row.estado ?? "",
              nome_agente: row.nome_agente ?? "",
              endereco: row.endereco ?? "",
              endereco_complemento: row.endereco_complemento ?? "",
              whatsapp: row.whatsapp ?? "",
              whatsapp_agente: row.whatsapp_agente ?? "",
              vitrine_slug: row.vitrine_slug ?? "",
              logo_url: row.logo_url ?? null,
              meta_phone_id: row.meta_phone_id ?? "",
              meta_access_token: row.meta_access_token ?? "",
              nome_usuario: row.nome_usuario ?? "",
              cargo_usuario: row.cargo_usuario ?? "",
              tom_venda: row.tom_venda ?? "",
              instrucoes_adicionais: row.instrucoes_adicionais ?? "",
              horario_funcionamento: row.horario_funcionamento ?? "",
              oferta_especial: row.oferta_especial ?? "",
              webmotors_usuario: row.webmotors_usuario ?? "",
              webmotors_senha:   row.webmotors_senha   ?? "",
              nf_cep:            row.nf_cep            ?? "",
            });
            if (row.logo_url) {
              setCurrentLogo(row.logo_url);
              localStorage.setItem("garage_logo_url", row.logo_url);
            }

            // Carrega página Facebook já salva
            if (row.meta_ads_token || row.meta_access_token) {
              supabase
                .from("meta_paginas")
                .select("page_name, ad_account_id")
                .eq("user_id", user.id)
                .limit(1)
                .then(({ data: pags }) => {
                  if (pags?.[0]) {
                    setMetaPaginaSalva({ name: pags[0].page_name, adAccountId: pags[0].ad_account_id });
                  }
                });
            }
            // Sinaliza se token de Ads está conectado
            if (row.meta_ads_token) {
              setConfig(c => ({ ...c, meta_ads_token: row.meta_ads_token }));
            }
          }
        });
    });
  }, []);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");
      const formData = new FormData();
      formData.append("file", new File([processedBlob], "logo.png", { type: "image/png" }));
      formData.append("user_id", user.id);
      const res = await fetch("/api/configuracoes/logo", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha no upload");
      const url = `${data.url}?t=${Date.now()}`;
      await supabase.from("config_garage").update({ logo_url: url }).eq("id", config.id!);
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
            nome_fantasia: config.nome_fantasia || null,
            cnpj: config.cnpj || null,
            cidade: config.cidade || null,
            estado: config.estado || null,
            nome_agente: config.nome_agente,
            endereco: config.endereco,
            endereco_complemento: config.endereco_complemento || null,
            whatsapp: config.whatsapp,
            whatsapp_agente: config.whatsapp_agente || null,
            vitrine_slug: config.vitrine_slug || null,
            meta_phone_id: config.meta_phone_id || null,
            meta_access_token: config.meta_access_token || null,
            nome_usuario: config.nome_usuario || null,
            cargo_usuario: config.cargo_usuario || null,
            tom_venda: config.tom_venda || null,
            instrucoes_adicionais: config.instrucoes_adicionais || null,
            horario_funcionamento: config.horario_funcionamento || null,
            oferta_especial:      config.oferta_especial      || null,
            webmotors_usuario:    config.webmotors_usuario    || null,
            webmotors_senha:      config.webmotors_senha      || null,
            nf_cep:               config.nf_cep               || null,
          },
          { onConflict: "user_id" }
        )
        .select()
        .single();

      if (error) throw error;
      if (data && !config.id) setConfig(c => ({ ...c, id: data.id }));

      // Popula o Redis com o slug para que o middleware de subdomínio funcione.
      // Fire-and-forget — falha não bloqueia o save (o middleware tem fail-open).
      if (config.vitrine_slug) {
        fetch("/api/vitrine/seed-slug", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: config.vitrine_slug }),
        }).catch(() => {});
      }

      setSavedInfo(true);
      setTimeout(() => setSavedInfo(false), 3000);
    } catch (err: any) {
      alert("Erro ao salvar: " + err.message);
    } finally {
      setSavingInfo(false);
    }
  };

  const handlePfxSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setPfxFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data URL prefix, keep only base64
      setPfxBase64(result.split(",")[1] ?? "");
    };
    reader.readAsDataURL(file);
  };

  const handleSaveNF = async () => {
    if (!pfxBase64) { alert("Selecione o arquivo .pfx do certificado digital."); return; }
    if (!nfConfig.certificado_senha) { alert("Informe a senha do certificado."); return; }
    setSavingNF(true);
    try {
      const res = await fetch("/api/nf/configurar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regime_tributario: nfConfig.regime_tributario,
          inscricao_estadual: nfConfig.inscricao_estadual || undefined,
          cep: nfConfig.cep,
          logradouro: nfConfig.logradouro,
          numero: nfConfig.numero,
          bairro: nfConfig.bairro,
          municipio: nfConfig.municipio,
          uf: nfConfig.uf,
          telefone: nfConfig.telefone || undefined,
          certificado_pfx: pfxBase64,
          certificado_senha: nfConfig.certificado_senha,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao configurar NF-e");
      setNfConfig(c => ({ ...c, habilitado: true }));
      setSavedNF(true);
      setTimeout(() => setSavedNF(false), 4000);
    } catch (err: any) {
      alert("Erro: " + err.message);
    } finally {
      setSavingNF(false);
    }
  };

  return (
    <main className="flex-1 p-4 sm:p-10 bg-[#efefed] min-h-screen">
      <header className="mb-8 pb-6 border-b border-gray-200">
        <h1 className="text-4xl font-black uppercase tracking-tighter italic text-gray-900">
          Configurações
        </h1>
        <p className="text-gray-400 uppercase tracking-widest text-[10px] font-bold mt-1">
          Personalização da Garagem
        </p>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-2xl p-1 border border-gray-100 shadow-sm mb-8 max-w-2xl overflow-x-auto">
        {(["loja","portais","whatsapp","fiscal"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap ${
              activeTab === tab
                ? "bg-gray-900 text-white shadow"
                : "text-gray-400 hover:text-gray-700"
            }`}
          >
            {{ loja: "Minha Loja", portais: "Portais", whatsapp: "WhatsApp & Ads", fiscal: "Fiscal" }[tab]}
          </button>
        ))}
      </div>

      <div className="max-w-2xl flex flex-col gap-6">

        {/* ══ ABA: MINHA LOJA ══════════════════════════════════════════════════ */}
        {activeTab === "loja" && <>

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
                Nome Fantasia <span className="text-gray-400 normal-case font-normal">(usado nas páginas do site)</span>
              </label>
              <input
                type="text"
                value={config.nome_fantasia}
                onChange={e => setConfig(c => ({ ...c, nome_fantasia: e.target.value }))}
                placeholder="Ex: Aprove Multimarcas"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Razão Social <span className="text-gray-400 normal-case font-normal">(para contratos)</span>
              </label>
              <input
                type="text"
                value={config.nome_empresa}
                onChange={e => setConfig(c => ({ ...c, nome_empresa: e.target.value }))}
                placeholder="Ex: APROVE MULTIMARCAS COM DE VEICULOS LTDA"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                CNPJ <span className="text-gray-400 normal-case font-normal">(para contratos)</span>
              </label>
              <input
                type="text"
                value={config.cnpj}
                onChange={e => setConfig(c => ({ ...c, cnpj: e.target.value }))}
                placeholder="00.000.000/0001-00"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
            </div>

            <div className="flex gap-3">
              <div className="flex flex-col gap-1.5 flex-1">
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
              <div className="flex flex-col gap-1.5 flex-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Telefone do Agente (com DDI)
                </label>
                <input
                  type="text"
                  value={config.whatsapp_agente ?? ""}
                  onChange={e => setConfig(c => ({ ...c, whatsapp_agente: e.target.value }))}
                  placeholder="Ex: 5517991604158"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                />
              </div>
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
                Complemento
              </label>
              <input
                type="text"
                value={config.endereco_complemento ?? ""}
                onChange={e => setConfig(c => ({ ...c, endereco_complemento: e.target.value }))}
                placeholder="perto de onde"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
            </div>

            <div className="flex gap-3">
              <div className="flex flex-col gap-1.5 flex-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Cidade</label>
                <input
                  type="text"
                  value={config.cidade}
                  onChange={e => setConfig(c => ({ ...c, cidade: e.target.value }))}
                  placeholder="São José do Rio Preto"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                />
              </div>
              <div className="flex flex-col gap-1.5 w-20">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">UF</label>
                <input
                  type="text"
                  value={config.estado}
                  onChange={e => setConfig(c => ({ ...c, estado: e.target.value.toUpperCase().slice(0, 2) }))}
                  placeholder="SP"
                  maxLength={2}
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                />
              </div>
              <div className="flex flex-col gap-1.5 w-32">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">CEP</label>
                <input
                  type="text"
                  value={config.nf_cep ?? ""}
                  onChange={e => setConfig(c => ({ ...c, nf_cep: e.target.value }))}
                  placeholder="15000-000"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                WhatsApp do Gerente (com DDI)
              </label>
              <input
                type="text"
                value={config.whatsapp}
                onChange={e => setConfig(c => ({ ...c, whatsapp: e.target.value }))}
                placeholder="Ex: 5517991141010"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
            </div>

            {/* bloco Meta — renderizado apenas na aba WhatsApp via portal lógico */}
            {activeTab === "whatsapp" && <div className="flex flex-col gap-1.5 mt-2 bg-blue-50/50 p-4 border border-blue-100 rounded-2xl">
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-800 mb-1">
                WhatsApp Business (Meta Cloud API)
              </p>
              <p className="text-[10px] text-blue-600 mb-3">
                Configure no <strong>Meta for Developers</strong> → seu app → WhatsApp → Configuração.
                URL do webhook:{" "}
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText("https://autozap.digital/api/webhook/meta")}
                  className="font-mono text-blue-700 hover:underline cursor-pointer"
                >
                  <strong>https://autozap.digital/api/webhook/meta</strong>
                </button>
                {" "}· Token de verificação: <strong className="font-mono">autozap_webhook_2026</strong>
              </p>

              {/* Aviso de campo bloqueado — oculto para sessão admin */}
              {!isAdminSession && (
                <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 mb-1">
                  <ShieldCheck size={13} className="text-blue-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-blue-600 leading-relaxed">
                    Estes campos são configurados pelo <strong>suporte AutoZap</strong>. Para alterar, entre em contato conosco.
                  </p>
                </div>
              )}

              <label className="text-[10px] font-black uppercase tracking-widest text-blue-800 block">
                Phone Number ID
              </label>
              <input
                type="text"
                value={config.meta_phone_id || ""}
                readOnly={!isAdminSession}
                onChange={isAdminSession ? e => setConfig(c => ({ ...c, meta_phone_id: e.target.value.trim() })) : undefined}
                placeholder="Ex: 390538797515329"
                className={`border rounded-xl px-4 py-2.5 font-mono text-sm w-full transition ${isAdminSession ? "bg-white border-blue-300 text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" : "bg-blue-50 border-blue-100 text-gray-500 cursor-not-allowed"}`}
              />

              <label className="text-[10px] font-black uppercase tracking-widest text-blue-800 mt-3 block">
                Número do WhatsApp Business (com DDI)
              </label>
              <input
                type="text"
                value={config.whatsapp_agente || ""}
                readOnly={!isAdminSession}
                onChange={isAdminSession ? e => setConfig(c => ({ ...c, whatsapp_agente: e.target.value.trim() })) : undefined}
                placeholder="Ex: 5517991127787"
                className={`border rounded-xl px-4 py-2.5 font-mono text-sm w-full transition ${isAdminSession ? "bg-white border-blue-300 text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" : "bg-blue-50 border-blue-100 text-gray-500 cursor-not-allowed"}`}
              />

              <label className="text-[10px] font-black uppercase tracking-widest text-blue-800 mt-3 block">
                Access Token
              </label>
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={config.meta_access_token || ""}
                  readOnly={!isAdminSession}
                  onChange={isAdminSession ? e => setConfig(c => ({ ...c, meta_access_token: e.target.value.trim() })) : undefined}
                  placeholder="EAAxxxxxxxxxxxxxxxx..."
                  className={`w-full border rounded-xl px-4 py-2.5 pr-20 font-mono text-sm transition ${isAdminSession ? "bg-white border-blue-300 text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" : "bg-blue-50 border-blue-100 text-gray-500 cursor-not-allowed"}`}
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                  <button type="button" onClick={() => setShowToken(v => !v)}
                    className="p-1.5 text-blue-400 hover:text-blue-700 transition-colors">
                    {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  {config.meta_access_token && (
                    <button type="button" onClick={() => copyToClipboard(config.meta_access_token!, "token")}
                      className="p-1.5 text-blue-400 hover:text-blue-700 transition-colors">
                      {copied === "token" ? <CheckCircle2 size={14} className="text-green-500" /> : <Copy size={14} />}
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-blue-100">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-800 mb-2">
                  Conectar via Embedded Signup
                </p>
                <button
                  type="button"
                  onClick={handleMetaEmbeddedSignup}
                  disabled={metaConnecting || metaConnected}
                  className="w-full py-2.5 rounded-xl font-black uppercase text-[10px] tracking-widest bg-[#1877F2] text-white hover:bg-[#1465d8] disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
                >
                  {metaConnecting ? (
                    <><Loader2 size={14} className="animate-spin" /> Conectando...</>
                  ) : metaConnected ? (
                    <><CheckCircle2 size={14} /> Conectado!</>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                      Conectar com Meta / Facebook
                    </>
                  )}
                </button>
                <p className="text-[10px] text-blue-500 mt-1">
                  Guia o cliente a criar ou conectar uma WABA e preenche Phone ID + Access Token automaticamente.
                </p>
              </div>

              <label className="text-[10px] font-black uppercase tracking-widest text-blue-800 mt-3 block">
                Slug da Vitrine (URL curta)
              </label>
              <input
                type="text"
                value={config.vitrine_slug || ""}
                onChange={e => setConfig(c => ({ ...c, vitrine_slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                placeholder="Ex: aprove"
                className="bg-white border border-blue-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
              />
              <p className="text-[10px] text-blue-600 mt-1">
                Vitrine pública:{" "}
                <strong>
                  {config.vitrine_slug
                    ? `${config.vitrine_slug}.autozap.digital`
                    : "SEU_SLUG.autozap.digital"}
                </strong>
              </p>
            </div>} {/* fim bloco Meta condicional */}

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


            <div className="flex flex-col gap-4 mt-2 bg-amber-50/60 p-4 border border-amber-100 rounded-2xl">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-amber-800 block mb-1.5">
                  Horário de Funcionamento
                </label>
                <input
                  type="text"
                  value={config.horario_funcionamento || ""}
                  onChange={e => setConfig(c => ({ ...c, horario_funcionamento: e.target.value }))}
                  placeholder="Ex: Seg a Sex das 8h às 18h, Sáb das 8h às 13h"
                  className="w-full bg-white border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-400 transition"
                />
                <p className="text-[10px] text-amber-700 mt-1">O agente usará essa informação ao responder clientes fora do horário ou sobre visitas.</p>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-amber-800 block mb-1.5">
                  Tom de Venda do Agente
                </label>
                <input
                  type="text"
                  value={config.tom_venda || ""}
                  onChange={e => setConfig(c => ({ ...c, tom_venda: e.target.value }))}
                  placeholder="Ex: descontraído e jovem, formal e técnico..."
                  className="w-full bg-white border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-400 transition"
                />
                <p className="text-[10px] text-amber-700 mt-1">Descreva o jeito que o agente deve falar com os clientes.</p>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-amber-800 block mb-1.5">
                  Instruções Personalizadas
                </label>
                <textarea
                  value={config.instrucoes_adicionais || ""}
                  onChange={e => setConfig(c => ({ ...c, instrucoes_adicionais: e.target.value }))}
                  placeholder="Ex: Nunca ofereça desconto sem perguntar ao gerente. Sempre mencione que fazemos vistoria gratuita."
                  rows={4}
                  className="w-full bg-white border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-400 transition resize-none"
                />
                <p className="text-[10px] text-amber-700 mt-1">Regras específicas da sua loja. O agente seguirá com prioridade alta.</p>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-amber-800 block mb-1.5">
                  🎯 Oferta Especial Ativa
                </label>
                <textarea
                  value={config.oferta_especial || ""}
                  onChange={e => setConfig(c => ({ ...c, oferta_especial: e.target.value }))}
                  placeholder="Ex: Este mês: entrada mínima de 20% + parcelas a partir de R$899. Todas as revisões do 1º ano inclusas."
                  rows={3}
                  className="w-full bg-white border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-400 transition resize-none"
                />
                <p className="text-[10px] text-amber-700 mt-1">A IA menciona essa oferta nos momentos certos da negociação. Deixe em branco para desativar.</p>
              </div>
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

        </> /* fim aba loja */}

        {/* ══ ABA: FISCAL ══════════════════════════════════════════════════════ */}
        {activeTab === "fiscal" && <>

        {/* ── Nota Fiscal Eletrônica (Premium) ── */}
        {plano === "premium" ? (
          <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">
            <div className="flex items-center gap-3 mb-1">
              <FileText size={18} className="text-purple-600" />
              <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400">
                Nota Fiscal Eletrônica
              </h2>
              {nfConfig.habilitado && (
                <span className="ml-auto flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                  <ShieldCheck size={10} /> Habilitado
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-500 mb-6">
              Configure o certificado digital A1 para emissão de NF-e diretamente nos veículos vendidos.
            </p>

            <div className="flex flex-col gap-4">
              {/* Regime tributário */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Regime Tributário
                </label>
                <select
                  value={nfConfig.regime_tributario}
                  onChange={e => setNfConfig(c => ({ ...c, regime_tributario: Number(e.target.value) as 1|2|3 }))}
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition"
                >
                  <option value={1}>1 — Simples Nacional</option>
                  <option value={2}>2 — Lucro Presumido</option>
                  <option value={3}>3 — Lucro Real</option>
                </select>
              </div>

              {/* Inscrição estadual */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Inscrição Estadual <span className="text-gray-400 normal-case font-normal">(deixe em branco para ISENTO)</span>
                </label>
                <input
                  type="text"
                  value={nfConfig.inscricao_estadual}
                  onChange={e => setNfConfig(c => ({ ...c, inscricao_estadual: e.target.value }))}
                  placeholder="Ex: 123.456.789.000"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition"
                />
              </div>

              {/* Endereço fiscal */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex flex-col gap-1.5 sm:w-32">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">CEP</label>
                  <input type="text" value={nfConfig.cep} onChange={e => setNfConfig(c => ({ ...c, cep: e.target.value }))}
                    placeholder="00000-000"
                    className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition" />
                </div>
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Logradouro</label>
                  <input type="text" value={nfConfig.logradouro} onChange={e => setNfConfig(c => ({ ...c, logradouro: e.target.value }))}
                    placeholder="Ex: Av. Paulista"
                    className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition" />
                </div>
                <div className="flex flex-col gap-1.5 sm:w-20">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Nº</label>
                  <input type="text" value={nfConfig.numero} onChange={e => setNfConfig(c => ({ ...c, numero: e.target.value }))}
                    placeholder="100"
                    className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition" />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Bairro</label>
                  <input type="text" value={nfConfig.bairro} onChange={e => setNfConfig(c => ({ ...c, bairro: e.target.value }))}
                    placeholder="Ex: Bela Vista"
                    className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition" />
                </div>
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Município</label>
                  <input type="text" value={nfConfig.municipio} onChange={e => setNfConfig(c => ({ ...c, municipio: e.target.value }))}
                    placeholder="Ex: São Paulo"
                    className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition" />
                </div>
                <div className="flex flex-col gap-1.5 sm:w-20">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">UF</label>
                  <input type="text" value={nfConfig.uf} onChange={e => setNfConfig(c => ({ ...c, uf: e.target.value.toUpperCase().slice(0, 2) }))}
                    placeholder="SP" maxLength={2}
                    className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition" />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Telefone <span className="text-gray-400 normal-case font-normal">(opcional)</span></label>
                <input type="text" value={nfConfig.telefone} onChange={e => setNfConfig(c => ({ ...c, telefone: e.target.value }))}
                  placeholder="Ex: 1133334444"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition" />
              </div>

              {/* Certificado A1 */}
              <div className="mt-2 flex flex-col gap-3 bg-purple-50/60 p-4 border border-purple-100 rounded-2xl">
                <p className="text-[10px] font-black uppercase tracking-widest text-purple-800">Certificado Digital A1 (.pfx)</p>
                <p className="text-[10px] text-purple-600">
                  O arquivo é enviado diretamente para a Focus NFe e não fica armazenado no AutoZap.
                </p>

                <label className="cursor-pointer">
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${
                    pfxBase64 ? "border-purple-400 bg-purple-100" : "border-dashed border-purple-200 hover:border-purple-400"
                  }`}>
                    <Upload size={16} className="text-purple-500 shrink-0" />
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-purple-700">
                        {pfxFileName || "Selecionar arquivo .pfx"}
                      </p>
                      {pfxBase64 && <p className="text-[9px] text-purple-500 mt-0.5">Pronto para envio</p>}
                    </div>
                    {pfxBase64 && <CheckCircle2 size={14} className="ml-auto text-purple-500" />}
                  </div>
                  <input ref={pfxRef} type="file" accept=".pfx,.p12" className="hidden" onChange={handlePfxSelect} />
                </label>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-purple-700">Senha do Certificado</label>
                  <div className="relative">
                    <input
                      type={showNFSenha ? "text" : "password"}
                      value={nfConfig.certificado_senha}
                      onChange={e => setNfConfig(c => ({ ...c, certificado_senha: e.target.value }))}
                      placeholder="Senha do arquivo .pfx"
                      className="w-full bg-white border border-purple-200 rounded-xl px-4 py-2.5 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition"
                    />
                    <button type="button" onClick={() => setShowNFSenha(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-400 hover:text-purple-700 transition-colors">
                      {showNFSenha ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              </div>

              <button
                onClick={handleSaveNF}
                disabled={savingNF || savedNF}
                className={`mt-2 w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest transition-all flex items-center justify-center gap-2 ${
                  savedNF ? "bg-green-500 text-white" : "bg-purple-700 text-white hover:bg-purple-800"
                }`}
              >
                {savingNF ? (
                  <><Loader2 size={16} className="animate-spin" /> Configurando...</>
                ) : savedNF ? (
                  <><CheckCircle2 size={16} /> NF-e habilitada com sucesso!</>
                ) : (
                  <><ShieldCheck size={14} /> Habilitar emissão de NF-e</>
                )}
              </button>
            </div>
          </div>
        ) : plano !== null ? (
          <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8 flex items-center gap-4 opacity-70">
            <FileText size={20} className="text-gray-300 shrink-0" />
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">Nota Fiscal Eletrônica</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Disponível apenas no plano <strong className="text-purple-600">Premium</strong>. Faça upgrade para habilitar.</p>
            </div>
          </div>
        ) : null}

        </> /* fim aba fiscal */}

        {/* ══ ABA: MINHA LOJA (continuação — Logo) ════════════════════════════ */}
        {activeTab === "loja" && <>

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

        </> /* fim aba loja logo */}

        {/* ══ ABA: PORTAIS ═════════════════════════════════════════════════════ */}
        {activeTab === "portais" && <>

        {/* ── Integração OLX (OAuth) ─────────────────────────────────────────── */}
        <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-orange-50 flex items-center justify-center">
                <span className="text-orange-500 font-black text-sm">OLX</span>
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-gray-900">Integração OLX</p>
                <p className="text-[10px] text-gray-400">Publique anúncios e receba leads do OLX automaticamente</p>
              </div>
            </div>
            {olxConectado && (
              <span className="flex items-center gap-1 px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-[9px] font-black uppercase tracking-wider">
                <CheckCircle2 size={10} /> Conectado
              </span>
            )}
          </div>

          {searchParams.get("olx_conectado") === "1" && (
            <div className="mt-4 bg-green-50 border border-green-100 rounded-2xl px-4 py-3 text-[11px] text-green-700 font-bold">
              ✅ OLX conectado com sucesso!
            </div>
          )}
          {searchParams.get("olx_error") && (
            <div className="mt-4 bg-red-50 border border-red-100 rounded-2xl px-4 py-3 text-[11px] text-red-600 font-bold">
              ❌ Erro ao conectar: {searchParams.get("olx_error")}
            </div>
          )}

          <div className="mt-5">
            {olxConectado ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-green-50 border border-green-100 rounded-2xl px-4 py-3">
                  <p className="text-[11px] text-green-700 font-bold">Conta OLX vinculada — leads e anúncios ativos.</p>
                  <a
                    href="/api/oauth/olx/authorize"
                    className="text-[10px] text-gray-400 hover:text-gray-600 underline underline-offset-2"
                  >
                    Reconectar
                  </a>
                </div>
                {currentUserId && (
                  <div className="bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 space-y-1">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">URL do Webhook (cadastrar na OLX)</p>
                    <div className="flex items-center gap-2">
                      <code className="text-[10px] text-gray-700 break-all flex-1">
                        {`${process.env.NEXT_PUBLIC_APP_URL ?? "https://autozap.digital"}/api/webhook/olx/${currentUserId}`}
                      </code>
                      <button
                        onClick={() => navigator.clipboard.writeText(`${process.env.NEXT_PUBLIC_APP_URL ?? "https://autozap.digital"}/api/webhook/olx/${currentUserId}`)}
                        className="text-[9px] font-black text-gray-400 hover:text-gray-700 shrink-0"
                      >
                        Copiar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <a
                href="/api/oauth/olx/authorize"
                className="flex items-center justify-center gap-2 w-full py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-2xl font-black text-[11px] uppercase tracking-widest transition-colors"
              >
                Conectar com OLX
              </a>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">O que acontece quando chega um lead</p>
            <div className="space-y-1.5">
              {[
                "Lead é criado automaticamente no chat",
                "Você recebe alerta no WhatsApp com nome, telefone e anúncio",
                "Se o cliente mandar WhatsApp, a IA responde automaticamente",
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="w-4 h-4 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-orange-500 text-[9px] font-black">{i + 1}</span>
                  </div>
                  <p className="text-[11px] text-gray-600">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Webmotors ─────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center">
              <span className="text-red-600 font-black text-[9px] tracking-tight">WEB</span>
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-gray-900">Webmotors</p>
              <p className="text-[10px] text-gray-400">Leads do Webmotors entram automaticamente no chat</p>
            </div>
          </div>

          <div className="mt-4 space-y-4">

            <div className="space-y-3">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Usuário Integrador</p>
                <input
                  type="text"
                  value={config.webmotors_usuario || ""}
                  onChange={(e) => setConfig((c) => ({ ...c, webmotors_usuario: e.target.value }))}
                  placeholder="usuario@loja.com"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-[12px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-200"
                />
              </div>

              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Senha</p>
                <div className="relative">
                  <input
                    type={showWmSenha ? "text" : "password"}
                    value={config.webmotors_senha || ""}
                    onChange={(e) => setConfig((c) => ({ ...c, webmotors_senha: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 pr-10 text-[12px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-200"
                  />
                  <button
                    type="button"
                    onClick={() => setShowWmSenha((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                  >
                    {showWmSenha ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            </div>

            <p className="text-[9px] text-gray-400 italic">
              As credenciais são salvas junto com as demais configurações ao clicar em <span className="font-bold">Salvar</span> no topo da página.
            </p>

            <div className="pt-2 border-t border-gray-100">
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">URL de Callback (copiar para a Webmotors)</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 font-mono text-[10px] text-gray-700 truncate">
                  {`${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.autozap.digital"}/api/webhook/webmotors`}
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(
                    `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.autozap.digital"}/api/webhook/webmotors`,
                    "wm-url"
                  )}
                  className="flex-shrink-0 p-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-colors"
                >
                  {copied === "wm-url" ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          </div>
        </div>

        </> /* fim aba portais */}

        {/* ══ ABA: WHATSAPP ════════════════════════════════════════════════════ */}
        {activeTab === "whatsapp" && <>

        {/* ── Facebook / Instagram Ads ──────────────────────────────────────── */}
        {searchParams.get("meta_ads_ok") === "1" && (
          <div className="bg-green-50 border border-green-200 rounded-2xl px-4 py-3 text-[11px] text-green-700 font-bold">
            ✅ Conta Facebook conectada para Anúncios! Agora selecione sua página abaixo.
          </div>
        )}
        {searchParams.get("meta_ads_error") && (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-[11px] text-red-700">
            ❌ Erro ao conectar: {searchParams.get("meta_ads_error")}
          </div>
        )}
        <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-blue-600">
                <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.885v2.27h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
              </svg>
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-gray-900">Facebook / Instagram Ads</p>
              <p className="text-[10px] text-gray-400">Publique anúncios Lead Ad direto da página do veículo</p>
            </div>
          </div>

          {!config.meta_ads_token && !config.meta_access_token ? (
            <div className="mt-4 space-y-3">
              <p className="text-[11px] text-gray-500">
                Conecte sua conta Facebook para publicar Lead Ads direto do estoque.
              </p>
              <a
                href="/api/meta/connect"
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold transition-colors"
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-white">
                  <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.885v2.27h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
                </svg>
                Conectar Facebook para Anúncios
              </a>
            </div>
          ) : !config.meta_ads_token ? (
            <div className="mt-4 space-y-3">
              <div className="bg-yellow-50 border border-yellow-100 rounded-2xl p-3">
                <p className="text-[11px] text-yellow-700">
                  Usando token do WhatsApp para Ads. Para melhor compatibilidade, conecte uma conta dedicada de Ads.
                </p>
              </div>
              <a
                href="/api/meta/connect"
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-2xl border border-blue-300 text-blue-600 hover:bg-blue-50 text-[11px] font-bold transition-colors"
              >
                Reconectar com permissões de Ads
              </a>
            </div>
          ) : null}

          {(config.meta_ads_token || config.meta_access_token) && (
            <div className="mt-4 space-y-4">
              {metaPaginaSalva && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-2xl px-4 py-3">
                  <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                  <div>
                    <p className="text-[11px] font-bold text-green-700">{metaPaginaSalva.name}</p>
                    {metaPaginaSalva.adAccountId && (
                      <p className="text-[10px] text-green-600">{metaPaginaSalva.adAccountId}</p>
                    )}
                  </div>
                </div>
              )}

              {metaAdsError && (
                <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3 space-y-2">
                  <p className="text-[11px] text-red-600">{metaAdsError}</p>
                  {metaAdsError.toLowerCase().includes("não conectado") && (
                    <a
                      href="/api/meta/connect"
                      className="flex items-center justify-center gap-2 w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold transition-colors mt-1"
                    >
                      <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white">
                        <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.885v2.27h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
                      </svg>
                      Reconectar com Facebook
                    </a>
                  )}
                </div>
              )}

              {metaPaginas.length === 0 && !metaAdsLoading && (
                <button
                  type="button"
                  onClick={carregarMetaAds}
                  className="w-full py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold transition-colors flex items-center justify-center gap-2"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-white">
                    <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.885v2.27h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
                  </svg>
                  Carregar minhas páginas do Facebook
                </button>
              )}

              {metaAdsLoading && (
                <div className="flex items-center justify-center py-4 gap-2 text-gray-400">
                  <Loader2 size={14} className="animate-spin" />
                  <span className="text-[11px]">Carregando páginas...</span>
                </div>
              )}

              {metaPaginas.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Página do Facebook</p>
                    <select
                      value={selectedPageId}
                      onChange={(e) => setSelectedPageId(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-[12px] text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      {metaPaginas.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Conta de Anúncios (Ad Account)</p>
                    {metaAdAccounts.length > 0 ? (
                      <select
                        value={selectedAdAccountId}
                        onChange={(e) => setSelectedAdAccountId(e.target.value)}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-[12px] text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                      >
                        <option value="">— Nenhuma —</option>
                        {metaAdAccounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-[11px] text-gray-400 italic">
                        Nenhuma conta de anúncios encontrada. Crie uma em business.facebook.com.
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={salvarPaginaMeta}
                    disabled={metaAdsSaving || !selectedPageId}
                    className="w-full py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-[11px] font-bold transition-colors flex items-center justify-center gap-2"
                  >
                    {metaAdsSaving ? (
                      <><Loader2 size={13} className="animate-spin" /> Salvando...</>
                    ) : metaAdsSaved ? (
                      <><CheckCircle2 size={13} /> Página salva!</>
                    ) : (
                      "Salvar configuração"
                    )}
                  </button>
                </div>
              )}

              <div className="pt-2 border-t border-gray-100">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">O que você ganha</p>
                <div className="space-y-1.5">
                  {[
                    "Cria campanha Lead Ad direto da página do veículo",
                    "Controla orçamento, raio e público sem sair do AutoZap",
                    "Lead chega automático e a IA responde pelo WhatsApp",
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-blue-600 text-[9px] font-black">{i + 1}</span>
                      </div>
                      <p className="text-[11px] text-gray-600">{item}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        </> /* fim aba whatsapp */ }

      </div>
    </main>
  );
}
