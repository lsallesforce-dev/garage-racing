"use client";

// Editor do reel (estilo CapCut). A CAPA é a primeira linha, editável como um
// take (foto, título, logo, tempo de tela). Por take: ponto de corte (scrubber
// que move o vídeo — arrasta pra escolher de onde começa), duração, legenda;
// + reordenar e escolher a trilha. "Salvar e gerar" persiste e dispara o render.

import React, { useEffect, useRef, useState } from "react";
import { Loader2, Film, Save, ChevronUp, ChevronDown, ChevronRight, Music, Pause, Play, Scissors, Trash2, Sparkles, Image as ImageIcon, Clock } from "lucide-react";

interface Linha {
  tag: string | null;
  label: string;
  url: string;
  inicio: number;
  fim: number;
  callout: string;
  subCallout: string;
}

interface Capa {
  fotoUrl: string | null;
  titulo: string;
  subtitulo: string;
  mostrarLogo: boolean;
  segundos: number;
}

const TRILHAS: { id: string; nome: string }[] = [
  { id: "animado", nome: "Animado" },
  { id: "elegante", nome: "Elegante" },
  { id: "emocional", nome: "Emocional" },
  { id: "acao-esportiva", nome: "Ação Esportiva" },
  { id: "blues-rock", nome: "Blues Rock" },
  { id: "country-blues", nome: "Country Blues" },
  { id: "familia-alegre", nome: "Família Alegre" },
  { id: "groove-energetico", nome: "Groove Energético" },
  { id: "magnolia-town", nome: "Magnolia Town" },
  { id: "reels-marketing", nome: "Reels Marketing" },
  { id: "rock-alegre", nome: "Rock Alegre" },
  { id: "rock-classico", nome: "Rock Clássico" },
  { id: "rock-estrada", nome: "Rock Estrada" },
  { id: "rock-esportivo", nome: "Rock Esportivo" },
  { id: "rock-impulso", nome: "Rock Impulso" },
  { id: "rock-inspirador", nome: "Rock Inspirador" },
  { id: "rock-motivacional", nome: "Rock Motivacional" },
  { id: "rock-power", nome: "Rock Power" },
  { id: "rock-vibrante", nome: "Rock Vibrante" },
  { id: "nenhuma", nome: "Sem música" },
];

const TRANSICOES: { id: string; nome: string }[] = [
  { id: "fade", nome: "Fade suave" },
  { id: "corte", nome: "Corte seco" },
  { id: "deslizar", nome: "Deslizar" },
  { id: "zoom", nome: "Zoom" },
  { id: "desfoque", nome: "Desfoque" },
];

// Espelha duracaoReel do Remotion: capa + clipes (com overlap) + endcard 96f.
function segundosVideo(linhas: { inicio: number; fim: number }[], transicao: string, capaSeg: number): number {
  const ov = transicao === "corte" ? 0 : 12;
  let cursor = Math.round(Math.min(Math.max(capaSeg, 1), 6) * 30);
  linhas.forEach((l, i) => {
    const dur = Math.round(Math.min(Math.max(l.fim - l.inicio, 1), 15) * 30);
    const from = cursor - (i === 0 ? 0 : ov);
    cursor = from + dur;
  });
  return (cursor + 96) / 30;
}

function toProxy(url: string): string {
  const m = url.match(/https?:\/\/[^/]+\/(.+)$/);
  return m && url.includes(".r2.dev") ? `/api/r2/${m[1]}` : url;
}

// A capa — primeira cena do reel. Não é um take (não tem vídeo, não reordena,
// não deleta), mas edita igual: foto de fundo, título, sublinha, logo e tempo.
function CapaRow({
  capa,
  fotos,
  logoUrl,
  onChange,
}: {
  capa: Capa;
  fotos: string[];
  logoUrl: string | null;
  onChange: (patch: Partial<Capa>) => void;
}) {
  const [trocando, setTrocando] = useState(false);

  return (
    <div className="rounded-xl border-2 border-gray-900 bg-white p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-gray-900">
          <ImageIcon size={11} /> Capa
          <span className="font-bold text-gray-300">· {capa.segundos.toFixed(1)}s</span>
        </span>
        <button
          onClick={() => setTrocando((v) => !v)}
          disabled={fotos.length <= 1}
          className="text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-900 disabled:opacity-30"
        >
          {trocando ? "Fechar" : `Trocar foto (${fotos.length})`}
        </button>
      </div>

      <div className="flex gap-3">
        {/* Miniatura com o que o reel vai mostrar: foto + logo + título */}
        <div className="relative h-32 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-black">
          {capa.fotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={capa.fotoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[8px] font-bold text-gray-500">sem foto</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
          {capa.mostrarLogo && logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="absolute left-1 top-1 h-4 w-9 rounded bg-white/90 object-contain p-0.5" />
          ) : null}
          <div className="absolute bottom-1 left-1 right-1">
            <div className="mb-0.5 h-0.5 w-4 rounded bg-red-600" />
            <p className="truncate text-[7px] font-black uppercase leading-tight text-white">{capa.titulo}</p>
            <p className="truncate text-[6px] font-bold uppercase leading-tight text-white/70">{capa.subtitulo}</p>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
          <input
            value={capa.titulo}
            onChange={(e) => onChange({ titulo: e.target.value })}
            maxLength={30}
            placeholder="Título da capa (vazio = esconde)"
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] font-bold uppercase"
          />
          <input
            value={capa.subtitulo}
            onChange={(e) => onChange({ subtitulo: e.target.value })}
            maxLength={40}
            placeholder="Linha de baixo (ex.: 2.0 GLS • 2011/2012)"
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-[10px] font-medium"
          />

          <div>
            <div className="mb-0.5 flex items-center justify-between">
              <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-gray-400">
                <Clock size={10} /> Tempo na tela
              </span>
              <span className="text-[10px] font-black text-gray-700">{capa.segundos.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min={1}
              max={6}
              step={0.1}
              value={capa.segundos}
              onChange={(e) => onChange({ segundos: Number(e.target.value) })}
              className="w-full accent-gray-900"
            />
          </div>
        </div>
      </div>

      <label className="mt-2 flex items-center gap-2 text-[10px] font-bold text-gray-600">
        <input
          type="checkbox"
          checked={capa.mostrarLogo}
          onChange={(e) => onChange({ mostrarLogo: e.target.checked })}
          className="h-3.5 w-3.5 accent-gray-900"
        />
        Mostrar a logo da loja na capa
        <span className="text-gray-400">— desligue se a foto já tem marca d&apos;água</span>
      </label>

      {trocando ? (
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {fotos.map((f) => (
            <button
              key={f}
              onClick={() => {
                onChange({ fotoUrl: f });
                setTrocando(false);
              }}
              className={`h-16 w-11 flex-shrink-0 overflow-hidden rounded-md border-2 ${
                capa.fotoUrl === f ? "border-red-600" : "border-transparent"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Uma linha = um take, com scrubber que move o vídeo pra escolher o ponto de corte.
function TakeRow({
  l,
  i,
  total,
  onChange,
  onMover,
  onDelete,
}: {
  l: Linha;
  i: number;
  total: number;
  onChange: (patch: Partial<Linha>) => void;
  onMover: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [dur, setDur] = useState(0);

  // Move o preview pro ponto de início escolhido (dá o "movimento" na imagem).
  function seek(t: number) {
    const v = videoRef.current;
    if (v && Number.isFinite(t)) v.currentTime = Math.min(t, Math.max(dur - 0.05, 0));
  }

  const maxVid = dur > 0 ? dur : 12;
  const trecho = Math.max(l.fim - l.inicio, 0);

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">
          {i + 1}. {l.label} <span className="text-gray-300">· {trecho.toFixed(1)}s</span>
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => onMover(-1)} disabled={i === 0} className="text-gray-400 hover:text-gray-800 disabled:opacity-25" title="Subir">
            <ChevronUp size={16} />
          </button>
          <button onClick={() => onMover(1)} disabled={i === total - 1} className="text-gray-400 hover:text-gray-800 disabled:opacity-25" title="Descer">
            <ChevronDown size={16} />
          </button>
          <button
            onClick={onDelete}
            disabled={total <= 1}
            className="text-gray-300 hover:text-red-500 disabled:opacity-25 ml-1"
            title={total <= 1 ? "O reel precisa de ao menos um take" : "Remover este take do reel"}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          src={toProxy(l.url)}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setDur(d);
            seek(l.inicio);
          }}
          className="w-20 h-32 rounded-lg object-cover bg-black flex-shrink-0"
        />

        <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
          {/* Corte de início — arrasta e o vídeo se move até o começo do clipe */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-gray-400">
                <Scissors size={10} /> Início do corte
              </span>
              <span className="text-[10px] font-black text-gray-700">{l.inicio.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min={0}
              max={maxVid}
              step={0.1}
              value={Math.min(l.inicio, maxVid)}
              onChange={(e) => {
                const t = Number(e.target.value);
                // início nunca ultrapassa o fim (mantém ao menos 1s de trecho)
                const novoFim = Math.max(l.fim, t + 1);
                onChange({ inicio: t, fim: Math.min(novoFim, maxVid) });
                seek(t);
              }}
              className="w-full accent-gray-900"
            />
          </div>

          {/* Corte de fim — arrasta e o vídeo se move até o fim do clipe */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-gray-400">
                <Scissors size={10} /> Cortar final
              </span>
              <span className="text-[10px] font-black text-gray-700">{l.fim.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min={0}
              max={maxVid}
              step={0.1}
              value={Math.min(l.fim, maxVid)}
              onChange={(e) => {
                const teto = Math.min(maxVid, l.inicio + 15);
                const t = Math.min(Math.max(Number(e.target.value), l.inicio + 1), teto);
                onChange({ fim: t });
                seek(t);
              }}
              className="w-full accent-red-600"
            />
          </div>
        </div>
      </div>

      <input
        value={l.callout}
        onChange={(e) => onChange({ callout: e.target.value })}
        maxLength={40}
        placeholder="Legenda sobre o take (ex.: CÂMERA DE RÉ)"
        className="mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] font-bold uppercase"
      />
      <input
        value={l.subCallout}
        onChange={(e) => onChange({ subCallout: e.target.value })}
        maxLength={60}
        placeholder="Sublegenda menor (opcional, ex.: Sensor de estacionamento)"
        className="mt-1.5 w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-[10px] font-medium"
      />
    </div>
  );
}

export default function ReelEditor({
  veiculoId,
  onGerar,
}: {
  veiculoId: string;
  onGerar: () => void;
}) {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [capa, setCapa] = useState<Capa | null>(null);
  const [fotos, setFotos] = useState<string[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [trilha, setTrilha] = useState("animado");
  const [transicao, setTransicao] = useState("fade");
  const [salvando, setSalvando] = useState(false);
  const [gerandoLegendas, setGerandoLegendas] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [trilhaAberta, setTrilhaAberta] = useState(false);
  const [tocando, setTocando] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio();
    audio.onended = () => setTocando(null);
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  function alternarPreview(id: string) {
    const audio = audioRef.current;
    if (!audio) return;
    if (tocando === id) {
      audio.pause();
      setTocando(null);
      return;
    }
    audio.src = `/api/r2/musicas/${id}.mp3`;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    setTocando(id);
  }

  useEffect(() => {
    fetch(`/api/marketing/reel-edit?veiculoId=${veiculoId}`)
      .then((r) => r.json())
      .then((d) => {
        setLinhas(d.clips ?? []);
        if (d.capa) setCapa(d.capa);
        setFotos(d.fotos ?? []);
        setLogoUrl(d.logoUrl ?? null);
        if (d.trilha) setTrilha(d.trilha);
        if (d.transicao) setTransicao(d.transicao);
      })
      .catch(() => setErro("Erro ao carregar os takes"));
  }, [veiculoId]);

  function set(i: number, patch: Partial<Linha>) {
    setLinhas((prev) => (prev ? prev.map((l, j) => (j === i ? { ...l, ...patch } : l)) : prev));
  }

  function deletar(i: number) {
    setLinhas((prev) => (prev && prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));
  }

  function mover(i: number, dir: -1 | 1) {
    setLinhas((prev) => {
      if (!prev) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const arr = [...prev];
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  }

  // Regera as legendas a partir da ficha do carro. `forcar` porque o vendedor só
  // clica nisso quando quer trocar o texto — o cache por ficha_hash devolveria o
  // mesmo de sempre.
  //
  // Usa a RESPOSTA da rota, não um GET novo do reel-edit: o GET aplica a
  // precedência (manual > ficha), então se houver texto salvo ele devolveria o
  // texto velho e o botão pareceria não fazer nada. É exatamente o que acontecia.
  async function regerarLegendas() {
    setGerandoLegendas(true);
    setErro(null);
    try {
      const res = await fetch("/api/marketing/callouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId, forcar: true }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      const takes: Record<string, { callout?: string; subCallout?: string }> = d.callouts?.takes ?? {};
      // Corte e ordem que o vendedor mexeu ficam; só o texto é reescrito. Take
      // que a ficha não sustenta fica VAZIO — é melhor que legenda desconexa.
      setLinhas((prev) =>
        prev
          ? prev.map((l) => {
              const novo = l.tag ? takes[l.tag] : null;
              return {
                ...l,
                callout: (novo?.callout ?? "").toUpperCase(),
                subCallout: novo?.subCallout ?? "",
              };
            })
          : prev
      );
    } catch (e: any) {
      setErro(e.message ?? "Erro ao gerar legendas");
    } finally {
      setGerandoLegendas(false);
    }
  }

  async function salvar(gerar: boolean) {
    if (!linhas) return;
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/marketing/reel-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          veiculoId,
          trilha,
          transicao,
          capa,
          clips: linhas.map((l) => ({ tag: l.tag, url: l.url, inicio: l.inicio, fim: l.fim, callout: l.callout, subCallout: l.subCallout })),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      if (gerar) onGerar();
    } catch (e: any) {
      setErro(e.message ?? "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  if (erro && !linhas) return <p className="text-[10px] font-bold text-red-500 py-2">{erro}</p>;
  if (!linhas) {
    return (
      <div className="flex items-center gap-2 py-3 text-[10px] font-bold text-gray-400">
        <Loader2 size={13} className="animate-spin" /> Carregando takes...
      </div>
    );
  }
  if (linhas.length === 0) {
    return <p className="text-[10px] font-bold text-gray-400 py-2">Nenhum take gravado ainda.</p>;
  }

  const videoSeg = segundosVideo(linhas, transicao, capa?.segundos ?? 2.5);

  return (
    <div className="mt-2 space-y-2">
      {/* Tempo final do vídeo à mostra */}
      <div className="flex items-center justify-between rounded-xl bg-gray-900 px-4 py-2.5 text-white">
        <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest">
          <Film size={12} /> Vídeo final
        </span>
        <span className="text-sm font-black">{videoSeg.toFixed(1)}s</span>
      </div>
      <p className="text-[9px] font-bold text-gray-400">
        A capa é a primeira cena. Arraste os cortes de início e fim pra escolher o trecho de
        cada take. A lixeira remove o take do reel.
      </p>

      {capa ? (
        <CapaRow
          capa={capa}
          fotos={fotos}
          logoUrl={logoUrl}
          onChange={(patch) => setCapa((c) => (c ? { ...c, ...patch } : c))}
        />
      ) : null}

      {linhas.map((l, i) => (
        <TakeRow
          key={l.url}
          l={l}
          i={i}
          total={linhas.length}
          onChange={(patch) => set(i, patch)}
          onMover={(dir) => mover(i, dir)}
          onDelete={() => deletar(i)}
        />
      ))}

      {/* Legendas a partir da ficha do carro */}
      <button
        onClick={regerarLegendas}
        disabled={gerandoLegendas}
        className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white py-2 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        title="Reescreve a legenda de cada take usando opcionais, motor, câmbio e o resto da ficha do carro. Substitui o que estiver escrito — clique em Salvar pra valer."
      >
        {gerandoLegendas ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
        {gerandoLegendas ? "Escrevendo..." : "Gerar legendas da ficha do carro"}
      </button>
      <p className="-mt-1 text-[9px] font-bold text-gray-400">
        Reescreve o texto de todos os takes a partir da ficha e substitui o que estiver escrito.
        Take que a ficha não sustenta fica sem legenda. Salve depois pra valer.
      </p>

      {/* Transição */}
      <div className="rounded-xl border border-gray-100 bg-white p-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkles size={12} className="text-gray-400" />
          <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Transição entre cenas</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TRANSICOES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTransicao(t.id)}
              className={`rounded-lg px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${
                transicao === t.id ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {t.nome}
            </button>
          ))}
        </div>
      </div>

      {/* Trilha */}
      <div className="rounded-xl border border-gray-100 bg-white p-2.5">
        <button
          onClick={() => {
            if (trilhaAberta) audioRef.current?.pause();
            setTrilhaAberta((v) => !v);
          }}
          className="flex w-full items-center justify-between"
        >
          <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-gray-400">
            <Music size={12} /> Trilha Sonora
          </span>
          <span className="flex items-center gap-1 text-[10px] font-black text-gray-700">
            {TRILHAS.find((t) => t.id === trilha)?.nome ?? trilha}
            {trilhaAberta ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />}
          </span>
        </button>

        {trilhaAberta && (
          <div className="mt-2 flex flex-col gap-1 max-h-64 overflow-y-auto">
            {TRILHAS.map((t) => (
              <div
                key={t.id}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition-all ${
                  trilha === t.id ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {t.id === "nenhuma" ? (
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center" />
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      alternarPreview(t.id);
                    }}
                    className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${
                      trilha === t.id ? "bg-white text-gray-900" : "bg-white text-gray-700"
                    }`}
                    title={tocando === t.id ? "Pausar prévia" : "Ouvir prévia"}
                  >
                    {tocando === t.id ? <Pause size={11} /> : <Play size={11} className="ml-0.5" />}
                  </button>
                )}
                <button onClick={() => setTrilha(t.id)} className="flex-1 text-left text-[10px] font-black uppercase tracking-widest">
                  {t.nome}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {erro ? <p className="text-[10px] font-bold text-red-500">{erro}</p> : null}

      <div className="flex items-center gap-2">
        <button
          onClick={() => salvar(false)}
          disabled={salvando}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-gray-100 px-4 py-2.5 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200 disabled:opacity-50"
        >
          {salvando ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Salvar
        </button>
        <button
          onClick={() => salvar(true)}
          disabled={salvando}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-900 py-2.5 text-[9px] font-black uppercase tracking-widest text-white hover:bg-red-600 disabled:opacity-50"
        >
          {salvando ? <Loader2 size={12} className="animate-spin" /> : <Film size={12} />} Salvar e gerar reel
        </button>
      </div>
    </div>
  );
}
