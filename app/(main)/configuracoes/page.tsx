"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Upload, CheckCircle2, Loader2, ImageIcon, Trash2, Sparkles, FileImage, Save, Copy, Eye, EyeOff, FileText, ShieldCheck, PauseCircle, PlayCircle, Palette, Globe, ExternalLink, Mic, Play, QrCode } from "lucide-react";
import { supabase } from "@/lib/supabase";

declare global {
  interface Window {
    fbAsyncInit: () => void;
    FB: any;
  }
}

type Mode = "auto" | "manual";

interface VitrineTema {
  cor_primaria?: string;
  cor_secundaria?: string;
  capa_url?: string;
  logo_url?: string;
  tagline?: string;
  sobre?: string;
  tema?: "claro" | "escuro";
}

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
  whatsapp_financeiro?: string;
  whatsapp_posvenda?: string;
  whatsapp_agente?: string;
  logo_url: string | null;
  vitrine_slug?: string;
  meta_phone_id?: string;
  meta_access_token?: string;
  meta_ads_token?: string;
  avisa_base_url?: string;
  avisa_token?: string;
  voz_habilitada?: boolean;
  voz_politica?: "espelho" | "espelho_e_saudacao";
  voz_id?: string | null;
  nome_usuario?: string;
  cargo_usuario?: string;
  tom_venda?: string;
  instrucoes_adicionais?: string;
  horario_funcionamento?: string;
  oferta_especial?: string;
  telefone_loja?: string;
  webmotors_usuario?: string;
  webmotors_senha?: string;
  nf_cep?: string;
  repasse_grupo_jid?: string | null;
  repasse_grupo_nome?: string | null;
  repasse_grupos?: { jid: string; nome: string | null }[];
  repasse_auto_ativo?: boolean;
  repasse_intervalo_min?: number;
  repasse_qtd_por_envio?: number;
  repasse_janela_inicio?: number;
  repasse_janela_fim?: number;
  repasse_janela_fim_sabado?: number;
  repasse_bomdia_ativo?: boolean;
  repasse_link_comunidade?: string;
  repasse_link_instagram?: string;
  repasse_bomdia_logo_url?: string | null;
  vitrine_tema?: VitrineTema;
  dominio_custom?: string | null;
}

// Extrai a cor dominante de uma imagem (ex: logo) via canvas, client-side.
// Ignora pixels quase-transparentes, quase-brancos e quase-pretos (fundo/contorno)
// pra tentar pegar a cor "de marca". Se o canvas ficar tainted por CORS, falha
// silenciosamente (é só uma sugestão de UI, nunca bloqueia o fluxo).
function extractDominantColor(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const size = 40;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0, size, size);
          const { data } = ctx.getImageData(0, 0, size, size);
          const counts: Record<string, number> = {};
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
            if (a < 200) continue;
            const brightness = (r + g + b) / 3;
            if (brightness > 235 || brightness < 20) continue;
            const key = `${Math.round(r / 16) * 16},${Math.round(g / 16) * 16},${Math.round(b / 16) * 16}`;
            counts[key] = (counts[key] || 0) + 1;
          }
          const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
          if (sorted.length === 0) return resolve(null);
          const [r, g, b] = sorted[0][0].split(",").map(Number);
          const hex = "#" + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
          resolve(hex);
        } catch {
          resolve(null); // canvas tainted (CORS) — ignora, é só sugestão
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    } catch {
      resolve(null);
    }
  });
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
  const [mlConectado, setMlConectado]   = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const searchParams = useSearchParams();
  const router = useRouter();
  const [copied, setCopied] = useState<string | null>(null);
  const [metaConnecting, setMetaConnecting] = useState(false);
  const [metaConnected, setMetaConnected] = useState(false);

  // Webmotors
  const [showWmSenha, setShowWmSenha] = useState(false);
  const [savingWm, setSavingWm] = useState(false);
  const [savedWm, setSavedWm] = useState(false);

  // WhatsApp / Avisa
  const [showAvisaToken, setShowAvisaToken] = useState(false);
  const [showMetaToken, setShowMetaToken] = useState(false);
  const [savingWa, setSavingWa] = useState(false);
  const [savedWa, setSavedWa] = useState(false);
  const [agentePausado, setAgentePausado] = useState(false);
  const [togglingPausa, setTogglingPausa] = useState(false);

  // Conexão da instância Avisa (QR de pareamento)
  type SessaoEstado = "conectado" | "sem_sessao" | "token_invalido" | "indisponivel" | "sem_credenciais";
  const [sessaoEstado, setSessaoEstado] = useState<SessaoEstado | null>(null);
  const [sessaoJid, setSessaoJid] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrSegundos, setQrSegundos] = useState(0);
  const [gerandoQr, setGerandoQr] = useState(false);
  const [qrErro, setQrErro] = useState<{ motivo: string; detalhe: string } | null>(null);

  // Facebook Ads — conectar página + ad account
  const [metaAdsLoading, setMetaAdsLoading] = useState(false);
  const [metaAdsSaving, setMetaAdsSaving] = useState(false);
  const [metaAdsSaved, setMetaAdsSaved] = useState(false);
  const [metaAdsError, setMetaAdsError] = useState<string | null>(null);
  const [metaPaginas, setMetaPaginas] = useState<any[]>([]);
  const [metaAdAccounts, setMetaAdAccounts] = useState<any[]>([]);
  const [metaCarregado, setMetaCarregado] = useState(false);
  const [metaPaginaSalva, setMetaPaginaSalva] = useState<any | null>(null);
  const [selectedPageId, setSelectedPageId] = useState("");
  const [selectedAdAccountId, setSelectedAdAccountId] = useState("");
  const [desvinculandoMeta, setDesvinculandoMeta] = useState(false);
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
    whatsapp_financeiro: "",
    whatsapp_posvenda: "",
    whatsapp_agente: "",
    vitrine_slug: "",
    logo_url: null,
    meta_phone_id: "",
    meta_access_token: "",
    meta_ads_token: "",
    avisa_base_url: "",
    avisa_token: "",
    voz_habilitada: false,
    voz_politica: "espelho",
    voz_id: null,
    nome_usuario: "",
    cargo_usuario: "",
    tom_venda: "",
    instrucoes_adicionais: "",
    horario_funcionamento: "",
    oferta_especial: "",
    telefone_loja: "",
    repasse_grupo_jid: null,
    repasse_grupo_nome: null,
    repasse_grupos: [],
    repasse_auto_ativo: false,
    repasse_intervalo_min: 120,
    repasse_qtd_por_envio: 1,
    repasse_janela_inicio: 8,
    repasse_janela_fim: 18,
    repasse_janela_fim_sabado: 12,
    repasse_bomdia_ativo: true,
    repasse_link_comunidade: "",
    repasse_link_instagram: "",
    repasse_bomdia_logo_url: null,
    vitrine_tema: {},
    dominio_custom: "",
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const bomdiaLogoRef = useRef<HTMLInputElement>(null);
  const [uploadingBomdiaLogo, setUploadingBomdiaLogo] = useState(false);
  const capaRef = useRef<HTMLInputElement>(null);
  const [uploadingCapa, setUploadingCapa] = useState(false);
  const vitrineLogoRef = useRef<HTMLInputElement>(null);
  const [uploadingVitrineLogo, setUploadingVitrineLogo] = useState(false);
  const colorExtractAttempted = useRef(false);

  const handleUploadCapa = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCapa(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/vitrine/capa", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha no upload");
      const url = `${data.url}?t=${Date.now()}`;
      setConfig(c => ({ ...c, vitrine_tema: { ...c.vitrine_tema, capa_url: url } }));
    } catch (err: any) {
      alert("Erro ao subir capa: " + err.message);
    } finally {
      setUploadingCapa(false);
      if (capaRef.current) capaRef.current.value = "";
    }
  };

  const handleUploadVitrineLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingVitrineLogo(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/vitrine/logo", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha no upload");
      const url = `${data.url}?t=${Date.now()}`;
      setConfig(c => ({ ...c, vitrine_tema: { ...c.vitrine_tema, logo_url: url } }));
    } catch (err: any) {
      alert("Erro ao subir logo: " + err.message);
    } finally {
      setUploadingVitrineLogo(false);
      if (vitrineLogoRef.current) vitrineLogoRef.current.value = "";
    }
  };

  const handleUploadBomdiaLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingBomdiaLogo(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("tipo", "bomdia");
      const res = await fetch("/api/configuracoes/logo", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha no upload");
      const url = `${data.url}?t=${Date.now()}`;
      await supabase.from("config_garage").update({ repasse_bomdia_logo_url: url }).eq("id", config.id!);
      setConfig(c => ({ ...c, repasse_bomdia_logo_url: url }));
    } catch (err: any) {
      alert("Erro ao subir logo do bom dia: " + err.message);
    } finally {
      setUploadingBomdiaLogo(false);
      if (bomdiaLogoRef.current) bomdiaLogoRef.current.value = "";
    }
  };

  const handleRemoveBomdiaLogo = async () => {
    await supabase.from("config_garage").update({ repasse_bomdia_logo_url: null }).eq("id", config.id!);
    setConfig(c => ({ ...c, repasse_bomdia_logo_url: null }));
  };
  const pfxRef = useRef<HTMLInputElement>(null);
  // Sincronização de grupos do Repasse (GET/POST /api/repasse/grupos)
  const [gruposDisponiveis, setGruposDisponiveis] = useState<{ jid: string; name: string }[] | null>(null);
  const [grupoSelecionado, setGrupoSelecionado] = useState<string>("");
  const [sincronizandoGrupos, setSincronizandoGrupos] = useState(false);
  const [vinculandoGrupo, setVinculandoGrupo] = useState(false);
  const [erroGrupos, setErroGrupos] = useState<string>("");

  const sincronizarGrupos = async () => {
    setSincronizandoGrupos(true);
    setErroGrupos("");
    try {
      const res = await fetch("/api/repasse/grupos");
      const data = await res.json();
      if (!res.ok) {
        setErroGrupos(data.error || "Erro ao sincronizar grupos.");
        setGruposDisponiveis(null);
      } else {
        setGruposDisponiveis(data.grupos ?? []);
        if ((data.grupos ?? []).length === 0) {
          setErroGrupos("Nenhum grupo encontrado. Adicione o número do agente a um grupo/comunidade primeiro.");
        }
      }
    } catch {
      setErroGrupos("Erro de rede ao sincronizar grupos.");
    } finally {
      setSincronizandoGrupos(false);
    }
  };

  // Vincula MAIS UM grupo (múltiplos desde a migration 021) — a API devolve a
  // lista completa atualizada e mantém os campos legados espelhando o 1º item.
  const vincularGrupo = async (jid: string) => {
    setVinculandoGrupo(true);
    setErroGrupos("");
    try {
      const nome = gruposDisponiveis?.find(g => g.jid === jid)?.name ?? null;
      const res = await fetch("/api/repasse/grupos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grupoJid: jid, grupoNome: nome }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErroGrupos(data.error || "Erro ao vincular grupo.");
      } else {
        const grupos = data.grupos ?? [];
        setConfig(c => ({
          ...c,
          repasse_grupos: grupos,
          repasse_grupo_jid: grupos[0]?.jid ?? null,
          repasse_grupo_nome: grupos[0]?.nome ?? null,
        }));
        setGrupoSelecionado("");
      }
    } catch {
      setErroGrupos("Erro de rede ao vincular grupo.");
    } finally {
      setVinculandoGrupo(false);
    }
  };

  const desvincularGrupo = async (jid: string) => {
    setVinculandoGrupo(true);
    setErroGrupos("");
    try {
      const res = await fetch(`/api/repasse/grupos?jid=${encodeURIComponent(jid)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setErroGrupos(data.error || "Erro ao desvincular grupo.");
      } else {
        const grupos = data.grupos ?? [];
        setConfig(c => ({
          ...c,
          repasse_grupos: grupos,
          repasse_grupo_jid: grupos[0]?.jid ?? null,
          repasse_grupo_nome: grupos[0]?.nome ?? null,
        }));
      }
    } catch {
      setErroGrupos("Erro de rede ao desvincular grupo.");
    } finally {
      setVinculandoGrupo(false);
    }
  };
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

  type Tab = "loja" | "whatsapp" | "portais" | "fiscal";
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
        // v19.0 saiu do suporte (Graph API dura ~2 anos); o Embedded Signup atual
        // pressupõe versão corrente. Manter alinhado com o exchange server-side.
        version: "v23.0",
      });
    };
    const script = document.createElement("script");
    script.id = "facebook-sdk";
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  };

  // Instante do FINISH do Embedded Signup — usado pra medir a idade do code.
  const sessionFinishAtRef = useRef<number | null>(null);

  useEffect(() => {
    // Recebe phone_number_id do popup do Embedded Signup
    const handleMessage = (event: MessageEvent) => {
      // O SDK posta de www.facebook.com, mas versões do fluxo usam outros subdomínios
      // (web.facebook.com, business.facebook.com). Aceitar o domínio inteiro — origem
      // continua verificada, só deixou de ser um host só.
      if (!/^https:\/\/([a-z-]+\.)*facebook\.com$/.test(event.origin)) return;
      try {
        const data = JSON.parse(event.data);
        // Diagnóstico do Embedded Signup: sem isso não dá pra saber se o fluxo chegou
        // ao FINISH ou morreu no meio (CANCEL/erro), que é o que decide se o code
        // nasce válido. Só loga eventos do próprio ES.
        if (data?.type === "WA_EMBEDDED_SIGNUP") {
          console.log("[ES]", event.origin, data.event, JSON.stringify(data.data ?? {}).slice(0, 200));
        }
        // "FINISH" = onboarding normal (número novo Cloud API)
        // "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" = COEXISTÊNCIA (número que já roda
        // no WhatsApp Business App do celular; app + API juntos). Ambos trazem
        // phone_number_id em data.data; a coexistência também traz waba_id.
        if (
          data.type === "WA_EMBEDDED_SIGNUP" &&
          (data.event === "FINISH" || data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING")
        ) {
          // Marca QUANDO o fluxo terminou. O code do Embedded Signup vive ~30s, mas o
          // callback do FB.login só dispara quando o popup fecha — se o usuário demora
          // pra fechar a tela final, o code chega morto e a troca dá 100/36008.
          sessionFinishAtRef.current = Date.now();
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

    // GUARDA: sem config_id o FB.login degrada pro Facebook Login CLÁSSICO — o code
    // que volta não é de Login for Business e a troca server-side falha SEMPRE com
    // 100/36008 ("redirect_uri must be identical"), porque o diálogo usou o redirect
    // interno do SDK (staticxx/xd_arbiter), impossível de reproduzir na troca.
    // Falhar aqui, explícito, em vez de abrir um fluxo que nunca conclui.
    const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID;
    if (!configId) {
      alert(
        "Configuração do Embedded Signup ausente (NEXT_PUBLIC_META_CONFIG_ID não chegou no build).\n\n" +
        "Sem ela o Facebook abre o login comum e a troca do código falha com o erro 36008. " +
        "Confira a env na Vercel e faça um redeploy (env NEXT_PUBLIC_ só entra em build novo).",
      );
      return;
    }

    setMetaConnecting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setMetaConnecting(false); return; }

    const redirectUri = `${window.location.origin}/configuracoes`;

    // O SDK do Facebook rejeita callback async ("Expression is of type
    // asyncfunction, not function"). Callback normal + IIFE async dentro.
    window.FB.login(
      (response: any) => {
        // status "connected" sem ter passado pelo FINISH = o usuário só reautorizou o
        // app, não completou o Embedded Signup — o code sai sem sessão de onboarding.
        console.log("[ES] FB.login callback", response?.status, "finishRecebido=", sessionFinishAtRef.current !== null);
        const code = response.authResponse?.code;
        if (!code) { setMetaConnecting(false); return; }
        // Idade do code: do FINISH do fluxo até agora. Se passar dos ~30s de TTL,
        // a Meta recusa a troca com 36008 mesmo estando tudo certo.
        const codeAgeMs = sessionFinishAtRef.current ? Date.now() - sessionFinishAtRef.current : null;
        sessionFinishAtRef.current = null;
        void (async () => {
          try {
            const res = await fetch("/api/auth/meta/exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              // configId/appId/codeAgeMs vão só pra diagnóstico server-side: confirmam
              // o config_id, o app usado pelo browser e a idade do code.
              body: JSON.stringify({ code, redirectUri, configId, codeAgeMs, appId: process.env.NEXT_PUBLIC_META_APP_ID }),
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
        })();
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          // Coexistência: conecta o número que JÁ roda no WhatsApp Business App do
          // celular (app + Cloud API juntos, histórico sincronizado). Sem isso, o
          // fluxo pediria um número novo/migração. sessionInfoVersion "3" é exigido.
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
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
      const { salvas, paginas, adAccounts, error: apiErr } = await res.json();
      if (apiErr) { setMetaAdsError(apiErr); return; }
      setMetaPaginas(paginas ?? []);
      setMetaAdAccounts(adAccounts ?? []);
      if (paginas?.length) setSelectedPageId(paginas[0].id);
      if (adAccounts?.length) setSelectedAdAccountId(adAccounts[0].id);
      // Restaura página salva no banco caso metaPaginaSalva ainda não esteja preenchido
      if (salvas?.length) {
        setMetaPaginaSalva({ name: salvas[0].page_name, adAccountId: salvas[0].ad_account_id });
      }
      setMetaCarregado(true);
    } catch {
      setMetaAdsError("Erro de conexão");
    } finally {
      setMetaAdsLoading(false);
    }
  };

  const desvincularMetaAds = async () => {
    if (!confirm("Desvincular o Meta Ads? As campanhas já criadas continuam na Meta, mas você precisará reconectar a conta para publicar novos anúncios. (Seu WhatsApp não é afetado.)")) return;
    setDesvinculandoMeta(true);
    try {
      const res = await fetch("/api/meta/pagina", { method: "DELETE" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setMetaAdsError(e.error ?? "Erro ao desvincular");
        return;
      }
      // Reseta todo o estado do Meta Ads
      setConfig((c) => ({ ...c, meta_ads_token: "" }));
      setMetaPaginas([]);
      setMetaAdAccounts([]);
      setMetaPaginaSalva(null);
      setMetaCarregado(false);
      setSelectedPageId("");
      setSelectedAdAccountId("");
      setMetaAdsError(null);
    } catch {
      setMetaAdsError("Erro de conexão ao desvincular");
    } finally {
      setDesvinculandoMeta(false);
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
            if (row.ml_access_token)  setMlConectado(true);
            if (row.plano) setPlano(row.plano);
            setAgentePausado(row.agente_pausado ?? false);
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
              whatsapp_financeiro: row.whatsapp_financeiro ?? "",
              whatsapp_posvenda: row.whatsapp_posvenda ?? "",
              whatsapp_agente: row.whatsapp_agente ?? "",
              vitrine_slug: row.vitrine_slug ?? "",
              logo_url: row.logo_url ?? null,
              meta_phone_id: row.meta_phone_id ?? "",
              meta_access_token: row.meta_access_token ?? "",
              meta_ads_token: row.meta_ads_token ?? "",
              avisa_base_url: row.avisa_base_url ?? "",
              avisa_token: row.avisa_token ?? "",
              voz_habilitada: row.voz_habilitada ?? false,
              voz_politica: row.voz_politica ?? "espelho",
              voz_id: row.voz_id ?? null,
              nome_usuario: row.nome_usuario ?? "",
              cargo_usuario: row.cargo_usuario ?? "",
              tom_venda: row.tom_venda ?? "",
              instrucoes_adicionais: row.instrucoes_adicionais ?? "",
              horario_funcionamento: row.horario_funcionamento ?? "",
              oferta_especial: row.oferta_especial ?? "",
              telefone_loja: row.telefone_loja ?? "",
              webmotors_usuario: row.webmotors_usuario ?? "",
              webmotors_senha:   row.webmotors_senha   ?? "",
              nf_cep:            row.nf_cep            ?? "",
              repasse_grupo_jid:    row.repasse_grupo_jid    ?? null,
              repasse_grupo_nome:   row.repasse_grupo_nome   ?? null,
              // Fallback legado: tenant que nunca re-salvou depois da migration 021
              repasse_grupos: (Array.isArray(row.repasse_grupos) && row.repasse_grupos.length > 0)
                ? row.repasse_grupos
                : (row.repasse_grupo_jid ? [{ jid: row.repasse_grupo_jid, nome: row.repasse_grupo_nome ?? null }] : []),
              repasse_auto_ativo:   row.repasse_auto_ativo   ?? false,
              repasse_intervalo_min: row.repasse_intervalo_min ?? 120,
              repasse_qtd_por_envio: row.repasse_qtd_por_envio ?? 1,
              repasse_janela_inicio: row.repasse_janela_inicio ?? 8,
              repasse_janela_fim:    row.repasse_janela_fim    ?? 18,
              repasse_janela_fim_sabado: row.repasse_janela_fim_sabado ?? 12,
              repasse_bomdia_ativo: row.repasse_bomdia_ativo ?? true,
              repasse_link_comunidade: row.repasse_link_comunidade ?? "",
              repasse_link_instagram: row.repasse_link_instagram ?? "",
              repasse_bomdia_logo_url: row.repasse_bomdia_logo_url ?? null,
              vitrine_tema: row.vitrine_tema ?? {},
              dominio_custom: row.dominio_custom ?? "",
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

  // Auto-carrega páginas + limpa URL após OAuth bem-sucedido (?meta_ads_ok=1)
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (searchParams.get("meta_ads_ok") !== "1") return;
    if (autoLoadedRef.current) return;
    if (!config.meta_ads_token && !config.meta_access_token) return;
    autoLoadedRef.current = true;
    carregarMetaAds();
    // Remove o param da URL para não persistir o banner no F5
    router.replace("/configuracoes");
  }, [config.meta_ads_token, config.meta_access_token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sugere cor primária da vitrine a partir da logo já cadastrada (só se ainda
  // não houver cor salva). Tentativa única — falha silenciosa (CORS/tainted canvas).
  useEffect(() => {
    if (colorExtractAttempted.current) return;
    if (!currentLogo) return;
    if (config.vitrine_tema?.cor_primaria) { colorExtractAttempted.current = true; return; }
    colorExtractAttempted.current = true;
    extractDominantColor(currentLogo).then(hex => {
      if (!hex) return;
      setConfig(c => (c.vitrine_tema?.cor_primaria ? c : { ...c, vitrine_tema: { ...c.vitrine_tema, cor_primaria: hex } }));
    });
  }, [currentLogo, config.vitrine_tema?.cor_primaria]);

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

  const handleSaveWm = async () => {
    setSavingWm(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");
      const { error } = await supabase
        .from("config_garage")
        .upsert(
          {
            ...(config.id ? { id: config.id } : {}),
            user_id: user.id,
            webmotors_usuario: config.webmotors_usuario || null,
            webmotors_senha:   config.webmotors_senha   || null,
          },
          { onConflict: "user_id" }
        );
      if (error) throw error;
      setSavedWm(true);
      setTimeout(() => setSavedWm(false), 3000);
    } catch (err: any) {
      alert("Erro ao salvar: " + err.message);
    } finally {
      setSavingWm(false);
    }
  };

  // Amostra da voz. Sem isso o tenant liga a feature às cegas e só descobre como
  // soa quando um cliente real recebe.
  const [carregandoAmostra, setCarregandoAmostra] = useState(false);
  const ouvirAmostraVoz = async () => {
    setCarregandoAmostra(true);
    try {
      const res = await fetch("/api/voz/preview", { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Não consegui gerar a amostra");
      }
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCarregandoAmostra(false);
    }
  };

  // ── Conexão da instância Avisa ──────────────────────────────────────────────
  // Só o STATUS é pollado. O QR NUNCA se auto-renova: cada pedido inicia uma
  // sessão nova na Avisa e repetir em rajada prende a instância em
  // Connected-sem-login, estado que só o painel da Avisa destrava.
  const carregarSessaoAvisa = async () => {
    try {
      const r = await fetch("/api/avisa/sessao");
      const j = await r.json();
      setSessaoEstado(j.configurado ? j.estado : "sem_credenciais");
      setSessaoJid(j.jid ?? null);
      if (j.estado === "conectado") {
        setQrDataUrl(null);   // conectou: o QR na tela perdeu a validade
        setQrSegundos(0);
        setQrErro(null);
      }
    } catch {
      setSessaoEstado("indisponivel");
    }
  };

  const gerarQrAvisa = async () => {
    setGerandoQr(true);
    setQrErro(null);
    try {
      const r = await fetch("/api/avisa/sessao", { method: "POST" });
      const j = await r.json();
      if (j.ok) {
        setQrDataUrl(j.qrcodeDataUrl);
        setQrSegundos(60);        // validade real do QR do WhatsApp
      } else {
        setQrDataUrl(null);
        setQrErro({ motivo: j.motivo ?? "erro", detalhe: j.detalhe ?? "" });
        if (j.motivo === "ja_conectado") carregarSessaoAvisa();
      }
    } catch (e: any) {
      setQrErro({ motivo: "erro", detalhe: e?.message ?? "falha de rede" });
    } finally {
      setGerandoQr(false);
    }
  };

  // Status a cada 5s enquanto a aba WhatsApp está aberta (chamada barata, não
  // inicia sessão) — é assim que a tela percebe sozinha que o QR foi lido.
  useEffect(() => {
    if (activeTab !== "whatsapp") return;
    carregarSessaoAvisa();
    const id = setInterval(carregarSessaoAvisa, 5000);
    return () => clearInterval(id);
  }, [activeTab]);

  // Contagem regressiva do QR. Ao zerar, o QR sai da tela e o usuário decide se
  // gera outro — nada de renovar sozinho.
  useEffect(() => {
    if (qrSegundos <= 0) return;
    const id = setTimeout(() => setQrSegundos(s => s - 1), 1000);
    return () => clearTimeout(id);
  }, [qrSegundos]);

  const handleSaveWhatsapp = async () => {
    setSavingWa(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");
      const { error } = await supabase
        .from("config_garage")
        .upsert(
          {
            ...(config.id ? { id: config.id } : {}),
            user_id: user.id,
            avisa_base_url: config.avisa_base_url || null,
            avisa_token: config.avisa_token || null,
            meta_phone_id: config.meta_phone_id || null,
            meta_access_token: config.meta_access_token || null,
            voz_habilitada: !!config.voz_habilitada,
            voz_politica: config.voz_politica || "espelho",
            // Config do repasse em comunidade agora vive na página "Fluxo Grupo"
            // (salva por lá). Não gravar aqui pra não sobrescrever com valor stale.
          },
          { onConflict: "user_id" }
        );
      if (error) throw error;

      // Conecta o webhook da Avisa automaticamente quando há credenciais.
      // Sem isso, a Avisa não repassa as mensagens recebidas ao AutoZap.
      if (config.avisa_base_url && config.avisa_token) {
        const res = await fetch("/api/configuracoes/avisa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            avisa_base_url: config.avisa_base_url,
            avisa_token: config.avisa_token,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Falha ao conectar o webhook da Avisa");
        if (data.webhookToken) setWebhookToken(data.webhookToken);
        if (data.webhookConfigured === false) {
          // Credenciais salvas, mas a Avisa recusou o webhook (token inválido?)
          alert(
            "Token salvo, mas não consegui conectar o webhook na Avisa:\n" +
            (data.webhookError || "verifique se o token está correto e a instância conectada.")
          );
          return; // não marca como sucesso pleno
        }
      }

      setSavedWa(true);
      setTimeout(() => setSavedWa(false), 3000);
    } catch (err: any) {
      alert("Erro ao salvar: " + err.message);
    } finally {
      setSavingWa(false);
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
            whatsapp_financeiro: config.whatsapp_financeiro || null,
            whatsapp_posvenda: config.whatsapp_posvenda || null,
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
            telefone_loja:        config.telefone_loja        || null,
            webmotors_usuario:    config.webmotors_usuario    || null,
            webmotors_senha:      config.webmotors_senha      || null,
            nf_cep:               config.nf_cep               || null,
            vitrine_tema:         config.vitrine_tema && Object.keys(config.vitrine_tema).length > 0
                                     ? config.vitrine_tema
                                     : null,
            dominio_custom:       config.dominio_custom || null,
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

  const handleTogglePausa = async () => {
    setTogglingPausa(true);
    const novoValor = !agentePausado;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");
      const { error } = await supabase
        .from("config_garage")
        .update({ agente_pausado: novoValor })
        .eq("user_id", user.id);
      if (error) throw error;
      setAgentePausado(novoValor);
    } catch (err: any) {
      alert("Erro ao alterar pausa: " + err.message);
    } finally {
      setTogglingPausa(false);
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
        {(["loja","whatsapp","portais","fiscal"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap ${
              activeTab === tab
                ? "bg-gray-900 text-white shadow"
                : "text-gray-400 hover:text-gray-700"
            }`}
          >
            {{ loja: "Minha Loja", whatsapp: "WhatsApp", portais: "Portais de Anúncio", fiscal: "Fiscal" }[tab]}
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
                Nome da Vitrine <span className="text-gray-400 normal-case font-normal">(slug da URL pública)</span>
              </label>
              <div className="flex items-center bg-[#f5f5f3] border border-gray-200 rounded-xl overflow-hidden focus-within:border-red-500 focus-within:ring-1 focus-within:ring-red-500 transition">
                <span className="px-3 text-xs text-gray-400 font-semibold whitespace-nowrap border-r border-gray-200 py-2.5">autozap.digital/vitrine/</span>
                <input
                  type="text"
                  value={config.vitrine_slug ?? ""}
                  onChange={e => setConfig(c => ({ ...c, vitrine_slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                  placeholder="minha-loja"
                  className="flex-1 bg-transparent px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
                />
              </div>
              <p className="text-[9px] text-gray-400 mt-0.5">
                Usado no QR code da tag de pátio e na vitrine pública. Só letras minúsculas, números e hífens.
              </p>
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

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                WhatsApp Financeiro
              </label>
              <input
                type="text"
                value={config.whatsapp_financeiro ?? ""}
                onChange={e => setConfig(c => ({ ...c, whatsapp_financeiro: e.target.value }))}
                placeholder="5517999999999 (opcional)"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
              <p className="text-[9px] text-gray-400 mt-0.5">
                Se vazio, os alertas desse assunto vão para o WhatsApp do gerente.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                WhatsApp Pós-venda
              </label>
              <input
                type="text"
                value={config.whatsapp_posvenda ?? ""}
                onChange={e => setConfig(c => ({ ...c, whatsapp_posvenda: e.target.value }))}
                placeholder="5517999999999 (opcional)"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
              <p className="text-[9px] text-gray-400 mt-0.5">
                Se vazio, os alertas desse assunto vão para o WhatsApp do gerente.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Telefone Fixo / Ramal da Loja
              </label>
              <input
                type="text"
                value={config.telefone_loja || ""}
                onChange={e => setConfig(c => ({ ...c, telefone_loja: e.target.value }))}
                placeholder="Ex: (17) 3322-1010"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
              <p className="text-[9px] text-gray-400 mt-0.5">
                A IA responde com este número quando o cliente pedir para ligar.
              </p>
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

        {/* ══ ABA: WHATSAPP ════════════════════════════════════════════════════ */}
        {activeTab === "whatsapp" && <>

        {/* ── Avisa API ── */}
        <div className={`bg-white rounded-[2rem] border shadow-sm p-8 transition-colors ${agentePausado ? "border-amber-200" : "border-gray-100"}`}>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-xl bg-green-50 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-green-600">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-900">Avisa API</h2>
              <p className="text-[10px] text-gray-400">Conexão com WhatsApp via Baileys (sem Meta Cloud API)</p>
            </div>
            {/* Toggle pausa do agente */}
            <button
              type="button"
              onClick={handleTogglePausa}
              disabled={togglingPausa}
              title={agentePausado ? "Agente pausado — clique para reativar" : "Agente ativo — clique para pausar"}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                agentePausado
                  ? "bg-amber-100 text-amber-700 hover:bg-amber-200 border border-amber-300"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-200"
              }`}
            >
              {togglingPausa ? (
                <Loader2 size={13} className="animate-spin" />
              ) : agentePausado ? (
                <><PauseCircle size={13} /> Pausado</>
              ) : (
                <><PlayCircle size={13} /> Ativo</>
              )}
            </button>
          </div>

          {agentePausado && (
            <div className="mt-3 mb-1 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-2">
              <PauseCircle size={14} className="text-amber-500 shrink-0" />
              <p className="text-[10px] text-amber-700 font-semibold">
                Agente pausado — mensagens recebidas não serão respondidas pela IA até você reativar.
              </p>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                URL Base da API
              </label>
              <input
                type="text"
                value={config.avisa_base_url ?? ""}
                onChange={e => setConfig(c => ({ ...c, avisa_base_url: e.target.value }))}
                placeholder="Ex: https://api.avisa.app/v1"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition font-mono"
              />
              <p className="text-[10px] text-gray-400">URL raiz da instância Avisa. Inclua o protocolo https://</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Token da API
              </label>
              <div className="relative">
                <input
                  type={showAvisaToken ? "text" : "password"}
                  value={config.avisa_token ?? ""}
                  onChange={e => setConfig(c => ({ ...c, avisa_token: e.target.value }))}
                  placeholder="Bearer token da instância"
                  className="w-full bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition font-mono"
                />
                <button type="button" onClick={() => setShowAvisaToken(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors">
                  {showAvisaToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Conexão do WhatsApp (QR da Avisa) ── */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">
          <div className="flex items-center justify-between gap-3 mb-1">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-green-50 flex items-center justify-center">
                <QrCode size={16} className="text-green-600" />
              </div>
              <div>
                <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-900">Conexão do WhatsApp</h2>
                <p className="text-[10px] text-gray-400">Pareie o celular da loja lendo o QR Code</p>
              </div>
            </div>

            {sessaoEstado && (
              <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full ${
                sessaoEstado === "conectado" ? "bg-green-50 text-green-700"
                : sessaoEstado === "sem_credenciais" ? "bg-gray-100 text-gray-500"
                : sessaoEstado === "indisponivel" ? "bg-gray-100 text-gray-500"
                : "bg-red-50 text-red-600"}`}>
                {sessaoEstado === "conectado" ? "Conectado"
                  : sessaoEstado === "sem_sessao" ? "Desconectado"
                  : sessaoEstado === "token_invalido" ? "Token inválido"
                  : sessaoEstado === "sem_credenciais" ? "Não configurado"
                  : "Indisponível"}
              </span>
            )}
          </div>

          {sessaoEstado === "conectado" && (
            <div className="mt-5 px-4 py-3 bg-green-50 border border-green-200 rounded-2xl flex items-center gap-2">
              <CheckCircle2 size={14} className="text-green-600 shrink-0" />
              <p className="text-[11px] text-green-800 font-semibold">
                WhatsApp conectado{sessaoJid ? ` — ${sessaoJid.split(":")[0].split("@")[0]}` : ""}. Não precisa fazer nada.
              </p>
            </div>
          )}

          {sessaoEstado === "sem_credenciais" && (
            <p className="mt-5 text-[11px] text-gray-500">
              Preencha a URL base e o token da Avisa acima, salve, e o botão de conectar aparece aqui.
            </p>
          )}

          {sessaoEstado && sessaoEstado !== "conectado" && sessaoEstado !== "sem_credenciais" && (
            <div className="mt-5 flex flex-col gap-4">
              {qrDataUrl && qrSegundos > 0 ? (
                <div className="flex flex-col items-center gap-3">
                  {/* O PNG da Avisa vem 256x256 e 1 bit, sem margem: pixelated + padding
                      branco é o que faz a câmera enxergar. */}
                  <div className="bg-white p-5 rounded-2xl border border-gray-200">
                    <img
                      src={qrDataUrl}
                      alt="QR Code para conectar o WhatsApp"
                      width={288}
                      height={288}
                      style={{ imageRendering: "pixelated" }}
                      className="w-72 h-72 block"
                    />
                  </div>
                  <p className="text-[11px] text-gray-600 font-semibold text-center">
                    No celular: WhatsApp → Aparelhos conectados → Conectar aparelho
                  </p>
                  <p className="text-[10px] text-gray-400">expira em {qrSegundos}s</p>
                </div>
              ) : (
                <button
                  onClick={gerarQrAvisa}
                  disabled={gerandoQr}
                  className="self-start flex items-center gap-2 px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-[11px] font-black uppercase tracking-widest transition"
                >
                  {gerandoQr ? <Loader2 size={13} className="animate-spin" /> : <QrCode size={13} />}
                  {qrDataUrl ? "Gerar novo QR Code" : "Conectar WhatsApp"}
                </button>
              )}

              {qrErro && (
                <div className={`px-4 py-3 rounded-2xl border ${
                  qrErro.motivo === "sessao_presa" ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"}`}>
                  {qrErro.motivo === "sessao_presa" ? (
                    <>
                      <p className="text-[11px] text-amber-800 font-black uppercase tracking-widest mb-1">
                        Instância travada
                      </p>
                      <p className="text-[11px] text-amber-700">
                        A instância ficou conectada sem concluir o login e parou de emitir QR.
                        Reconecte pelo painel da Avisa — daqui não dá pra destravar.
                      </p>
                    </>
                  ) : qrErro.motivo === "throttle" ? (
                    <p className="text-[11px] text-red-700">{qrErro.detalhe}</p>
                  ) : (
                    <p className="text-[11px] text-red-700">
                      Não consegui gerar o QR: {qrErro.detalhe}
                    </p>
                  )}
                </div>
              )}

              <p className="text-[10px] text-gray-400">
                Gere o QR só quando estiver com o celular em mãos — cada geração reinicia a sessão na Avisa.
              </p>
            </div>
          )}
        </div>

        {/* ── Meta Cloud API ── */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-blue-600">
                <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.885v2.27h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-900">Meta Cloud API</h2>
              <p className="text-[10px] text-gray-400">Número oficial via Meta Business (WhatsApp Business API)</p>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Phone Number ID
              </label>
              <input
                type="text"
                value={config.meta_phone_id ?? ""}
                onChange={e => setConfig(c => ({ ...c, meta_phone_id: e.target.value }))}
                placeholder="Ex: 123456789012345"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition font-mono"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Access Token
              </label>
              <div className="relative">
                <input
                  type={showMetaToken ? "text" : "password"}
                  value={config.meta_access_token ?? ""}
                  onChange={e => setConfig(c => ({ ...c, meta_access_token: e.target.value }))}
                  placeholder="EAABsbCS…"
                  className="w-full bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition font-mono"
                />
                <button type="button" onClick={() => setShowMetaToken(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors">
                  {showMetaToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[10px] text-gray-400">Ou use o Embedded Signup abaixo para conectar automaticamente.</p>
            </div>

            {/* Embedded Signup */}
            <div className="bg-blue-50/60 border border-blue-100 rounded-2xl p-4 flex items-center gap-4">
              <div className="flex-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-800 mb-0.5">Conectar via Facebook</p>
                <p className="text-[10px] text-blue-600">Preenche Phone Number ID e Access Token automaticamente.</p>
              </div>
              <button
                type="button"
                onClick={handleMetaEmbeddedSignup}
                disabled={metaConnecting}
                className={`flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${
                  metaConnected
                    ? "bg-green-500 text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white"
                }`}
              >
                {metaConnecting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : metaConnected ? (
                  <><CheckCircle2 size={13} /> Conectado!</>
                ) : (
                  "Conectar"
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ── Mensagens de voz ── */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-xl bg-violet-50 flex items-center justify-center">
              <Mic size={15} className="text-violet-600" />
            </div>
            <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400">
              Mensagens de Voz
            </h2>
          </div>
          <p className="text-[11px] text-gray-500 mb-6">
            O agente responde em áudio, como um vendedor de verdade. Funciona nos dois canais.
          </p>

          <button
            type="button"
            onClick={() => setConfig(c => ({ ...c, voz_habilitada: !c.voz_habilitada }))}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl border transition ${
              config.voz_habilitada
                ? "bg-violet-50 border-violet-200"
                : "bg-[#f5f5f3] border-gray-200"
            }`}
          >
            <span className="text-sm font-semibold text-gray-900">
              {config.voz_habilitada ? "Voz ativada" : "Voz desativada"}
            </span>
            <span className={`w-10 h-6 rounded-full p-0.5 transition ${config.voz_habilitada ? "bg-violet-600" : "bg-gray-300"}`}>
              <span className={`block w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${config.voz_habilitada ? "translate-x-4" : ""}`} />
            </span>
          </button>

          {config.voz_habilitada && (
            <div className="mt-4 flex flex-col gap-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Quando mandar áudio
              </label>
              {([
                { v: "espelho", t: "Só quando o cliente mandar áudio", d: "O agente espelha o formato do cliente. Mais discreto." },
                { v: "espelho_e_saudacao", t: "Espelho + primeira resposta", d: "Também abre a conversa em áudio — costuma prender mais o lead." },
              ] as const).map(op => (
                <button
                  key={op.v}
                  type="button"
                  onClick={() => setConfig(c => ({ ...c, voz_politica: op.v }))}
                  className={`text-left px-4 py-3 rounded-2xl border transition ${
                    (config.voz_politica ?? "espelho") === op.v
                      ? "bg-violet-50 border-violet-300"
                      : "bg-[#f5f5f3] border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <p className="text-sm font-semibold text-gray-900">{op.t}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{op.d}</p>
                </button>
              ))}

              <button
                type="button"
                onClick={ouvirAmostraVoz}
                disabled={carregandoAmostra}
                className="mt-2 self-start flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest disabled:opacity-50 transition"
              >
                {carregandoAmostra ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                Ouvir amostra
              </button>

              <p className="text-[10px] text-gray-400 mt-1">
                Respostas com link, lista de veículos ou texto longo continuam indo por escrito — áudio nesses casos não ajuda o cliente.
              </p>
            </div>
          )}
        </div>

        {/* ── Webhook Token ── */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-1">
            Webhook Token
          </h2>
          <p className="text-[11px] text-gray-500 mb-6">
            Identificador único desta garagem. Configure nas plataformas para rotear mensagens corretamente.
          </p>
          <div className="flex flex-col gap-3">
            <div className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 space-y-1">
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Token</p>
              <div className="flex items-center gap-2">
                <code className="text-[11px] text-gray-700 flex-1 break-all">
                  {webhookToken || <span className="text-gray-400 italic">Não configurado</span>}
                </code>
                {webhookToken && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(webhookToken, "wh-token")}
                    className="shrink-0 p-2 bg-gray-900 hover:bg-red-600 text-white rounded-xl transition-colors"
                  >
                    {copied === "wh-token" ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                  </button>
                )}
              </div>
            </div>

            {currentUserId && (
              <div className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">URL do Webhook (Meta / Avisa)</p>
                <div className="flex items-center gap-2">
                  <code className="text-[10px] text-gray-700 flex-1 break-all">
                    {`${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital"}/api/webhook/avisa/${webhookToken || currentUserId}`}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(
                      `${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital"}/api/webhook/avisa/${webhookToken || currentUserId}`,
                      "wh-url"
                    )}
                    className="shrink-0 p-2 bg-gray-900 hover:bg-red-600 text-white rounded-xl transition-colors"
                  >
                    {copied === "wh-url" ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
            )}

            {webhookToken && (
              <div className="bg-orange-50 border border-orange-100 rounded-2xl px-4 py-3 space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-orange-500">📞 URL — Webhook de Ligação (PABX/VoIP)</p>
                <p className="text-[9px] text-gray-500 mb-1.5">
                  Configure esta URL no seu sistema de telefonia. Quando o cliente ligar, a IA manda um WhatsApp automático para ele.
                  <br/>Body: <code className="bg-white px-1 rounded">{"{ \"phone\": \"5517999990000\" }"}</code>
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-[10px] text-gray-700 flex-1 break-all">
                    {`${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital"}/api/webhook/chamada/${webhookToken}`}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(
                      `${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital"}/api/webhook/chamada/${webhookToken}`,
                      "wh-chamada"
                    )}
                    className="shrink-0 p-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-colors"
                  >
                    {copied === "wh-chamada" ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Salvar WhatsApp ── */}
        <button
          onClick={handleSaveWhatsapp}
          disabled={savingWa || savedWa}
          className={`w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest transition-all flex items-center justify-center gap-2 ${
            savedWa ? "bg-green-500 text-white" : "bg-gray-900 text-white hover:bg-green-600"
          }`}
        >
          {savingWa ? (
            <><Loader2 size={16} className="animate-spin" /> Salvando...</>
          ) : savedWa ? (
            <><CheckCircle2 size={16} /> Salvo com sucesso!</>
          ) : (
            <><Save size={14} /> Salvar configurações WhatsApp</>
          )}
        </button>

        </> /* fim aba whatsapp */}

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

        {/* ── Vitrine da loja ── */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-1">
            Vitrine da loja
          </h2>
          <p className="text-[11px] text-gray-500 mb-6">
            Personalização visual da página pública onde os clientes veem seu estoque.
          </p>

          <div className="flex flex-col gap-5">
            {/* Logo da vitrine */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Logo da vitrine
              </label>
              {(config.vitrine_tema?.logo_url || currentLogo) && (
                <div className="h-24 bg-gray-100 rounded-xl border border-gray-100 overflow-hidden flex items-center justify-center p-3">
                  <img src={config.vitrine_tema?.logo_url || currentLogo!} alt="Logo da vitrine" className="max-h-full max-w-[220px] object-contain" />
                </div>
              )}
              <label className="block cursor-pointer">
                <div className="border-2 border-dashed border-gray-200 rounded-2xl p-5 flex items-center justify-center gap-2 hover:border-red-400 hover:bg-red-50/30 transition-all">
                  {uploadingVitrineLogo ? (
                    <>
                      <Loader2 size={16} className="animate-spin text-gray-400" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Enviando...</span>
                    </>
                  ) : (
                    <>
                      <Upload size={16} className="text-gray-400" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                        {config.vitrine_tema?.logo_url ? "Trocar logo" : "Enviar logo"}
                      </span>
                    </>
                  )}
                </div>
                <input ref={vitrineLogoRef} type="file" accept="image/*" className="hidden" onChange={handleUploadVitrineLogo} disabled={uploadingVitrineLogo} />
              </label>
              <p className="text-[9px] text-gray-400 mt-0.5">
                {config.vitrine_tema?.logo_url
                  ? "Logo exclusiva da vitrine. PNG com fundo transparente fica melhor."
                  : "Sem logo própria, a vitrine usa a logo da loja. PNG transparente recomendado."}
              </p>
            </div>

            {/* Capa */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Imagem de capa
              </label>
              {config.vitrine_tema?.capa_url && (
                <div className="h-32 bg-gray-50 rounded-xl border border-gray-100 overflow-hidden">
                  <img src={config.vitrine_tema.capa_url} alt="Capa da vitrine" className="w-full h-full object-cover" />
                </div>
              )}
              <label className="block cursor-pointer">
                <div className="border-2 border-dashed border-gray-200 rounded-2xl p-5 flex items-center justify-center gap-2 hover:border-red-400 hover:bg-red-50/30 transition-all">
                  {uploadingCapa ? (
                    <>
                      <Loader2 size={16} className="animate-spin text-gray-400" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Enviando...</span>
                    </>
                  ) : (
                    <>
                      <Upload size={16} className="text-gray-400" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                        {config.vitrine_tema?.capa_url ? "Trocar capa" : "Enviar capa"}
                      </span>
                    </>
                  )}
                </div>
                <input ref={capaRef} type="file" accept="image/*" className="hidden" onChange={handleUploadCapa} disabled={uploadingCapa} />
              </label>
              <p className="text-[9px] text-gray-400 mt-0.5">
                Recomendado: imagem horizontal, aprox. 1600 × 500px.
              </p>
            </div>

            {/* Cores da marca */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 flex items-center gap-1.5">
                <Palette size={12} /> Cores da marca
              </label>
              <div className="flex gap-3">
                <div className="flex items-center gap-2 bg-[#f5f5f3] border border-gray-200 rounded-xl px-3 py-2 flex-1">
                  <input
                    type="color"
                    value={config.vitrine_tema?.cor_primaria || "#dc2626"}
                    onChange={e => setConfig(c => ({ ...c, vitrine_tema: { ...c.vitrine_tema, cor_primaria: e.target.value } }))}
                    className="w-8 h-8 rounded-lg border-none cursor-pointer bg-transparent"
                  />
                  <div>
                    <p className="text-[9px] font-black uppercase text-gray-400">Primária</p>
                    <p className="text-xs text-gray-600 font-mono">{config.vitrine_tema?.cor_primaria || "—"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-[#f5f5f3] border border-gray-200 rounded-xl px-3 py-2 flex-1">
                  <input
                    type="color"
                    value={config.vitrine_tema?.cor_secundaria || "#111827"}
                    onChange={e => setConfig(c => ({ ...c, vitrine_tema: { ...c.vitrine_tema, cor_secundaria: e.target.value } }))}
                    className="w-8 h-8 rounded-lg border-none cursor-pointer bg-transparent"
                  />
                  <div>
                    <p className="text-[9px] font-black uppercase text-gray-400">Secundária</p>
                    <p className="text-xs text-gray-600 font-mono">{config.vitrine_tema?.cor_secundaria || "—"}</p>
                  </div>
                </div>
              </div>
              <p className="text-[9px] text-gray-400 mt-0.5">
                Sugerimos a cor primária a partir da sua logo — ajuste se quiser.
              </p>
            </div>

            {/* Tagline */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Tagline <span className="text-gray-400 normal-case font-normal">({(config.vitrine_tema?.tagline || "").length}/80)</span>
              </label>
              <input
                type="text"
                value={config.vitrine_tema?.tagline || ""}
                onChange={e => setConfig(c => ({ ...c, vitrine_tema: { ...c.vitrine_tema, tagline: e.target.value.slice(0, 80) } }))}
                maxLength={80}
                placeholder="Ex: O carro dos seus sonhos com a confiança que você merece"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
            </div>

            {/* Sobre a loja */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Sobre a loja <span className="text-gray-400 normal-case font-normal">({(config.vitrine_tema?.sobre || "").length}/500)</span>
              </label>
              <textarea
                value={config.vitrine_tema?.sobre || ""}
                onChange={e => setConfig(c => ({ ...c, vitrine_tema: { ...c.vitrine_tema, sobre: e.target.value.slice(0, 500) } }))}
                maxLength={500}
                rows={4}
                placeholder="Conte a história da sua loja, diferenciais, tempo de mercado..."
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition resize-none"
              />
            </div>

            {/* Tema */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Tema
              </label>
              <select
                value={config.vitrine_tema?.tema || "claro"}
                onChange={e => setConfig(c => ({ ...c, vitrine_tema: { ...c.vitrine_tema, tema: e.target.value as "claro" | "escuro" } }))}
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              >
                <option value="claro">Claro</option>
                <option value="escuro">Escuro</option>
              </select>
            </div>

            {/* Domínio próprio */}
            <div className="flex flex-col gap-1.5 pt-3 border-t border-gray-100">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 flex items-center gap-1.5">
                <Globe size={12} /> Domínio próprio
              </label>
              <input
                type="text"
                value={config.dominio_custom || ""}
                onChange={e => {
                  const v = e.target.value.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
                  setConfig(c => ({ ...c, dominio_custom: v }));
                }}
                placeholder="www.sualoja.com.br"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
              <p className="text-[9px] text-gray-400 mt-0.5">
                Aponte o DNS do seu domínio: CNAME www → cname.vercel-dns.com (ou registro A 76.76.21.21 para domínio raiz). Após configurar, avise o suporte para ativarmos o certificado.
              </p>
            </div>

            {/* Ver vitrine */}
            {config.vitrine_slug && (
              <a
                href={`/vitrine/${config.vitrine_slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest transition-all flex items-center justify-center gap-2 border-2 border-gray-900 text-gray-900 hover:bg-gray-900 hover:text-white"
              >
                <ExternalLink size={16} /> Ver minha vitrine
              </a>
            )}

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
              ) : "Salvar"}
            </button>
          </div>
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
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">URL do Webhook de Leads (cadastrar na OLX — produto &quot;Leads&quot;)</p>
                    <div className="flex items-center gap-2">
                      <code className="text-[10px] text-gray-700 break-all flex-1">
                        {`${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital"}/api/webhook/olx/${currentUserId}`}
                      </code>
                      <button
                        onClick={() => navigator.clipboard.writeText(`${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital"}/api/webhook/olx/${currentUserId}`)}
                        className="text-[9px] font-black text-gray-400 hover:text-gray-700 shrink-0"
                      >
                        Copiar
                      </button>
                    </div>
                  </div>
                )}
                {currentUserId && (
                  <div className="bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 space-y-1">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">URL do Webhook de Chat (cadastrar na OLX — produto &quot;Chat&quot;)</p>
                    <div className="flex items-center gap-2">
                      <code className="text-[10px] text-gray-700 break-all flex-1">
                        {`${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital"}/api/webhook/olx-chat/${currentUserId}`}
                      </code>
                      <button
                        onClick={() => navigator.clipboard.writeText(`${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital"}/api/webhook/olx-chat/${currentUserId}`)}
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

            <button
              onClick={handleSaveWm}
              disabled={savingWm || savedWm}
              className={`w-full py-2.5 rounded-2xl font-black uppercase text-[11px] tracking-widest transition-all flex items-center justify-center gap-2 ${
                savedWm ? "bg-green-500 text-white" : "bg-red-600 text-white hover:bg-red-700"
              }`}
            >
              {savingWm ? (
                <><Loader2 size={15} className="animate-spin" /> Salvando...</>
              ) : savedWm ? (
                <><CheckCircle2 size={15} /> Salvo com sucesso!</>
              ) : (
                <><Save size={13} /> Salvar credenciais Webmotors</>
              )}
            </button>

            <div className="pt-2 border-t border-gray-100">
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">URL de Callback (copiar para a Webmotors)</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 font-mono text-[10px] text-gray-700 truncate">
                  {`${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital"}/api/webhook/webmotors`}
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(
                    `${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital"}/api/webhook/webmotors`,
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

        {/* ── Mercado Livre (OAuth) ─────────────────────────────────────────── */}
        <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-yellow-100 flex items-center justify-center">
                <span className="text-yellow-700 font-black text-sm">ML</span>
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-gray-900">Mercado Livre</p>
                <p className="text-[10px] text-gray-400">Publique anúncios de veículos no Mercado Livre Autos</p>
              </div>
            </div>
            {mlConectado && (
              <span className="flex items-center gap-1 px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-[9px] font-black uppercase tracking-wider">
                <CheckCircle2 size={10} /> Conectado
              </span>
            )}
          </div>

          {searchParams.get("ml_conectado") === "1" && (
            <div className="mt-4 bg-green-50 border border-green-100 rounded-2xl px-4 py-3 text-[11px] text-green-700 font-bold">
              ✅ Mercado Livre conectado com sucesso!
            </div>
          )}
          {searchParams.get("ml_error") && (
            <div className="mt-4 bg-red-50 border border-red-100 rounded-2xl px-4 py-3 text-[11px] text-red-600 font-bold">
              ❌ Erro ao conectar: {searchParams.get("ml_error")}
            </div>
          )}

          <div className="mt-5">
            {mlConectado ? (
              <div className="flex items-center justify-between bg-green-50 border border-green-100 rounded-2xl px-4 py-3">
                <p className="text-[11px] text-green-700 font-bold">Conta ML vinculada — anúncios e alertas ativos.</p>
                <a
                  href="/api/oauth/mercadolivre/authorize"
                  className="text-[10px] text-gray-400 hover:text-gray-600 underline underline-offset-2"
                >
                  Reconectar
                </a>
              </div>
            ) : (
              <a
                href="/api/oauth/mercadolivre/authorize"
                className="flex items-center justify-center gap-2 w-full py-3 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-2xl font-black text-[11px] uppercase tracking-widest transition-colors"
              >
                Conectar com Mercado Livre
              </a>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">O que acontece quando chega uma pergunta</p>
            <div className="space-y-1.5">
              {[
                "Pergunta registrada automaticamente no chat da revenda",
                "Você recebe alerta no WhatsApp com o texto da pergunta",
                "Responda pelo painel do Mercado Livre normalmente",
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="w-4 h-4 rounded-full bg-yellow-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-yellow-700 text-[9px] font-black">{i + 1}</span>
                  </div>
                  <p className="text-[11px] text-gray-600">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

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
                  <button
                    type="button"
                    onClick={desvincularMetaAds}
                    disabled={desvinculandoMeta}
                    className="ml-auto text-[9px] font-black uppercase tracking-widest text-red-400 hover:text-red-600 transition shrink-0 disabled:opacity-50"
                  >
                    {desvinculandoMeta ? "..." : "Desvincular"}
                  </button>
                </div>
              )}

              {config.meta_ads_token && !metaPaginaSalva && (
                <button
                  type="button"
                  onClick={desvincularMetaAds}
                  disabled={desvinculandoMeta}
                  className="w-full py-2 rounded-2xl border border-red-200 text-red-500 hover:bg-red-50 text-[11px] font-bold transition-colors disabled:opacity-50"
                >
                  {desvinculandoMeta ? "Desvinculando..." : "Desvincular Meta Ads"}
                </button>
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

              {metaPaginas.length === 0 && !metaAdsLoading && !metaAdsError && (
                <>
                  {metaCarregado ? (
                    <div className="bg-yellow-50 border border-yellow-100 rounded-2xl px-4 py-3 space-y-2">
                      <p className="text-[11px] text-yellow-700 font-bold">Nenhuma Página do Facebook encontrada.</p>
                      <p className="text-[10px] text-yellow-600">
                        Certifique-se de ter uma Página do Facebook (não perfil pessoal) e que ela esteja vinculada à sua conta. Você pode criar uma em{" "}
                        <a href="https://www.facebook.com/pages/create" target="_blank" rel="noreferrer" className="underline font-bold">facebook.com/pages/create</a>.
                      </p>
                      <button
                        type="button"
                        onClick={carregarMetaAds}
                        className="w-full py-2 rounded-xl border border-yellow-300 text-yellow-700 hover:bg-yellow-100 text-[11px] font-bold transition-colors"
                      >
                        Tentar novamente
                      </button>
                    </div>
                  ) : (
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
                </>
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
        </> /* fim aba portais + meta */ }

      </div>
    </main>
  );
}
