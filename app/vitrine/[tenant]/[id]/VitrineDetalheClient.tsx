"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft, MapPin, Gauge, Fuel, Cog, Palette, Play, Video, ShieldCheck,
  MessageCircle, Check, X, Calculator, Settings2, Clock, Phone, Sparkles, Car,
} from "lucide-react";
import {
  resolveTheme, themeStyle, fmtBRL, fmtKm, whatsappLink, selosDe, isRecemChegado,
  type VitrineTema,
} from "../../theme";

interface Loja {
  cidade: string | null;
  estado: string | null;
  endereco: string | null;
  enderecoComplemento: string | null;
  horario: string | null;
  telefone: string | null;
}

interface Props {
  veiculo: any;
  videoUrl: string | null;
  relacionados: any[];
  nomeEmpresa: string;
  whatsapp: string;
  logoUrl?: string | null;
  tenant: string;
  vitrineTema?: VitrineTema | null;
  loja: Loja;
}

export default function VitrineDetalheClient({
  veiculo, videoUrl, relacionados, nomeEmpresa, whatsapp, logoUrl, tenant, vitrineTema, loja,
}: Props) {
  const theme = useMemo(() => resolveTheme(vitrineTema), [vitrineTema]);
  const [showFin, setShowFin] = useState(false);

  const titulo = [veiculo.marca, veiculo.modelo].filter(Boolean).join(" ") || "Veículo";
  const subtitulo = [veiculo.versao, veiculo.ano_modelo].filter(Boolean).join(" • ");
  const localLoja = [loja.cidade, loja.estado].filter(Boolean).join(" - ");
  const vendido = veiculo.status_venda === "VENDIDO";
  const selos = selosDe(veiculo);
  const novo = isRecemChegado(veiculo.created_at);

  const fotos: string[] = Array.isArray(veiculo.fotos) ? veiculo.fotos.filter(Boolean) : [];
  const capa: string | null = veiculo.capa_marketing_url ?? fotos[0] ?? null;
  const galeria: string[] = capa && !fotos.includes(capa) ? [capa, ...fotos] : fotos.length ? fotos : capa ? [capa] : [];

  const [sel, setSel] = useState<number | "video">(0);

  const pontos: string[] = Array.isArray(veiculo.pontos_fortes_venda) ? veiculo.pontos_fortes_venda.filter(Boolean) : [];
  const opcionais: string[] = Array.isArray(veiculo.opcionais) ? veiculo.opcionais.filter(Boolean) : [];

  const economiaFipe = useMemo(() => {
    const fipe = veiculo.valor_fipe;
    const preco = veiculo.preco_sugerido;
    if (!fipe || !preco || fipe <= preco) return null;
    return { valor: fipe - preco, pct: Math.round(((fipe - preco) / fipe) * 100) };
  }, [veiculo.valor_fipe, veiculo.preco_sugerido]);

  const msgWhats =
    `Olá! Vi o *${titulo}${veiculo.versao ? " " + veiculo.versao : ""}${veiculo.ano_modelo ? " " + veiculo.ano_modelo : ""}* na vitrine da ${nomeEmpresa} e tenho interesse. Ainda está disponível?`;
  const waHref = whatsappLink(whatsapp, msgWhats);

  // Ficha técnica — só campos preenchidos (nomes reais das colunas).
  const ficha: [string, string | null][] = [
    ["Marca", veiculo.marca ?? null],
    ["Modelo", veiculo.modelo ?? null],
    ["Versão", veiculo.versao ?? null],
    ["Ano", veiculo.ano_modelo ? String(veiculo.ano_modelo) : null],
    ["Quilometragem", fmtKm(veiculo.quilometragem_estimada)],
    ["Combustível", veiculo.combustivel ?? null],
    ["Câmbio", veiculo.cambio ?? null],
    ["Cor", veiculo.cor ?? null],
    ["Motor", veiculo.motor ?? null],
    ["Potência", veiculo.potencia_cv ? `${veiculo.potencia_cv} cv` : null],
    ["Carroceria", veiculo.categoria ?? null],
    ["Proprietários", veiculo.qtd_proprietarios ? String(veiculo.qtd_proprietarios) : null],
    ["Tabela FIPE", veiculo.valor_fipe ? fmtBRL(veiculo.valor_fipe) : null],
  ];
  const fichaPreenchida = ficha.filter(([, v]) => v);

  // Specs rápidas (só as com valor)
  const specs = [
    fmtKm(veiculo.quilometragem_estimada) && { icon: <Gauge size={14} />, label: "KM", value: fmtKm(veiculo.quilometragem_estimada)! },
    veiculo.combustivel && { icon: <Fuel size={14} />, label: "Combustível", value: veiculo.combustivel },
    veiculo.cambio && { icon: <Cog size={14} />, label: "Câmbio", value: veiculo.cambio },
    veiculo.cor && { icon: <Palette size={14} />, label: "Cor", value: veiculo.cor },
  ].filter(Boolean) as { icon: React.ReactNode; label: string; value: string }[];

  const detalhesTexto: string | null = veiculo.detalhes_inspecao ?? veiculo.detalhes ?? null;

  return (
    <div style={themeStyle(theme)} className="min-h-screen bg-[var(--bg)] text-[var(--fg)] font-sans pb-24 lg:pb-0">

      {/* ══ Header ══ */}
      <header className="sticky top-0 z-40 bg-[var(--surface)]/90 backdrop-blur border-b border-[var(--border)]">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <Link href={`/vitrine/${tenant}`} className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors">
            <ChevronLeft size={14} /> Ver estoque
          </Link>
          <Link href={`/vitrine/${tenant}`} className="flex items-center gap-2">
            {logoUrl ? (
              <img src={logoUrl} alt={nomeEmpresa} className="h-9 w-auto max-w-[150px] object-contain" />
            ) : (
              <span className="text-base font-black uppercase italic tracking-tighter truncate max-w-[200px]">{nomeEmpresa}</span>
            )}
          </Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-5 py-6">
        <div className="grid lg:grid-cols-12 gap-8">

          {/* ── Mídia ── */}
          <div className="lg:col-span-7">
            <div className="relative aspect-[4/3] rounded-3xl overflow-hidden bg-[var(--surface-2)] border border-[var(--border)]">
              {sel === "video" && videoUrl ? (
                <video src={videoUrl} controls autoPlay playsInline className="absolute inset-0 w-full h-full object-contain bg-black" />
              ) : galeria.length ? (
                <>
                  <img src={galeria[sel as number] ?? capa ?? ""} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-70" />
                  <img src={galeria[sel as number] ?? capa ?? ""} alt={titulo} className="absolute inset-0 w-full h-full object-contain" />
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[var(--fg-faint)]"><Car size={40} /></div>
              )}
              <div className="absolute top-4 left-4 flex flex-wrap gap-1.5">
                {novo && (
                  <span className="flex items-center gap-1 bg-[var(--brand)] text-[var(--brand-fg)] px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow">
                    <Sparkles size={11} /> Chegou essa semana
                  </span>
                )}
                {economiaFipe && (
                  <span className="bg-orange-500 text-white px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow">
                    {economiaFipe.pct}% abaixo da FIPE
                  </span>
                )}
              </div>
            </div>

            {/* Thumbnails */}
            {(galeria.length > 1 || videoUrl) && (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {videoUrl && (
                  <button onClick={() => setSel("video")}
                    className={`relative shrink-0 w-24 h-20 rounded-xl overflow-hidden border-2 grid place-items-center bg-black ${sel === "video" ? "border-[var(--brand)]" : "border-transparent"}`}>
                    {capa && <img src={capa} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" />}
                    <span className="relative w-8 h-8 rounded-full bg-[var(--brand)] grid place-items-center">
                      <Play size={13} className="text-[var(--brand-fg)] fill-current ml-0.5" />
                    </span>
                  </button>
                )}
                {galeria.map((f, i) => (
                  <button key={i} onClick={() => setSel(i)}
                    className={`shrink-0 w-24 h-20 rounded-xl overflow-hidden border-2 transition ${sel === i ? "border-[var(--brand)]" : "border-transparent hover:border-[var(--border-strong)]"}`}>
                    <img src={f} alt={`${titulo} ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Info (sticky) ── */}
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-24">
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {vendido && <Chip className="bg-[var(--surface-2)] text-[var(--fg-muted)] border border-[var(--border)]">Vendido</Chip>}
                {videoUrl && <Chip icon={<Video size={10} className="fill-current" />} className="bg-black text-white">Vídeo</Chip>}
                {selos.map((s) => <Chip key={s.key} className={s.className}>{s.label}</Chip>)}
              </div>

              <h1 className="text-3xl font-black uppercase italic tracking-tight leading-none">{titulo}</h1>
              {subtitulo && <p className="text-[11px] text-[var(--fg-faint)] font-bold uppercase tracking-widest mt-2">{subtitulo}</p>}

              {specs.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mt-5">
                  {specs.map((s) => (
                    <div key={s.label} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-3.5 py-3">
                      <div className="flex items-center gap-1.5 text-[var(--fg-faint)] mb-1">{s.icon}<span className="text-[8px] font-black uppercase tracking-widest">{s.label}</span></div>
                      <p className="text-sm font-bold truncate capitalize">{s.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Preço */}
              <div className="mt-6 rounded-2xl p-5 text-[var(--brand-fg)]" style={{ background: "linear-gradient(135deg, var(--brand) 0%, var(--accent) 100%)" }}>
                <p className="text-[9px] font-black uppercase tracking-widest opacity-70 mb-1">Preço à vista</p>
                <p className="text-4xl font-black tracking-tighter">{fmtBRL(veiculo.preco_sugerido)}</p>
                {economiaFipe && (
                  <p className="text-[12px] font-bold mt-1.5 opacity-90">{fmtBRL(economiaFipe.valor)} abaixo da tabela FIPE</p>
                )}
              </div>

              {/* CTAs */}
              {!vendido && (
                <div className="mt-4 flex flex-col gap-2.5">
                  <a href={waHref} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white py-4 rounded-2xl font-black uppercase text-[12px] tracking-widest transition active:scale-[0.98]">
                    <MessageCircle size={16} /> Falar com a loja agora
                  </a>
                  <button onClick={() => setShowFin(true)}
                    className="flex items-center justify-center gap-2 bg-[var(--surface)] border border-[var(--border-strong)] hover:border-[var(--brand)] text-[var(--fg)] py-3.5 rounded-2xl font-black uppercase text-[11px] tracking-widest transition">
                    <Calculator size={15} /> Simular financiamento
                  </button>
                  <p className="text-center text-[9px] font-bold uppercase tracking-widest text-[var(--fg-faint)]">
                    Resposta na hora pelo WhatsApp · Sem compromisso
                  </p>
                </div>
              )}

              {/* Loja */}
              <div className="mt-5 flex items-center justify-between text-[11px] text-[var(--fg-muted)] font-bold uppercase tracking-wider border-t border-[var(--border)] pt-4">
                <span className="truncate flex items-center gap-1.5"><ShieldCheck size={12} className="text-[var(--brand)]" /> {nomeEmpresa}</span>
                {localLoja && <span className="flex items-center gap-1 shrink-0"><MapPin size={11} /> {localLoja}</span>}
              </div>
            </div>
          </div>
        </div>

        {/* ── Ficha + opcionais + pontos ── */}
        <div className="grid lg:grid-cols-12 gap-8 mt-12">
          <div className="lg:col-span-7 flex flex-col gap-8">
            {fichaPreenchida.length > 0 && (
              <section>
                <h2 className="text-[11px] font-black uppercase tracking-widest text-[var(--fg-faint)] mb-4 flex items-center gap-2">
                  <Settings2 size={13} /> Ficha técnica
                </h2>
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)]">
                  {fichaPreenchida.map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between px-5 py-3 gap-4">
                      <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--fg-faint)]">{k}</span>
                      <span className="text-sm font-bold text-right capitalize">{v}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {pontos.length > 0 && (
              <section>
                <h2 className="text-[11px] font-black uppercase tracking-widest text-[var(--fg-faint)] mb-4">Destaques</h2>
                <ul className="grid sm:grid-cols-2 gap-2">
                  {pontos.map((p, i) => (
                    <li key={i} className="flex items-start gap-2 bg-[var(--surface)] rounded-xl border border-[var(--border)] px-4 py-3 text-sm text-[var(--fg-muted)]">
                      <Check size={15} className="text-emerald-500 shrink-0 mt-0.5" /> {p}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {detalhesTexto && (
              <section>
                <h2 className="text-[11px] font-black uppercase tracking-widest text-[var(--fg-faint)] mb-4">Sobre este veículo</h2>
                <p className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 text-sm text-[var(--fg-muted)] leading-relaxed whitespace-pre-line">
                  {detalhesTexto}
                </p>
              </section>
            )}
          </div>

          <div className="lg:col-span-5">
            {opcionais.length > 0 && (
              <section>
                <h2 className="text-[11px] font-black uppercase tracking-widest text-[var(--fg-faint)] mb-4">Opcionais</h2>
                <div className="flex flex-wrap gap-2">
                  {opcionais.map((o, i) => (
                    <span key={i} className="bg-[var(--surface)] border border-[var(--border-strong)] text-[var(--fg-muted)] px-3 py-1.5 rounded-full text-[12px] font-semibold">{o}</span>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        {/* ── Relacionados ── */}
        {relacionados.length > 0 && (
          <section className="mt-16">
            <h2 className="text-[11px] font-black uppercase tracking-widest text-[var(--fg-faint)] mb-5">
              Mais carros da {nomeEmpresa || "loja"}
            </h2>
            <div className="grid gap-5 grid-cols-2 lg:grid-cols-4">
              {relacionados.map((r) => {
                const img = r.capa_marketing_url ?? r.fotos?.[0];
                return (
                  <Link key={r.id} href={`/vitrine/${tenant}/${r.id}`} className="bg-[var(--surface)] rounded-2xl overflow-hidden border border-[var(--border)] shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all group">
                    <div className="relative aspect-[4/3] bg-[var(--surface-2)] overflow-hidden">
                      {img ? (
                        <>
                          <img src={img} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60" />
                          <img src={img} alt={`${r.marca} ${r.modelo}`} loading="lazy" className="absolute inset-0 w-full h-full object-contain" />
                        </>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[var(--fg-faint)]"><Car size={22} /></div>
                      )}
                    </div>
                    <div className="p-3.5">
                      <p className="text-[13px] font-black uppercase italic tracking-tight truncate group-hover:text-[var(--brand)] transition">
                        {[r.marca, r.modelo].filter(Boolean).join(" ")}
                      </p>
                      <p className="text-[9px] text-[var(--fg-faint)] font-bold uppercase tracking-widest mt-0.5">{r.ano_modelo ?? "—"}</p>
                      <p className="text-base font-black tracking-tighter mt-2">{fmtBRL(r.preco_sugerido)}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* ══ Sobre a loja ══ */}
      {(theme.sobre || loja.endereco || loja.horario || loja.telefone || localLoja) && (
        <section className="border-t border-[var(--border)] bg-[var(--surface)] mt-8">
          <div className="max-w-6xl mx-auto px-5 py-12 grid gap-8 md:grid-cols-2">
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-[var(--fg-faint)] mb-3">Sobre a loja</p>
              <h3 className="text-2xl font-black uppercase italic tracking-tight mb-3">{nomeEmpresa}</h3>
              {theme.sobre && <p className="text-sm text-[var(--fg-muted)] leading-relaxed whitespace-pre-line max-w-prose">{theme.sobre}</p>}
            </div>
            <div className="space-y-3">
              {(loja.endereco || localLoja) && (
                <InfoRow icon={<MapPin size={16} />}>{[loja.endereco, loja.enderecoComplemento, localLoja].filter(Boolean).join(", ")}</InfoRow>
              )}
              {loja.horario && <InfoRow icon={<Clock size={16} />}>{loja.horario}</InfoRow>}
              {loja.telefone && <InfoRow icon={<Phone size={16} />}>{loja.telefone}</InfoRow>}
            </div>
          </div>
        </section>
      )}

      {/* ══ Footer ══ */}
      <footer className="border-t border-[var(--border)] py-8 text-center bg-[var(--bg)]">
        <p className="text-[10px] font-black uppercase tracking-widest text-[var(--fg-faint)]">
          © {new Date().getFullYear()} {nomeEmpresa} · Vitrine digital
        </p>
      </footer>

      {/* ══ CTA fixo mobile ══ */}
      {!vendido && (
        <div className="fixed bottom-0 inset-x-0 z-40 lg:hidden bg-[var(--surface)]/95 backdrop-blur border-t border-[var(--border)] px-4 py-3 flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-[8px] font-black uppercase tracking-widest text-[var(--fg-faint)] leading-none">Preço</p>
            <p className="text-lg font-black tracking-tighter truncate">{fmtBRL(veiculo.preco_sugerido)}</p>
          </div>
          <a href={waHref} target="_blank" rel="noopener noreferrer"
            className="ml-auto flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-3 rounded-xl font-black uppercase text-[11px] tracking-widest transition active:scale-[0.98]">
            <MessageCircle size={15} /> Tenho interesse
          </a>
        </div>
      )}

      {showFin && (
        <ModalFinanciamento veiculo={veiculo} whatsapp={whatsapp} nomeEmpresa={nomeEmpresa} onClose={() => setShowFin(false)} />
      )}
    </div>
  );
}

// ─── Subcomponentes ─────────────────────────────────────────────────────────
function Chip({ children, icon, className }: { children: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${className ?? ""}`}>
      {icon} {children}
    </span>
  );
}

function InfoRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-sm text-[var(--fg-muted)]">
      <span className="text-[var(--brand)] mt-0.5 shrink-0">{icon}</span>
      <span className="leading-snug">{children}</span>
    </div>
  );
}

function ModalFinanciamento({
  veiculo, whatsapp, nomeEmpresa, onClose,
}: { veiculo: any; whatsapp: string; nomeEmpresa: string; onClose: () => void }) {
  const preco = veiculo.preco_sugerido ?? 0;
  const [entrada, setEntrada] = useState("");
  const [parcelas, setParcelas] = useState("48");
  const entradaNum = parseFloat(entrada.replace(/\./g, "").replace(",", ".")) || 0;
  const saldo = Math.max(preco - entradaNum, 0);
  const valorParcela = saldo / (parseInt(parcelas) || 1);

  const msg =
    `Olá! Simulei o *${veiculo.marca} ${veiculo.modelo}${veiculo.ano_modelo ? " " + veiculo.ano_modelo : ""}* na vitrine da ${nomeEmpresa}: ` +
    `entrada de ${fmtBRL(entradaNum)}, ${parcelas}x de ~${fmtBRL(valorParcela)}. Podemos conversar sobre as condições reais?`;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div style={{ colorScheme: "light" }} className="bg-white text-gray-900 rounded-3xl w-full max-w-md p-7 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-5">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Simulação de financiamento</p>
            <h3 className="text-lg font-black uppercase italic tracking-tight">{[veiculo.marca, veiculo.modelo].filter(Boolean).join(" ")}</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 bg-gray-100 rounded-full grid place-items-center hover:bg-gray-200 transition"><X size={14} /></button>
        </div>

        <div className="bg-gray-50 rounded-2xl p-4 mb-5">
          <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Valor do veículo</p>
          <p className="text-2xl font-black tracking-tighter">{fmtBRL(preco)}</p>
        </div>

        <div className="space-y-4 mb-5">
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-500 block mb-2">Entrada (R$)</label>
            <input type="number" placeholder="Ex: 15000" value={entrada} onChange={(e) => setEntrada(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:border-[var(--brand)]" />
          </div>
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-500 block mb-2">Parcelas</label>
            <div className="grid grid-cols-6 gap-1.5">
              {[12, 24, 36, 48, 60, 72].map((n) => (
                <button key={n} onClick={() => setParcelas(String(n))}
                  className={`py-2 rounded-lg text-[11px] font-black transition ${parcelas === String(n) ? "bg-[var(--brand)] text-[var(--brand-fg)]" : "bg-gray-50 text-gray-500 hover:bg-gray-100"}`}>
                  {n}x
                </button>
              ))}
            </div>
          </div>
        </div>

        {saldo > 0 && (
          <div className="bg-gray-50 rounded-2xl p-4 mb-5">
            <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Estimativa de parcela</p>
            <p className="text-3xl font-black tracking-tighter text-[var(--brand)]">{fmtBRL(valorParcela)}<span className="text-sm font-bold text-gray-400"> /mês</span></p>
            <p className="text-[9px] text-gray-400 mt-1">Simulação sem juros. Taxa final sujeita à análise de crédito.</p>
          </div>
        )}

        <a href={whatsappLink(whatsapp, msg)} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full bg-emerald-500 hover:bg-emerald-600 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-[11px] transition active:scale-[0.98]">
          <MessageCircle size={16} /> Enviar simulação no WhatsApp
        </a>
      </div>
    </div>
  );
}
