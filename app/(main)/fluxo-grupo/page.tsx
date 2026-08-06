"use client";

// Fluxo Grupo — quadro do repasse automático em comunidade.
// Mostra cada carro do estoque com o HORÁRIO previsto de envio (calculado pela
// ordem determinística do rodízio) e um Pausar por carro. Embaixo, a config do
// fluxo (grupos, intervalo, janela, bom dia) que ANTES vivia em Configurações.

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useUserRole } from "@/components/SidebarWrapper";
import { computarAgenda, baseDoProximoEnvio, type AgendaCfg } from "@/lib/repasse-agenda";
import {
  Car, Clock, Pause, Play, Loader2, CheckCircle2, Image as ImageIcon, Users, Radio, GripVertical,
} from "lucide-react";

interface Veiculo {
  id: string; marca: string | null; modelo: string | null; ano_modelo: number | null;
  capa_marketing_url: string | null; fotos: string[] | null;
  repasse_enviado_em: string | null; repasse_pausado: boolean; repasse_ordem: number | null;
}
interface Cfg {
  id?: string;
  repasse_grupos?: { jid: string; nome: string | null }[];
  repasse_auto_ativo?: boolean;
  repasse_intervalo_min?: number;
  repasse_qtd_por_envio?: number;
  repasse_janela_inicio?: number;
  repasse_janela_fim?: number;
  repasse_janela_fim_sabado?: number;
  repasse_bomdia_ativo?: boolean;
  repasse_cta_ativo?: boolean;
  repasse_link_comunidade?: string;
  repasse_link_instagram?: string;
  repasse_bomdia_logo_url?: string | null;
  avisa_base_url?: string | null;
  avisa_token?: string | null;
}

const fotoDe = (v: Veiculo) => v.capa_marketing_url || v.fotos?.[0] || null;

// Horário amigável em BRT: "Hoje 14:00" / "Amanhã 09:00" / "Seg 21/07 08:00"
function labelHorario(d: Date, agora: Date): string {
  const TZ = "America/Sao_Paulo";
  const hhmm = d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  const dia = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: TZ });
  if (dia(d) === dia(agora)) return `Hoje ${hhmm}`;
  if (dia(d) === dia(new Date(agora.getTime() + 86_400_000))) return `Amanhã ${hhmm}`;
  const dow = d.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short" }).replace(".", "");
  const dm = d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
  return `${dow} ${dm} ${hhmm}`;
}

export default function FluxoGrupo() {
  const { effectiveUserId } = useUserRole();
  const [carros, setCarros] = useState<Veiculo[]>([]);
  const [config, setConfig] = useState<Cfg>({});
  const [loading, setLoading] = useState(true);
  const [pausandoId, setPausandoId] = useState<string | null>(null);
  const agora = useMemo(() => new Date(), [carros]); // recalcula ao recarregar

  // Config panel
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [gruposDisponiveis, setGruposDisponiveis] = useState<{ jid: string; name: string }[] | null>(null);
  const [grupoSelecionado, setGrupoSelecionado] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const [vinculando, setVinculando] = useState(false);
  const [erroGrupos, setErroGrupos] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);

  const carregar = async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    const [{ data: cfgRows }, { data: veic }] = await Promise.all([
      supabase.from("config_garage")
        .select("id, repasse_grupos, repasse_auto_ativo, repasse_intervalo_min, repasse_qtd_por_envio, repasse_janela_inicio, repasse_janela_fim, repasse_janela_fim_sabado, repasse_bomdia_ativo, repasse_cta_ativo, repasse_link_comunidade, repasse_link_instagram, repasse_bomdia_logo_url, avisa_base_url, avisa_token")
        .eq("user_id", effectiveUserId).order("created_at", { ascending: false }).limit(1),
      supabase.from("veiculos")
        .select("id, marca, modelo, ano_modelo, capa_marketing_url, fotos, repasse_enviado_em, repasse_pausado, repasse_ordem")
        .eq("user_id", effectiveUserId).eq("status_venda", "DISPONIVEL").gt("preco_sugerido", 0),
    ]);
    setConfig((cfgRows?.[0] as Cfg) ?? {});
    setCarros((veic as Veiculo[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [effectiveUserId]);

  const cfgAgenda: AgendaCfg = {
    intervaloMin: config.repasse_intervalo_min ?? 120,
    janelaInicio: config.repasse_janela_inicio ?? 8,
    janelaFim: config.repasse_janela_fim ?? 18,
    janelaFimSabado: config.repasse_janela_fim_sabado ?? 12,
    qtdPorEnvio: config.repasse_qtd_por_envio ?? 1,
  };

  // Ordem: manual (repasse_ordem, arrastar) primeiro; sem ordem cai no rodízio
  // (mais antigo sem sair primeiro; NULL enviado = nunca enviado vem antes).
  const ativos = useMemo(() =>
    carros.filter(c => !c.repasse_pausado).sort((a, b) => {
      const oa = a.repasse_ordem ?? Infinity, ob = b.repasse_ordem ?? Infinity;
      if (oa !== ob) return oa - ob;
      const ta = a.repasse_enviado_em ? Date.parse(a.repasse_enviado_em) : 0;
      const tb = b.repasse_enviado_em ? Date.parse(b.repasse_enviado_em) : 0;
      return ta - tb;
    }), [carros]);
  const pausados = useMemo(() => carros.filter(c => c.repasse_pausado), [carros]);

  // ── Arrastar pra reordenar a fila ──
  const [dragId, setDragId] = useState<string | null>(null);
  const reordenar = (fromId: string, sobreId: string) => {
    if (fromId === sobreId) return;
    const arr = [...ativos];
    const from = arr.findIndex(c => c.id === fromId);
    const to = arr.findIndex(c => c.id === sobreId);
    if (from < 0 || to < 0) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    const pos = new Map(arr.map((c, i) => [c.id, i]));
    setCarros(prev => prev.map(c => pos.has(c.id) ? { ...c, repasse_ordem: pos.get(c.id)! } : c));
  };
  const persistirOrdem = async () => {
    setDragId(null);
    try {
      await fetch("/api/repasse/ordem", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ativos.map(c => c.id) }),
      });
    } catch { /* silencioso — a ordem otimista já está na tela */ }
  };

  const agenda = useMemo(() => {
    const ultimo = carros.reduce<number>((m, c) => {
      const t = c.repasse_enviado_em ? Date.parse(c.repasse_enviado_em) : 0;
      return t > m ? t : m;
    }, 0);
    const base = baseDoProximoEnvio(ultimo ? new Date(ultimo) : null, cfgAgenda.intervaloMin, agora);
    return computarAgenda(ativos.map(c => c.id), base, cfgAgenda);
    // eslint-disable-next-line
  }, [ativos, carros, config]);

  const togglePausa = async (v: Veiculo) => {
    setPausandoId(v.id);
    // otimista
    setCarros(prev => prev.map(c => c.id === v.id ? { ...c, repasse_pausado: !c.repasse_pausado } : c));
    try {
      const res = await fetch("/api/veiculo/patch", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId: v.id, fields: { repasse_pausado: !v.repasse_pausado } }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setCarros(prev => prev.map(c => c.id === v.id ? { ...c, repasse_pausado: v.repasse_pausado } : c)); // rollback
      alert("Não consegui salvar. Tente de novo.");
    } finally {
      setPausandoId(null);
    }
  };

  // ── Config: grupos ──
  const sincronizarGrupos = async () => {
    setSincronizando(true); setErroGrupos(null);
    try {
      const res = await fetch("/api/repasse/grupos");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao sincronizar");
      setGruposDisponiveis(data.grupos ?? []);
    } catch (e: any) { setErroGrupos(e.message); } finally { setSincronizando(false); }
  };
  const vincularGrupo = async (jid: string) => {
    if (!jid) return;
    setVinculando(true); setErroGrupos(null);
    try {
      const nome = gruposDisponiveis?.find(g => g.jid === jid)?.name ?? null;
      const res = await fetch("/api/repasse/grupos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grupoJid: jid, grupoNome: nome }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao vincular");
      setConfig(c => ({ ...c, repasse_grupos: data.grupos }));
      setGrupoSelecionado("");
    } catch (e: any) { setErroGrupos(e.message); } finally { setVinculando(false); }
  };
  const desvincularGrupo = async (jid: string) => {
    setVinculando(true);
    try {
      const res = await fetch(`/api/repasse/grupos?jid=${encodeURIComponent(jid)}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) setConfig(c => ({ ...c, repasse_grupos: data.grupos }));
    } finally { setVinculando(false); }
  };

  const handleUploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !config.id) return;
    setUploadingLogo(true);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("tipo", "bomdia");
      const res = await fetch("/api/configuracoes/logo", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha no upload");
      const url = `${data.url}?t=${Date.now()}`;
      await supabase.from("config_garage").update({ repasse_bomdia_logo_url: url }).eq("id", config.id);
      setConfig(c => ({ ...c, repasse_bomdia_logo_url: url }));
    } catch (err: any) { alert("Erro ao subir logo: " + err.message); }
    finally { setUploadingLogo(false); if (logoRef.current) logoRef.current.value = ""; }
  };
  const removerLogo = async () => {
    if (!config.id) return;
    await supabase.from("config_garage").update({ repasse_bomdia_logo_url: null }).eq("id", config.id);
    setConfig(c => ({ ...c, repasse_bomdia_logo_url: null }));
  };

  const salvarConfig = async () => {
    if (!config.id) return;
    setSalvando(true);
    try {
      const { error } = await supabase.from("config_garage").update({
        repasse_auto_ativo: config.repasse_auto_ativo ?? false,
        repasse_intervalo_min: config.repasse_intervalo_min ?? 120,
        repasse_qtd_por_envio: config.repasse_qtd_por_envio ?? 1,
        repasse_janela_inicio: config.repasse_janela_inicio ?? 8,
        repasse_janela_fim: config.repasse_janela_fim ?? 18,
        repasse_janela_fim_sabado: config.repasse_janela_fim_sabado ?? 12,
        repasse_bomdia_ativo: config.repasse_bomdia_ativo ?? true,
        repasse_cta_ativo: config.repasse_cta_ativo ?? true,
        repasse_link_comunidade: config.repasse_link_comunidade || null,
        repasse_link_instagram: config.repasse_link_instagram || null,
      }).eq("id", config.id);
      if (!error) { setSalvo(true); setTimeout(() => setSalvo(false), 2500); }
    } finally { setSalvando(false); }
  };

  const temGrupo = (config.repasse_grupos ?? []).length > 0;
  const inputCls = "bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition";
  const labelCls = "text-[10px] font-black uppercase tracking-widest text-gray-500";

  return (
    <main className="flex-1 p-6 md:p-10 overflow-y-auto bg-[#f4f4f2]">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8">
          <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter italic text-gray-900 leading-none">
            Fluxo <span className="text-red-600">Grupo</span>
          </h1>
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mt-2">
            Rodízio automático pras comunidades — arraste pra reordenar a fila
          </p>
        </header>

        {/* Estado do fluxo */}
        <div className={`flex items-center gap-3 rounded-2xl px-5 py-4 mb-6 border ${config.repasse_auto_ativo && temGrupo ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
          <Radio size={16} className={config.repasse_auto_ativo && temGrupo ? "text-green-600" : "text-amber-500"} />
          <p className="text-[11px] font-bold text-gray-700">
            {!temGrupo ? "Sem grupo vinculado — configure abaixo pra ligar o fluxo."
              : config.repasse_auto_ativo ? "Fluxo ligado — os carros abaixo saem nos horários previstos."
              : "Fluxo desligado — ligue o envio automático na configuração abaixo."}
          </p>
        </div>

        {/* ── BOARD ── */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-gray-300" size={28} /></div>
        ) : (
          <div className="flex flex-col gap-3 mb-12">
            {ativos.map((v, i) => {
              const t = agenda.get(v.id);
              return (
                <div
                  key={v.id}
                  draggable
                  onDragStart={() => setDragId(v.id)}
                  onDragOver={(e) => { e.preventDefault(); if (dragId && dragId !== v.id) reordenar(dragId, v.id); }}
                  onDragEnd={persistirOrdem}
                  className={`flex items-center gap-3 md:gap-4 bg-white rounded-2xl border shadow-sm p-3 md:p-4 transition ${dragId === v.id ? "border-green-400 opacity-50" : "border-gray-100"}`}
                >
                  <span className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 touch-none shrink-0" title="Arraste para reordenar">
                    <GripVertical size={16} />
                  </span>
                  <span className="text-[10px] font-black text-gray-300 w-4 text-center shrink-0">{i + 1}</span>
                  <div className="w-16 h-12 md:w-20 md:h-14 rounded-xl overflow-hidden bg-gray-100 shrink-0 flex items-center justify-center">
                    {fotoDe(v) ? <img src={fotoDe(v)!} alt="" className="w-full h-full object-cover" /> : <Car size={18} className="text-gray-300" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black uppercase italic text-gray-900 truncate">{v.marca} {v.modelo}</p>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{v.ano_modelo ?? "—"}</p>
                  </div>
                  <div className="hidden sm:flex items-center gap-1.5 text-green-700 shrink-0">
                    <Clock size={13} />
                    <span className="text-[11px] font-black uppercase tracking-widest">
                      {config.repasse_auto_ativo && temGrupo && t ? labelHorario(t, agora) : "—"}
                    </span>
                  </div>
                  <button
                    onClick={() => togglePausa(v)}
                    disabled={pausandoId === v.id}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 text-gray-600 text-[10px] font-black uppercase tracking-widest hover:bg-amber-100 hover:text-amber-700 transition shrink-0 disabled:opacity-50"
                  >
                    {pausandoId === v.id ? <Loader2 size={13} className="animate-spin" /> : <Pause size={13} />} Pausar
                  </button>
                </div>
              );
            })}

            {ativos.length === 0 && (
              <p className="text-center text-xs text-gray-400 italic py-10 bg-white rounded-2xl border border-dashed border-gray-200">
                Nenhum carro no fluxo. Cadastre carros com preço ou despause abaixo.
              </p>
            )}

            {/* Pausados */}
            {pausados.length > 0 && (
              <div className="mt-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-2">
                  <Pause size={12} /> Pausados ({pausados.length}) — fora do fluxo até você despausar
                </p>
                <div className="flex flex-col gap-3">
                  {pausados.map(v => (
                    <div key={v.id} className="flex items-center gap-4 bg-white rounded-2xl border border-gray-100 shadow-sm p-3 md:p-4 opacity-70">
                      <div className="w-16 h-12 md:w-20 md:h-14 rounded-xl overflow-hidden bg-gray-100 shrink-0 flex items-center justify-center grayscale">
                        {fotoDe(v) ? <img src={fotoDe(v)!} alt="" className="w-full h-full object-cover" /> : <Car size={18} className="text-gray-300" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black uppercase italic text-gray-700 truncate">{v.marca} {v.modelo}</p>
                        <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Pausado</p>
                      </div>
                      <button
                        onClick={() => togglePausa(v)}
                        disabled={pausandoId === v.id}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-green-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-green-700 transition shrink-0 disabled:opacity-50"
                      >
                        {pausandoId === v.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Voltar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CONFIG (movido de Configurações → Whats) ── */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6 md:p-8">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-1 flex items-center gap-2">
            <Users size={13} /> Configuração do fluxo
          </h2>
          <p className="text-[11px] text-gray-500 mb-6">Grupos de destino, cadência, janela de horário e o bom dia diário.</p>

          {/* Grupos vinculados */}
          <div className="mb-5 flex flex-col gap-3">
            {temGrupo ? (config.repasse_grupos ?? []).map(g => (
              <div key={g.jid} className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-2xl">
                <CheckCircle2 size={13} className="text-green-500 shrink-0" />
                <span className="text-[11px] font-bold text-green-700 truncate">{g.nome || g.jid.slice(0, 12) + "..."}</span>
                <button onClick={() => desvincularGrupo(g.jid)} disabled={vinculando} className="ml-auto text-[9px] font-black uppercase tracking-widest text-red-400 hover:text-red-600 transition shrink-0">Desvincular</button>
              </div>
            )) : (
              <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-2xl">
                <p className="text-[10px] text-amber-700">Nenhum grupo vinculado. Adicione o número do agente ao grupo/comunidade e clique em <strong>Sincronizar grupos</strong>.</p>
              </div>
            )}

            {gruposDisponiveis === null ? (
              <button onClick={sincronizarGrupos} disabled={sincronizando} className="self-start px-4 py-2 rounded-xl bg-gray-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-green-600 transition disabled:opacity-50">
                {sincronizando ? "Sincronizando..." : "🔄 Sincronizar grupos"}
              </button>
            ) : (() => {
              const vinc = new Set((config.repasse_grupos ?? []).map(g => g.jid));
              const disp = gruposDisponiveis.filter(g => !vinc.has(g.jid));
              return disp.length > 0 ? (
                <div className="flex gap-2 items-center">
                  <select value={grupoSelecionado} onChange={e => setGrupoSelecionado(e.target.value)} className={`flex-1 ${inputCls}`}>
                    <option value="">Escolha o grupo para adicionar...</option>
                    {disp.map(g => <option key={g.jid} value={g.jid}>{g.name}</option>)}
                  </select>
                  <button onClick={() => vincularGrupo(grupoSelecionado)} disabled={!grupoSelecionado || vinculando} className="px-4 py-2.5 rounded-xl bg-green-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-green-700 transition disabled:opacity-40 shrink-0">
                    {vinculando ? "..." : "+ Vincular"}
                  </button>
                </div>
              ) : <p className="text-[10px] text-gray-400 italic">Todos os grupos da instância já estão vinculados.</p>;
            })()}
            {erroGrupos && <p className="text-[10px] text-red-500">{erroGrupos}</p>}
          </div>

          <div className="flex flex-col gap-5">
            {/* Envio automático */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-700">Envio automático</p>
                <p className="text-[9px] text-gray-400 mt-0.5">{temGrupo ? "Ativa o rodízio programado de anúncios" : "Vincule uma comunidade para habilitar"}</p>
              </div>
              <button type="button" disabled={!temGrupo} onClick={() => setConfig(c => ({ ...c, repasse_auto_ativo: !c.repasse_auto_ativo }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${config.repasse_auto_ativo && temGrupo ? "bg-green-500" : "bg-gray-200"} ${!temGrupo ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${config.repasse_auto_ativo && temGrupo ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>

            {/* Intervalo + carros por envio */}
            <div className="flex gap-3">
              <div className="flex flex-col gap-1.5 flex-1">
                <label className={labelCls}>Intervalo entre anúncios</label>
                <select value={config.repasse_intervalo_min ?? 120} onChange={e => setConfig(c => ({ ...c, repasse_intervalo_min: Number(e.target.value) }))} className={inputCls}>
                  <option value={10}>10 minutos</option><option value={15}>15 minutos</option><option value={30}>30 minutos</option>
                  <option value={60}>1 hora</option><option value={120}>2 horas</option><option value={180}>3 horas</option><option value={240}>4 horas</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <label className={labelCls}>Carros por envio</label>
                <select value={config.repasse_qtd_por_envio ?? 1} onChange={e => setConfig(c => ({ ...c, repasse_qtd_por_envio: Number(e.target.value) }))} className={inputCls}>
                  {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} carro{n > 1 ? "s" : ""}</option>)}
                </select>
              </div>
            </div>

            {/* Janela */}
            <div className="flex gap-3">
              {([["repasse_janela_inicio", "Início", 8], ["repasse_janela_fim", "Fim", 18], ["repasse_janela_fim_sabado", "Fim (sábado)", 12]] as const).map(([k, lbl, def]) => (
                <div key={k} className="flex flex-col gap-1.5 flex-1">
                  <label className={labelCls}>{lbl}</label>
                  <select value={(config as any)[k] ?? def} onChange={e => setConfig(c => ({ ...c, [k]: Number(e.target.value) }))} className={inputCls}>
                    {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}h</option>)}
                  </select>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 italic">Horário de Brasília. O fluxo pula domingo e fecha mais cedo no sábado. Só carros disponíveis com preço entram — na ordem do rodízio, pulando os pausados.</p>

            {/* Link "Falar com Vendedor" no anúncio */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-700">Link “Falar com Vendedor”</p>
                <p className="text-[9px] text-gray-400 mt-0.5">Desligue se o WhatsApp do agente é o seu número pessoal — o anúncio sai sem o wa.me</p>
              </div>
              <button type="button" onClick={() => setConfig(c => ({ ...c, repasse_cta_ativo: !(c.repasse_cta_ativo ?? true) }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${(config.repasse_cta_ativo ?? true) ? "bg-green-500" : "bg-gray-200"}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${(config.repasse_cta_ativo ?? true) ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>

            {/* Bom dia */}
            <div className="border-t border-gray-100 pt-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-700">Bom dia diário</p>
                  <p className="text-[9px] text-gray-400 mt-0.5">1 mensagem de bom dia com frase motivacional antes do rodízio (muda todo dia)</p>
                </div>
                <button type="button" onClick={() => setConfig(c => ({ ...c, repasse_bomdia_ativo: !c.repasse_bomdia_ativo }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${config.repasse_bomdia_ativo ? "bg-green-500" : "bg-gray-200"}`}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${config.repasse_bomdia_ativo ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Logo do card de convite <span className="text-gray-400 normal-case font-normal">(só na mensagem de bom dia)</span></label>
                <div className="flex items-center gap-3">
                  {config.repasse_bomdia_logo_url ? (
                    <img src={config.repasse_bomdia_logo_url} alt="" className="w-12 h-12 rounded-xl object-cover border border-gray-200" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-[#f5f5f3] border border-gray-200 flex items-center justify-center"><ImageIcon className="w-5 h-5 text-gray-300" /></div>
                  )}
                  <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleUploadLogo} />
                  <button type="button" onClick={() => logoRef.current?.click()} disabled={uploadingLogo} className="text-[10px] font-black uppercase tracking-widest bg-gray-900 text-white rounded-xl px-4 py-2.5 hover:bg-green-600 transition disabled:opacity-50">
                    {uploadingLogo ? "Enviando..." : config.repasse_bomdia_logo_url ? "Trocar" : "Enviar logo"}
                  </button>
                  {config.repasse_bomdia_logo_url && (
                    <button type="button" onClick={removerLogo} className="text-[10px] font-black uppercase tracking-widest text-red-500 hover:text-red-600 transition">Remover</button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Link de convite da comunidade/grupo</label>
                <input type="text" value={config.repasse_link_comunidade ?? ""} onChange={e => setConfig(c => ({ ...c, repasse_link_comunidade: e.target.value }))} placeholder="https://chat.whatsapp.com/..." className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Link do Instagram</label>
                <input type="text" value={config.repasse_link_instagram ?? ""} onChange={e => setConfig(c => ({ ...c, repasse_link_instagram: e.target.value }))} placeholder="https://www.instagram.com/..." className={inputCls} />
              </div>
            </div>

            <button onClick={salvarConfig} disabled={salvando} className="w-full flex items-center justify-center gap-2 py-4 bg-gray-900 text-white font-black uppercase italic text-[11px] tracking-widest rounded-2xl hover:bg-green-600 transition disabled:opacity-60">
              {salvando ? <><Loader2 size={14} className="animate-spin" /> Salvando...</> : salvo ? <><CheckCircle2 size={14} /> Salvo!</> : "Salvar configuração"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
