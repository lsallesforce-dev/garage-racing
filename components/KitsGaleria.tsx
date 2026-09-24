"use client";

// Aba "Kits de Postagem" (Marketing) — tudo do kit num lugar só, por carro:
//   · captura guiada (fotos + takes etiquetados + puxar fotos do anúncio)
//   · gerar kit (capa/carrossel/story/legenda) + preview + downloads
//   · reel (gerar no worker, assistir, baixar)
// Config da legenda/capa (nível loja) fica no topo, não por carro.
//
// Vocabulário da tela: POSTAR = orgânico, grátis, no Face/Insta da loja.
// ANUNCIAR = Meta Ads, pago. Cada cartão tem 3 seções (Criar · Publicar · Reel)
// em vez de ~10 blocos empilhados.

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useUserRole } from "@/components/SidebarWrapper";
import CapturaGuiada from "@/components/CapturaGuiada";
import PisoRestauro from "@/components/PisoRestauro";
import ReelEditor from "@/components/ReelEditor";
import PublicarMetaButton from "@/components/PublicarMetaButton";
import type { MarketingCapturas } from "@/lib/marketing-shotlist";
import { midiaDoVeiculo, melhorFormato, miniatura } from "@/lib/veiculo-midia";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Loader2,
  Megaphone,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Video,
  Wand2,
} from "lucide-react";

interface PostPublicado {
  destino: "facebook" | "instagram";
  post_id: string;
  permalink: string;
  formato: "feed" | "story" | "reels" | "story_video";
  em: string;
  removido_em: string | null;
}

interface CarroKit {
  id: string;
  marca: string | null;
  modelo: string | null;
  versao: string | null;
  ano: number | null;
  ano_modelo: number | null;
  fotos: string[] | null;
  status_venda: string | null;
  marketing_capa_url: string | null;
  marketing_story_url: string | null;
  marketing_carrossel: string[] | null;
  marketing_legenda: string | null;
  marketing_reel_url: string | null;
  marketing_reel_status: string | null;
  video_takes: string[] | null;
  video_url: string | null;
  marketing_capturas: MarketingCapturas | null;
  /** Posts orgânicos já publicados (migration 061). */
  marketing_posts: PostPublicado[] | null;
  roteiro_pitch: string | null;
}

type FiltroKit = "todos" | "sem_kit" | "nao_postado" | "no_ar" | "reel";
type SecaoKit = "criar" | "publicar" | "reel";

function reelToProxy(url: string): string {
  const m = url.match(/https?:\/\/[^/]+\/(.+)$/);
  return m && url.includes(".r2.dev") ? `/api/r2/${m[1]}` : url;
}

/**
 * Botão de anúncio pago no card do kit.
 * Reusa o PublicarMetaButton com defaultOpen, igual a página de Marketing já faz
 * — nenhum modal novo. `formatoInicial` = o formato mais forte que este carro
 * tem arte pra publicar (reel > carrossel > foto).
 */
function PublicarKit({ carro }: { carro: CarroKit }) {
  const [aberto, setAberto] = useState(false);
  const midia = midiaDoVeiculo(carro as any);
  const semArte = midia.formatosDisponiveis.length === 0;

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        disabled={semArte}
        title={semArte ? "Sem foto nem arte pra anunciar" : undefined}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 py-3 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:from-blue-700 hover:to-purple-700 disabled:opacity-40"
      >
        <Megaphone size={13} />
        Anunciar no Meta Ads
        <span className="rounded-full bg-amber-300/90 px-1.5 py-0.5 text-[8px] text-amber-900">pago</span>
        {!semArte && (
          <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[8px] capitalize">
            {melhorFormato(midia)}
          </span>
        )}
      </button>

      {aberto && (
        <PublicarMetaButton
          veiculoId={carro.id}
          marca={carro.marca ?? ""}
          modelo={carro.modelo ?? ""}
          ano={carro.ano_modelo ?? carro.ano ?? ""}
          fotoUrl={midia.imagemPadrao}
          formatoInicial={melhorFormato(midia)}
          defaultOpen
          onClose={() => setAberto(false)}
        />
      )}
    </>
  );
}

export default function KitsGaleria() {
  const { effectiveUserId } = useUserRole();
  const [carros, setCarros] = useState<CarroKit[]>([]);
  const [loading, setLoading] = useState(true);
  const [gerando, setGerando] = useState<Record<string, boolean>>({});
  const [salvando, setSalvando] = useState<Record<string, "salvando" | "ok">>({});
  const [copiado, setCopiado] = useState<string | null>(null);
  const [erro, setErro] = useState<Record<string, string>>({});
  const [gerandoTodos, setGerandoTodos] = useState<{ atual: number; total: number } | null>(null);
  const [reelBusy, setReelBusy] = useState<Record<string, boolean>>({});
  const [baixando, setBaixando] = useState<Record<string, "capa" | "story" | "carrossel" | "reel">>({});
  const [aberto, setAberto] = useState<Record<string, boolean>>({});
  const [editando, setEditando] = useState<Record<string, boolean>>({});
  const [gerandoRoteiro, setGerandoRoteiro] = useState<Record<string, boolean>>({});
  const [roteiroAberto, setRoteiroAberto] = useState<Record<string, boolean>>({});
  const [pisoAberto, setPisoAberto] = useState<Record<string, boolean>>({});
  const legendaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  // Post ORGÂNICO (grátis) — diferente do PublicarMetaButton, que é anúncio pago.
  const [postando, setPostando] = useState<Record<string, boolean>>({});
  const [postado, setPostado] = useState<Record<string, string>>({});
  const [busca, setBusca] = useState("");
  const [filtroKit, setFiltroKit] = useState<FiltroKit>("todos");
  const [secao, setSecao] = useState<Record<string, SecaoKit>>({});

  // Config da loja (nível tenant)
  const [cfgAberta, setCfgAberta] = useState(false);
  const [cfgCarregada, setCfgCarregada] = useState(false);
  const [mostrarPreco, setMostrarPreco] = useState(true);
  const [claim, setClaim] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [fotoComMarca, setFotoComMarca] = useState(false);
  const [salvandoCfg, setSalvandoCfg] = useState(false);
  const [cfgErro, setCfgErro] = useState("");
  const [cfgSalvo, setCfgSalvo] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [subindoLogo, setSubindoLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!effectiveUserId) return;
    supabase
      .from("veiculos")
      .select("id, marca, modelo, versao, ano, ano_modelo, fotos, status_venda, marketing_capa_url, marketing_story_url, marketing_carrossel, marketing_legenda, marketing_reel_url, marketing_reel_status, video_takes, video_url, marketing_capturas, roteiro_pitch, marketing_posts")
      .eq("user_id", effectiveUserId)
      .neq("status_venda", "VENDIDO")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setCarros((data as CarroKit[]) ?? []);
        setLoading(false);
      });
  }, [effectiveUserId]);

  useEffect(() => {
    if (!cfgAberta || cfgCarregada) return;
    fetch("/api/marketing/config")
      .then((r) => r.json())
      .then((d) => {
        setMostrarPreco(d.mostrar_preco !== false);
        setClaim(d.claim ?? "");
        setHashtags(d.hashtags ?? "");
        setFotoComMarca(d.foto_com_marca === true);
        setLogoUrl(d.logo_url ?? null);
        setCfgCarregada(true);
      })
      .catch(() => setCfgCarregada(true));
  }, [cfgAberta, cfgCarregada]);

  // Polling do reel enquanto algum estiver processando
  useEffect(() => {
    const processando = carros.filter((c) => c.marketing_reel_status === "processando").map((c) => c.id);
    if (!processando.length) return;
    const t = setInterval(async () => {
      await Promise.all(
        processando.map(async (id) => {
          const r = await fetch(`/api/marketing/reel?veiculoId=${id}`).then((x) => x.json()).catch(() => null);
          if (r && r.status && r.status !== "processando") {
            setCarros((prev) => prev.map((c) => (c.id === id ? { ...c, marketing_reel_status: r.status, marketing_reel_url: r.url } : c)));
          }
        })
      );
    }, 8000);
    return () => clearInterval(t);
  }, [carros]);

  /** Posts desse carro que ainda estão publicados (feed; story do IG expira em 24h). */
  function noAr(c: CarroKit): PostPublicado[] {
    // Story (arte ou vídeo) some sozinho em 24h — não entra no "no ar".
    return (c.marketing_posts ?? []).filter(
      (p) => p && !p.removido_em && p.formato !== "story" && p.formato !== "story_video",
    );
  }

  /**
   * Canal que ficou pra tras: o post saiu num e falhou no outro.
   *
   * O aviso do clique some em segundos e nao sobrevive a refresh — o lojista
   * so descobria olhando o feed. Caso real (23/09): a Saveiro Robust foi pro
   * Facebook e o Instagram voltou 9007; ninguem viu ate o Lucas reparar.
   * Story nao conta (expira em 24h) e Facebook so aceita feed.
   */
  function canalFaltando(c: CarroKit): "facebook" | "instagram" | null {
    const feed = (c.marketing_posts ?? []).filter(
      (p) => p && !p.removido_em && p.formato === "feed",
    );
    if (!feed.length) return null;
    const temFb = feed.some((p) => p.destino === "facebook");
    const temIg = feed.some((p) => p.destino === "instagram");
    if (temFb && !temIg) return "instagram";
    if (temIg && !temFb) return "facebook";
    return null;
  }

  function desde(iso: string): string {
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (!isFinite(min) || min < 1) return "agora";
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h}h`;
    const d = Math.floor(h / 24);
    return d === 1 ? "ontem" : `há ${d} dias`;
  }

  function titulo(c: CarroKit) {
    return `${c.marca ?? ""} ${c.modelo ?? ""}`.trim() || "Sem nome";
  }
  function slugCarro(c: CarroKit) {
    return titulo(c).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  }
  function temTakes(c: CarroKit) {
    return (c.video_takes?.length ?? 0) > 0 || (c.marketing_capturas?.takes?.length ?? 0) > 0;
  }
  function patchCarro(id: string, patch: Partial<CarroKit>) {
    setCarros((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  // Persiste um pedaço da config. A rota aceita update parcial (só o que vier no
  // body), então o checkbox grava sozinho, sem depender do botão Salvar.
  //
  // O erro é MOSTRADO: esta função engolia o `res.ok` e um 401/404/500 ficava
  // idêntico a sucesso — a marca d'água "ligada" na tela e desligada no banco.
  async function patchCfg(patch: Record<string, unknown>): Promise<boolean> {
    setSalvandoCfg(true);
    setCfgErro("");
    try {
      const res = await fetch("/api/marketing/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      setCfgSalvo(true);
      setTimeout(() => setCfgSalvo(false), 2500);
      return true;
    } catch (e: any) {
      setCfgErro(e.message ?? "Não consegui salvar");
      return false;
    } finally {
      setSalvandoCfg(false);
    }
  }

  // Checkbox salva na hora: era o modo de falha real — marcar a caixa, não clicar
  // em Salvar e achar que valeu.
  async function alternarCfg(campo: "mostrar_preco" | "foto_com_marca", valor: boolean) {
    const setter = campo === "mostrar_preco" ? setMostrarPreco : setFotoComMarca;
    setter(valor);
    const ok = await patchCfg({ [campo]: valor });
    if (!ok) setter(!valor); // não vingou no banco: a tela volta a contar a verdade
  }

  async function salvarCfg() {
    await patchCfg({ mostrar_preco: mostrarPreco, claim, hashtags, foto_com_marca: fotoComMarca });
  }

  async function subirLogo(file: File) {
    setSubindoLogo(true);
    setCfgErro("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/configuracoes/logo", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setLogoUrl(d.url);
      setCfgSalvo(true);
      setTimeout(() => setCfgSalvo(false), 2500);
    } catch (e: any) {
      setCfgErro(e.message ?? "Erro ao enviar a logo");
    } finally {
      setSubindoLogo(false);
    }
  }

  // somenteCapa: capa + story + legenda, sem os slides do carrossel e sem as
  // legendas dos takes do reel (ver app/api/marketing/pacote).
  async function gerar(id: string, somenteCapa = false): Promise<boolean> {
    setGerando((p) => ({ ...p, [id]: true }));
    setErro((p) => ({ ...p, [id]: "" }));
    try {
      const res = await fetch("/api/marketing/pacote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId: id, somenteCapa }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      patchCarro(id, {
        marketing_capa_url: `${d.capaUrl}`,
        marketing_story_url: d.storyUrl ?? null,
        marketing_carrossel: d.carrossel ?? null,
        marketing_legenda: d.legenda,
      });
      return true;
    } catch (e: any) {
      setErro((p) => ({ ...p, [id]: e.message ?? "Erro ao gerar" }));
      return false;
    } finally {
      setGerando((p) => ({ ...p, [id]: false }));
    }
  }

  async function gerarTodos() {
    const fila = carros.filter((c) => !c.marketing_capa_url && (c.fotos?.length ?? 0) > 0).map((c) => c.id);
    setGerandoTodos({ atual: 0, total: fila.length });
    for (let i = 0; i < fila.length; i++) {
      setGerandoTodos({ atual: i + 1, total: fila.length });
      await gerar(fila[i]);
    }
    setGerandoTodos(null);
  }

  async function salvarLegenda(id: string, legenda: string) {
    setSalvando((p) => ({ ...p, [id]: "salvando" }));
    try {
      const res = await fetch("/api/marketing/legenda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId: id, legenda }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setSalvando((p) => ({ ...p, [id]: "ok" }));
      setTimeout(() => setSalvando((p) => { const n = { ...p }; delete n[id]; return n; }), 2000);
    } catch (e: any) {
      setSalvando((p) => { const n = { ...p }; delete n[id]; return n; });
      setErro((p) => ({ ...p, [id]: e.message ?? "Erro ao salvar legenda" }));
    }
  }

  /** Publica o kit como post normal na Página e/ou no Instagram da loja. */
  async function postarAgora(
    id: string,
    destinos: ("facebook" | "instagram")[],
    formato: "feed" | "story" | "reels" | "story_video",
    substituir = false,
  ) {
    setPostando((p) => ({ ...p, [id]: true }));
    setErro((p) => ({ ...p, [id]: "" }));
    try {
      // Manda a legenda que está na tela, não a do banco: o lojista costuma
      // ajustar o texto e postar sem clicar em "Salvar legenda" antes.
      const legenda = legendaRefs.current[id]?.value ?? "";
      const res = await fetch("/api/marketing/postar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId: id, destinos, formato, legenda, substituir }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Erro ao publicar");
      const nomeFormato = formato === "reels" ? "Reels" : formato.startsWith("story") ? "Story" : "";
      const onde = Object.keys(d.publicado ?? {}).map(
        (k) => (k === "facebook" ? "Facebook" : "Instagram") + (nomeFormato ? " (" + nomeFormato + ")" : ""),
      );
      // Mostra a Página que recebeu o post: com mais de uma Página na conta,
      // é assim que se percebe que o post foi pra Página errada (15/09).
      if (d.posts) patchCarro(id, { marketing_posts: d.posts });
      setPostado((p) => ({ ...p, [id]: `${onde.join(" e ")}${d.pagina ? ` · ${d.pagina}` : ""}` }));
      if (d.avisos?.length) setErro((p) => ({ ...p, [id]: d.avisos.join(" | ") }));
      setTimeout(() => setPostado((p) => ({ ...p, [id]: "" })), 6000);
    } catch (e: any) {
      setErro((p) => ({ ...p, [id]: e.message ?? "Erro ao publicar" }));
    } finally {
      setPostando((p) => ({ ...p, [id]: false }));
    }
  }

  /**
   * Troca o post que está no ar por um novo (arte/legenda atualizadas).
   * "Postar de novo" criava um SEGUNDO post do mesmo carro no perfil; agora o
   * servidor recusa duplicar e só publica por cima quando é pedido aqui.
   */
  function substituirPost(c: CarroKit, formato: "feed" | "reels") {
    const vivos = noAr(c).filter((p) => p.formato === formato);
    const destinos = [...new Set(vivos.map((p) => p.destino))];
    if (formato === "feed") {
      // Canal que falhou da outra vez entra junto: substituir deixa os dois certos.
      if (!destinos.includes("facebook")) destinos.push("facebook");
      if (!destinos.includes("instagram")) destinos.push("instagram");
    }
    const onde = formato === "reels" ? "o Reels" : "o post do feed";
    if (!window.confirm(`Apagar ${onde} que está no ar e publicar de novo com a arte e a legenda atuais?\n\nCurtidas e comentários do post antigo se perdem.`)) return;
    postarAgora(c.id, destinos, formato, true);
  }

  function copiar(id: string, legenda: string) {
    navigator.clipboard.writeText(legenda).then(() => {
      setCopiado(id);
      setTimeout(() => setCopiado(null), 2000);
    });
  }

  async function baixarUrl(url: string, nome: string) {
    const r = await fetch(url);
    const blob = await r.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = nome;
    a.click();
    URL.revokeObjectURL(objUrl);
  }

  async function baixar(c: CarroKit, tipo: "capa" | "story" | "carrossel") {
    if (baixando[c.id]) return;
    setBaixando((p) => ({ ...p, [c.id]: tipo }));
    try {
      if (tipo === "capa" && c.marketing_capa_url) {
        await baixarUrl(c.marketing_capa_url, `feed-${slugCarro(c)}.png`);
      } else if (tipo === "story" && c.marketing_story_url) {
        await baixarUrl(c.marketing_story_url, `story-${slugCarro(c)}.png`);
      } else if (tipo === "carrossel" && c.marketing_carrossel?.length) {
        for (let i = 0; i < c.marketing_carrossel.length; i++) {
          const ext = c.marketing_carrossel[i].includes(".png") ? "png" : "jpg";
          await baixarUrl(c.marketing_carrossel[i], `${String(i + 1).padStart(2, "0")}-${slugCarro(c)}.${ext}`);
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    } catch {
      setErro((p) => ({ ...p, [c.id]: "Erro ao baixar" }));
    } finally {
      setBaixando((p) => { const n = { ...p }; delete n[c.id]; return n; });
    }
  }

  async function baixarReel(c: CarroKit) {
    if (baixando[c.id] || !c.marketing_reel_url) return;
    setBaixando((p) => ({ ...p, [c.id]: "reel" }));
    try {
      await baixarUrl(reelToProxy(c.marketing_reel_url), `reel-${slugCarro(c)}.mp4`);
    } catch {
      setErro((p) => ({ ...p, [c.id]: "Erro ao baixar" }));
    } finally {
      setBaixando((p) => { const n = { ...p }; delete n[c.id]; return n; });
    }
  }

  async function gerarRoteiro(id: string) {
    setGerandoRoteiro((p) => ({ ...p, [id]: true }));
    setErro((p) => ({ ...p, [id]: "" }));
    try {
      const res = await fetch("/api/veiculo/roteiro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? "Erro ao gerar roteiro");
      patchCarro(id, { roteiro_pitch: d.roteiro });
    } catch (e: any) {
      setErro((p) => ({ ...p, [id]: e.message ?? "Erro ao gerar roteiro" }));
    } finally {
      setGerandoRoteiro((p) => ({ ...p, [id]: false }));
    }
  }

  async function gerarReel(id: string) {
    setReelBusy((p) => ({ ...p, [id]: true }));
    setErro((p) => ({ ...p, [id]: "" }));
    try {
      const res = await fetch("/api/marketing/reel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId: id }),
      });
      const d = await res.json();
      if (!res.ok && res.status !== 202) throw new Error(d.error ?? `HTTP ${res.status}`);
      patchCarro(id, { marketing_reel_status: "processando" });
    } catch (e: any) {
      setErro((p) => ({ ...p, [id]: e.message ?? "Erro ao gerar reel" }));
    } finally {
      setReelBusy((p) => ({ ...p, [id]: false }));
    }
  }

  if (loading) {
    return (
      <div className="py-32 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-gray-100 border-t-red-600 rounded-full animate-spin" />
      </div>
    );
  }

  const semKitCount = carros.filter((c) => !c.marketing_capa_url && (c.fotos?.length ?? 0) > 0).length;

  // Filtros da galeria — com 40 carros, cada um com o cartão cheio, achar
  // "o que falta postar" era rolar a página inteira.
  const FILTROS: { id: FiltroKit; label: string; teste: (c: CarroKit) => boolean }[] = [
    { id: "todos",      label: "Todos",        teste: () => true },
    { id: "sem_kit",    label: "Sem kit",      teste: (c) => !c.marketing_capa_url },
    { id: "nao_postado", label: "Não postado", teste: (c) => !!c.marketing_capa_url && noAr(c).length === 0 },
    { id: "no_ar",      label: "No ar",        teste: (c) => noAr(c).length > 0 },
    { id: "reel",       label: "Com reel",     teste: (c) => c.marketing_reel_status === "pronto" },
  ];
  const termo = busca.trim().toLowerCase();
  const testeFiltro = FILTROS.find((f) => f.id === filtroKit)!.teste;
  const visiveis = carros.filter(
    (c) => testeFiltro(c) && (!termo || `${titulo(c)} ${c.versao ?? ""} ${c.ano_modelo ?? c.ano ?? ""}`.toLowerCase().includes(termo)),
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Barra de ações da loja */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={gerarTodos}
          disabled={!!gerandoTodos || semKitCount === 0}
          className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-red-600 transition-all disabled:opacity-50"
        >
          {gerandoTodos ? (
            <><Loader2 size={13} className="animate-spin" /> Gerando {gerandoTodos.atual}/{gerandoTodos.total}...</>
          ) : (
            <><Sparkles size={13} /> Gerar todos os kits ({semKitCount})</>
          )}
        </button>
        <button
          onClick={() => setCfgAberta((v) => !v)}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-[10px] font-black uppercase tracking-wider text-gray-500 hover:bg-gray-50"
        >
          Config da legenda/capa
          <ChevronDown size={13} className={`transition-transform ${cfgAberta ? "rotate-180" : ""}`} />
        </button>
      </div>

      {cfgAberta && (
        <div className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <label className="flex items-center gap-3 text-xs font-bold text-gray-600">
            <input type="checkbox" checked={mostrarPreco} onChange={(e) => alternarCfg("mostrar_preco", e.target.checked)} className="h-4 w-4 accent-red-600" />
            Mostrar preço na capa e na legenda
          </label>
          <div>
            <label className="flex items-center gap-3 text-xs font-bold text-gray-600">
              <input type="checkbox" checked={fotoComMarca} onChange={(e) => alternarCfg("foto_com_marca", e.target.checked)} className="h-4 w-4 accent-red-600" />
              Minhas fotos já têm a marca d&apos;água da loja (não sobrepor o logo)
            </label>
            <p className="ml-7 mt-0.5 text-[10px] font-bold text-gray-400">
              Vale a partir do próximo kit — os já gerados mantêm a capa antiga até você gerar de novo.
            </p>
          </div>

          {/* Logo usada nas postagens (capa do post, capa do reel e contrato) */}
          <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-2.5">
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) subirLogo(f);
                e.target.value = "";
              }}
            />
            <div className="flex h-12 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Logo da loja" className="h-full w-full object-contain p-1" />
              ) : (
                <span className="text-[8px] font-black uppercase tracking-widest text-gray-300">sem logo</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-gray-600">Logo das postagens</p>
              <p className="text-[10px] font-bold text-gray-400">
                Aparece na capa do post e na capa do reel. PNG com fundo transparente fica melhor.
              </p>
            </div>
            <button
              onClick={() => logoInputRef.current?.click()}
              disabled={subindoLogo}
              className="flex-shrink-0 rounded-xl bg-gray-900 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:bg-red-600 disabled:opacity-50"
            >
              {subindoLogo ? "Enviando..." : logoUrl ? "Trocar" : "Enviar"}
            </button>
          </div>
          <input value={claim} onChange={(e) => setClaim(e.target.value)} placeholder="Claim da loja (ex.: Pegamos seu carro na troca e financiamos a diferença)" className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs" maxLength={140} />
          <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="Hashtags fixas (ex.: #minhaloja #riopreto)" className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs" maxLength={300} />
          <div className="flex items-center gap-3">
            <button onClick={salvarCfg} disabled={salvandoCfg} className="rounded-xl bg-gray-900 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-red-600 disabled:opacity-50">
              {salvandoCfg ? "Salvando..." : "Salvar config"}
            </button>
            {cfgSalvo ? <span className="text-[10px] font-black uppercase tracking-widest text-green-600">Salvo ✓</span> : null}
            {cfgErro ? <span className="text-[10px] font-bold text-red-500">{cfgErro}</span> : null}
          </div>
        </div>
      )}

      {/* Busca + filtros */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar carro..."
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-8 pr-3 text-xs font-bold text-gray-700 placeholder:text-gray-300"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1 bg-white rounded-xl p-1 border border-gray-100 shadow-sm w-fit">
          {FILTROS.map((f) => {
            const n = carros.filter(f.teste).length;
            return (
              <button
                key={f.id}
                onClick={() => setFiltroKit(f.id)}
                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${
                  filtroKit === f.id ? "bg-gray-900 text-white shadow" : "text-gray-400 hover:text-gray-700"
                }`}
              >
                {f.label} <span className="opacity-60">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid de carros */}
      {visiveis.length === 0 ? (
        <div className="py-24 text-center bg-white rounded-[3rem] border-2 border-dashed border-gray-100 italic font-black uppercase text-gray-300 tracking-widest text-xs">
          {carros.length === 0 ? "Nenhum veículo disponível no estoque." : "Nenhum carro neste filtro."}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {visiveis.map((c) => {
            const temKit = !!c.marketing_capa_url;
            const reelPronto = c.marketing_reel_status === "pronto" && !!c.marketing_reel_url;
            const vivos = noAr(c);
            const feedNoAr = vivos.filter((p) => p.formato === "feed");
            const reelsNoAr = vivos.filter((p) => p.formato === "reels");
            const faltando = canalFaltando(c);
            const aba: SecaoKit = secao[c.id] ?? (temKit ? "publicar" : "criar");
            const capturaAberta = aberto[c.id] ?? !temKit; // sem kit: captura aberta por padrão

            return (
              <div key={c.id} className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
                {/* Header */}
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 flex-shrink-0 rounded-xl overflow-hidden bg-gray-100">
                    {c.marketing_capa_url || c.fotos?.[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={miniatura(c.marketing_capa_url ?? c.fotos![0], 64)!} alt={titulo(c)} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black uppercase italic text-gray-900 truncate">
                      {titulo(c)} {c.ano_modelo ?? c.ano ?? ""}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${temKit ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}`}>
                        {temKit ? "Kit pronto" : "Sem kit"}
                      </span>
                      {reelPronto && (
                        <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">Reel</span>
                      )}
                      {vivos.length > 0 && (
                        <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                          ● No ar
                        </span>
                      )}
                      {faltando && (
                        <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          ⚠ Falta {faltando === "instagram" ? "Insta" : "Face"}
                        </span>
                      )}
                    </div>
                  </div>
                  <Link href={`/veiculo/${c.id}`} className="text-gray-300 hover:text-gray-600 flex-shrink-0" title="Abrir veículo">
                    <ExternalLink size={14} />
                  </Link>
                </div>

                {/* Seções do cartão — antes era tudo empilhado (~10 blocos) */}
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-gray-50 p-1">
                  {([
                    ["criar", "Criar", <Sparkles key="i" size={11} />],
                    ["publicar", "Publicar", <Send key="i" size={11} />],
                    ["reel", "Reel", <Film key="i" size={11} />],
                  ] as const).map(([id, label, icone]) => (
                    <button
                      key={id}
                      onClick={() => setSecao((p) => ({ ...p, [c.id]: id }))}
                      className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-[9px] font-black uppercase tracking-widest transition-all ${
                        aba === id ? "bg-white text-gray-900 shadow-sm" : "text-gray-400 hover:text-gray-700"
                      }`}
                    >
                      {icone} {label}
                    </button>
                  ))}
                </div>

                {/* ─── CRIAR: material + geração do kit ─── */}
                {aba === "criar" && (
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-[1fr_auto] gap-1.5">
                      <button
                        onClick={async () => { if (await gerar(c.id)) setSecao((p) => ({ ...p, [c.id]: "publicar" })); }}
                        disabled={gerando[c.id]}
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-gray-900 py-2.5 font-black uppercase italic text-white transition-all hover:bg-red-600 disabled:opacity-50 text-xs"
                      >
                        {gerando[c.id] ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        {gerando[c.id] ? "Gerando..." : temKit ? "Regerar kit" : "Gerar kit"}
                      </button>
                      <button
                        onClick={() => gerar(c.id, true)}
                        disabled={gerando[c.id]}
                        title="Gera só a capa (feed + story) e a legenda, sem os slides do carrossel"
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-gray-100 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-700 transition-all hover:bg-gray-200 disabled:opacity-50"
                      >
                        <ImageIcon size={13} /> Só capa
                      </button>
                    </div>

                    <button
                      onClick={() => setAberto((p) => ({ ...p, [c.id]: !capturaAberta }))}
                      className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-gray-500 hover:bg-gray-100"
                    >
                      Captura guiada (fotos + takes)
                      <ChevronDown size={13} className={`transition-transform ${capturaAberta ? "rotate-180" : ""}`} />
                    </button>
                    {capturaAberta && (
                      <CapturaGuiada
                        veiculoId={c.id}
                        capturas={c.marketing_capturas ?? {}}
                        videoUrl={c.video_url}
                        onChange={(cap, fotosNovas) =>
                          patchCarro(c.id, { marketing_capturas: cap, ...(fotosNovas ? { fotos: fotosNovas } : {}) })
                        }
                      />
                    )}

                    <button
                      onClick={() => setPisoAberto((p) => ({ ...p, [c.id]: !p[c.id] }))}
                      className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-gray-500 hover:bg-gray-100"
                    >
                      <span className="flex items-center gap-1.5"><Wand2 size={12} /> Piso e calçada</span>
                      <ChevronDown size={13} className={`transition-transform ${pisoAberto[c.id] ? "rotate-180" : ""}`} />
                    </button>
                    {pisoAberto[c.id] && (
                      <PisoRestauro
                        veiculoId={c.id}
                        fotos={c.fotos ?? []}
                        capturas={c.marketing_capturas ?? {}}
                        onChange={(cap, fotosNovas) =>
                          patchCarro(c.id, { marketing_capturas: cap, ...(fotosNovas ? { fotos: fotosNovas } : {}) })
                        }
                        onAplicado={() => { if (c.marketing_capa_url) gerar(c.id); }}
                      />
                    )}

                    <button
                      onClick={() => setRoteiroAberto((p) => ({ ...p, [c.id]: !p[c.id] }))}
                      className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-gray-500 hover:bg-gray-100"
                    >
                      <span className="flex items-center gap-1.5"><Video size={12} /> Roteiro de venda (Reels/TikTok)</span>
                      <ChevronDown size={13} className={`transition-transform ${roteiroAberto[c.id] ? "rotate-180" : ""}`} />
                    </button>
                    {roteiroAberto[c.id] && (
                      <div className="rounded-xl bg-gray-50 p-3">
                        <button
                          onClick={() => gerarRoteiro(c.id)}
                          disabled={gerandoRoteiro[c.id]}
                          className="w-full py-2.5 bg-gray-900 text-white text-[10px] font-black uppercase italic rounded-xl hover:bg-red-600 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {gerandoRoteiro[c.id] ? <Loader2 size={13} className="animate-spin" /> : <Video size={13} />}
                          {gerandoRoteiro[c.id] ? "Roteirizando..." : c.roteiro_pitch ? "Regerar roteiro" : "Gerar roteiro"}
                        </button>
                        {c.roteiro_pitch && (
                          <pre className="mt-3 text-[10px] text-gray-600 whitespace-pre-wrap font-sans leading-relaxed italic">
                            {c.roteiro_pitch}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ─── PUBLICAR: legenda, postar (grátis), anunciar (pago) ─── */}
                {aba === "publicar" && (
                  !temKit ? (
                    <div className="rounded-xl bg-gray-50 p-4 text-center">
                      <p className="text-[10px] font-bold text-gray-400 mb-2">Gere o kit pra ter a arte e a legenda.</p>
                      <button
                        onClick={() => setSecao((p) => ({ ...p, [c.id]: "criar" }))}
                        className="rounded-xl bg-gray-900 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:bg-red-600"
                      >
                        Ir para Criar
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      {(c.marketing_carrossel?.length ?? 0) > 1 && (
                        <div className="flex gap-1.5 overflow-x-auto pb-1" title="Post de feed: sai como carrossel nesta ordem">
                          {c.marketing_carrossel!.map((u, i) => (
                            <div key={u} className="relative flex-shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={miniatura(u, 48)!} alt={`Slide ${i + 1}`} loading="lazy" decoding="async" className="w-12 h-12 rounded-lg object-cover border border-gray-100" />
                              <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-gray-900 text-white text-[8px] font-black flex items-center justify-center">{i + 1}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <textarea
                        // key muda a cada "Regerar kit" (marketing_capa_url carrega
                        // timestamp) — força o React a remontar o campo com o
                        // defaultValue novo. Sem isso, defaultValue só pega na
                        // primeira renderização e o campo fica preso na legenda
                        // antiga (ou vazio, se abriu antes do kit existir).
                        key={`${c.id}-${c.marketing_capa_url ?? ""}`}
                        ref={(el) => { legendaRefs.current[c.id] = el; }}
                        defaultValue={c.marketing_legenda ?? ""}
                        rows={5}
                        // Salva sozinha ao sair do campo — o botão "Salvar legenda" saiu.
                        onBlur={(e) => {
                          if (e.target.value !== (c.marketing_legenda ?? "")) {
                            patchCarro(c.id, { marketing_legenda: e.target.value });
                            salvarLegenda(c.id, e.target.value);
                          }
                        }}
                        className="w-full rounded-2xl border border-gray-100 bg-gray-50 p-3 text-xs leading-relaxed"
                      />

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[9px] font-black uppercase tracking-widest text-gray-400">
                        <button onClick={() => copiar(c.id, legendaRefs.current[c.id]?.value ?? c.marketing_legenda ?? "")} className="flex items-center gap-1 hover:text-gray-700">
                          {copiado === c.id ? <Check size={11} className="text-green-600" /> : <Copy size={11} />} {copiado === c.id ? "Copiada" : "Copiar legenda"}
                        </button>
                        <span className="text-gray-200">|</span>
                        <span>Baixar:</span>
                        <button onClick={() => baixar(c, "carrossel")} disabled={!!baixando[c.id]} className="flex items-center gap-1 hover:text-gray-700 disabled:opacity-40">
                          {baixando[c.id] === "carrossel" ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} Feed ({c.marketing_carrossel?.length || 1})
                        </button>
                        <button onClick={() => baixar(c, "story")} disabled={!c.marketing_story_url || !!baixando[c.id]} className="flex items-center gap-1 hover:text-gray-700 disabled:opacity-40">
                          {baixando[c.id] === "story" ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} Story
                        </button>
                      </div>

                      {/* POSTAR — grátis, no Face e Insta da loja */}
                      <div className="rounded-2xl border border-gray-100 p-3 flex flex-col gap-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">
                          Postar no seu Face e Insta <span className="ml-1 rounded-full bg-green-100 px-1.5 py-0.5 text-green-700">grátis</span>
                        </p>

                        {feedNoAr.length === 0 ? (
                          <button
                            onClick={() => postarAgora(c.id, ["facebook", "instagram"], "feed")}
                            disabled={!!postando[c.id]}
                            className="flex items-center justify-center gap-1.5 rounded-xl bg-gray-900 py-2.5 text-[9px] font-black uppercase tracking-widest text-white hover:bg-red-600 disabled:opacity-50"
                          >
                            {postando[c.id] ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                            {postando[c.id] ? "Postando..." : "Postar no feed (Face + Insta)"}
                          </button>
                        ) : (
                          <div className="flex items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] font-black uppercase tracking-widest text-emerald-700">
                              <span>● No feed</span>
                              {feedNoAr.map((p) => (
                                <a key={p.post_id} href={p.permalink || undefined} target="_blank" rel="noopener noreferrer"
                                  className="underline decoration-dotted underline-offset-2 hover:text-emerald-900">
                                  {p.destino === "facebook" ? "Facebook" : "Instagram"} · {desde(p.em)}
                                </a>
                              ))}
                            </div>
                            <button
                              onClick={() => substituirPost(c, "feed")}
                              disabled={!!postando[c.id]}
                              title="Apaga o post atual e publica o kit de novo no lugar"
                              className="flex flex-shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-gray-600 border border-gray-200 hover:bg-gray-100 disabled:opacity-50"
                            >
                              {postando[c.id] ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                              Substituir
                            </button>
                          </div>
                        )}

                        {/* Publicou num canal e falhou no outro — reenvia SÓ o que faltou. */}
                        {faltando && (
                          <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2">
                            <span className="text-[9px] font-black uppercase tracking-widest text-amber-700">
                              ⚠ Não saiu no {faltando === "instagram" ? "Instagram" : "Facebook"}
                            </span>
                            <button
                              onClick={() => postarAgora(c.id, [faltando], "feed")}
                              disabled={!!postando[c.id]}
                              className="flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-white hover:bg-amber-700 disabled:opacity-50"
                            >
                              {postando[c.id] ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                              Reenviar
                            </button>
                          </div>
                        )}

                        <button
                          onClick={() => postarAgora(c.id, ["instagram"], "story")}
                          disabled={!c.marketing_story_url || !!postando[c.id]}
                          title={c.marketing_story_url ? "Publica a arte 9:16 como story no Instagram (some em 24h)" : "Gere o kit pra ter a arte de story"}
                          className="flex items-center justify-center gap-1.5 rounded-xl bg-gray-100 py-2 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200 disabled:opacity-40"
                        >
                          <Send size={11} /> Story no Insta (24h)
                        </button>

                        {postado[c.id] && (
                          <p className="text-[9px] font-black uppercase tracking-widest text-green-600">✓ No ar no {postado[c.id]}</p>
                        )}
                      </div>

                      {/* ANUNCIAR — pago, Meta Ads */}
                      <PublicarKit carro={c} />
                    </div>
                  )
                )}

                {/* ─── REEL ─── */}
                {aba === "reel" && (
                  <div className="flex flex-col gap-2">
                    {reelPronto ? (
                      <>
                        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                        <video src={reelToProxy(c.marketing_reel_url!)} controls className="w-full max-h-[420px] rounded-xl border border-gray-100 bg-black" />
                        <div className="flex items-center gap-2">
                          <button onClick={() => baixarReel(c)} disabled={!!baixando[c.id]} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-100 py-2.5 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200 disabled:opacity-40">
                            {baixando[c.id] === "reel" ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} {baixando[c.id] === "reel" ? "Baixando..." : "Baixar reel"}
                          </button>
                          <button onClick={() => gerarReel(c.id)} disabled={reelBusy[c.id]} title="Regerar reel" className="flex items-center justify-center rounded-xl bg-gray-900 px-3 py-2.5 text-white hover:bg-red-600 disabled:opacity-50">
                            {reelBusy[c.id] ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                          </button>
                        </div>

                        {/* Reels fica no perfil pra sempre (anti-duplicado igual ao
                            feed); story some em 24h e pode repetir. */}
                        <div className="rounded-2xl border border-gray-100 p-3 flex flex-col gap-2">
                          <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">
                            Postar no Insta <span className="ml-1 rounded-full bg-green-100 px-1.5 py-0.5 text-green-700">grátis</span>
                          </p>
                          {reelsNoAr.length === 0 ? (
                            <button
                              onClick={() => postarAgora(c.id, ["instagram"], "reels")}
                              disabled={!!postando[c.id]}
                              className="flex items-center justify-center gap-1.5 rounded-xl bg-gray-900 py-2.5 text-[9px] font-black uppercase tracking-widest text-white hover:bg-red-600 disabled:opacity-50"
                            >
                              {postando[c.id] ? <Loader2 size={12} className="animate-spin" /> : <Film size={12} />}
                              {postando[c.id] ? "Postando..." : "Postar como Reels"}
                            </button>
                          ) : (
                            <div className="flex items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2">
                              <div className="flex flex-wrap items-center gap-x-2 text-[9px] font-black uppercase tracking-widest text-emerald-700">
                                <span>● Reels</span>
                                {reelsNoAr.map((p) => (
                                  <a key={p.post_id} href={p.permalink || undefined} target="_blank" rel="noopener noreferrer"
                                    className="underline decoration-dotted underline-offset-2 hover:text-emerald-900">
                                    Instagram · {desde(p.em)}
                                  </a>
                                ))}
                              </div>
                              <button
                                onClick={() => substituirPost(c, "reels")}
                                disabled={!!postando[c.id]}
                                className="flex flex-shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-gray-600 border border-gray-200 hover:bg-gray-100 disabled:opacity-50"
                              >
                                {postando[c.id] ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                                Substituir
                              </button>
                            </div>
                          )}
                          <button
                            onClick={() => postarAgora(c.id, ["instagram"], "story_video")}
                            disabled={!!postando[c.id]}
                            title="Publica o mesmo vídeo como story (some em 24h)"
                            className="flex items-center justify-center gap-1.5 rounded-xl bg-gray-100 py-2 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200 disabled:opacity-40"
                          >
                            <Send size={11} /> Story com o vídeo (24h)
                          </button>
                        </div>
                      </>
                    ) : c.marketing_reel_status === "processando" ? (
                      <div className="flex items-center gap-2 py-2 text-[10px] font-bold text-gray-500">
                        <Loader2 size={13} className="animate-spin" /> Renderizando o vídeo... (pode levar alguns minutos)
                      </div>
                    ) : temTakes(c) ? (
                      <button onClick={() => gerarReel(c.id)} disabled={reelBusy[c.id]} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 py-2.5 text-[10px] font-black uppercase tracking-widest text-white hover:bg-red-600 disabled:opacity-50">
                        {reelBusy[c.id] ? <Loader2 size={12} className="animate-spin" /> : <Film size={12} />}
                        {c.marketing_reel_status === "erro" ? "Tentar de novo" : "Gerar reel"}
                      </button>
                    ) : (
                      <div className="rounded-xl bg-gray-50 p-4 text-center">
                        <p className="text-[10px] font-bold text-gray-400 mb-2">Suba os takes na captura guiada pra liberar o reel.</p>
                        <button
                          onClick={() => { setSecao((p) => ({ ...p, [c.id]: "criar" })); setAberto((p) => ({ ...p, [c.id]: true })); }}
                          className="rounded-xl bg-gray-900 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:bg-red-600"
                        >
                          Abrir captura guiada
                        </button>
                      </div>
                    )}

                    {/* Editor estilo CapCut: duração + legenda de cada take */}
                    {temTakes(c) && c.marketing_reel_status !== "processando" && (
                      <>
                        <button
                          onClick={() => setEditando((p) => ({ ...p, [c.id]: !p[c.id] }))}
                          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white py-2 text-[9px] font-black uppercase tracking-widest text-gray-500 hover:bg-gray-100"
                        >
                          <Wand2 size={12} /> {editando[c.id] ? "Fechar editor" : "Editar takes e legendas"}
                        </button>
                        {editando[c.id] && (
                          <ReelEditor
                            veiculoId={c.id}
                            capturasVersao={(c.marketing_capturas?.takes ?? []).map((t) => `${t.tag}:${t.url}`).join("|")}
                            onGerar={() => {
                              setEditando((p) => ({ ...p, [c.id]: false }));
                              gerarReel(c.id);
                            }}
                          />
                        )}
                      </>
                    )}
                  </div>
                )}

                <div className="min-h-[14px]">
                  {salvando[c.id] === "salvando" && <span className="text-[9px] font-bold text-gray-400">Salvando legenda...</span>}
                  {salvando[c.id] === "ok" && <span className="text-[9px] font-bold text-green-600">Legenda salva ✓</span>}
                  {erro[c.id] && <span className="text-[9px] font-bold text-red-500">{erro[c.id]}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
