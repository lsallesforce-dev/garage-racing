import Link from "next/link";
import type { ReactNode } from "react";
import {
  Zap,
  MessageSquare,
  Video,
  BarChart3,
  Users,
  ArrowRight,
  ArrowUpRight,
  Star,
  TrendingUp,
  Brain,
  Instagram,
  Calendar,
  BadgeCheck,
} from "lucide-react";
import { getPortalEstoque } from "@/lib/portal/query";
import CarroCard from "@/app/carros/CarroCard";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital").replace(/\/+$/, "");

// Estoque dos parceiros muda pouco — ISR 5 min (a faixa /carros espelhada na home).
export const revalidate = 300;

// Dados estruturados (schema.org) — ajudam o Google a entender que a AutoZap é um
// software B2B e a Organização por trás. Conteúdo estático (sem input de usuário);
// ainda assim escapamos "<" por segurança ao injetar via dangerouslySetInnerHTML.
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "AutoZap",
      url: SITE_URL,
      description:
        "Plataforma de IA para revendas de veículos: atendimento no WhatsApp 24/7, vídeos e vitrine do estoque, anúncios em portais e gestão financeira.",
    },
    {
      "@type": "SoftwareApplication",
      name: "AutoZap",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: SITE_URL,
      description:
        "IA que qualifica leads no WhatsApp, gera vídeos para Instagram, publica anúncios em Webmotors/OLX/Meta e fecha o financeiro da revenda.",
      offers: {
        "@type": "Offer",
        priceCurrency: "BRL",
        price: "1150",
        availability: "https://schema.org/InStock",
      },
      provider: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

export default function Page() {
  return (
    <div className="bg-[#efefed] text-[#111827] font-sans antialiased">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <VitrineParceiros />
      <Hero />
      <Stats />
      <Marquee />
      <Funil />
      <Features />
      <Testimonials />
      <Offer />
      <FinalCTA />
    </div>
  );
}

/* ============================================================== */
/*  VITRINE DOS PARCEIROS — espelho de uma faixa do /carros        */
/* ============================================================== */
async function VitrineParceiros() {
  const carros = (await getPortalEstoque()).slice(0, 3);
  if (carros.length === 0) return null;

  return (
    <section className="bg-[#161616] text-white">
      <div className="max-w-[1400px] mx-auto px-6 py-20">
        <div className="flex items-end justify-between flex-wrap gap-6 mb-10">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/50 mb-4">
              / VITRINE DOS PARCEIROS
            </div>
            <h2
              className="font-bold tracking-[-0.03em] leading-[0.98]"
              style={{ fontSize: "clamp(32px, 4.2vw, 56px)" }}
            >
              Encontre seu próximo veículo{" "}
              <span className="text-[#ef4444]">em um de nossos parceiros.</span>
            </h2>
            <p className="mt-4 max-w-xl text-white/60 text-[15px] leading-relaxed">
              Seminovos e usados de revendas verificadas — fotos, vídeo e atendimento na hora
              pelo WhatsApp.
            </p>
          </div>
          <Link
            href="/carros"
            className="group inline-flex items-center gap-3 bg-white text-[#161616] pl-6 pr-2 py-2.5 rounded-full text-[15px] font-semibold hover:bg-white/90 transition shrink-0"
          >
            Ver todos os carros
            <span className="w-9 h-9 rounded-full bg-[#ef4444] text-white grid place-items-center transition-transform group-hover:translate-x-1">
              <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </span>
          </Link>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {carros.map((c) => (
            <CarroCard key={c.id} c={c} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================== */
/*  HERO                                                           */
/* ============================================================== */
function Hero() {
  return (
    <section className="relative bg-[#161616] text-white overflow-hidden">
      {/* grid backdrop */}
      <div
        className="absolute inset-0 opacity-60 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* glow blobs */}
      <div className="absolute -top-40 -right-40 w-[520px] h-[520px] rounded-full bg-[#ef4444]/30 blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 -left-40 w-[420px] h-[420px] rounded-full bg-[#22c55e]/15 blur-[120px] pointer-events-none" />

      <div className="relative max-w-[1400px] mx-auto px-6 pt-14 pb-10">
        {/* meta bar */}
        <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.22em] text-white/50 mb-10">
          <span>/ INTELIGÊNCIA ARTIFICIAL P/ REVENDAS</span>
          <span className="hidden md:flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
            Lucas online · 142 conversas em andamento
          </span>
        </div>

        <div className="grid lg:grid-cols-12 gap-10 items-end">
          {/* HEADLINE */}
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/80 bg-white/5 rounded-full px-3 py-1.5 mb-7 ring-1 ring-inset ring-white/10">
              <span className="w-1 h-1 rounded-full bg-[#ef4444]" />
              Novo · Lucas IA 2.0 entende áudio
            </div>

            <h1
              className="font-bold tracking-[-0.03em] leading-[0.98]"
              style={{ fontSize: "clamp(48px, 7.2vw, 108px)" }}
            >
              Sua revenda no
              <br />
              <span className="text-[#ef4444]">piloto automático.</span>
            </h1>

            <p className="mt-7 max-w-[560px] text-white/70 text-[17px] leading-relaxed">
              A IA qualifica leads no WhatsApp, gera vídeos para Instagram e fecha o
              financeiro do mês — enquanto você dorme, almoça ou atende o cliente que já
              está no pátio.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/onboarding"
                className="group inline-flex items-center gap-3 bg-[#ef4444] hover:bg-[#dc2626] text-white pl-6 pr-2 py-2.5 rounded-full text-[15px] font-semibold transition-colors"
              >
                Quero uma demonstração
                <span className="w-9 h-9 rounded-full bg-white/15 grid place-items-center transition-transform group-hover:translate-x-1">
                  <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
                </span>
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2.5 bg-white/10 hover:bg-white/15 text-white pl-5 pr-5 py-2.5 rounded-full text-[15px] font-medium ring-1 ring-inset ring-white/10 transition-colors"
              >
                Já tenho conta
              </Link>
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40 ml-2">
                30 dias grátis · sem cartão
              </span>
            </div>
          </div>

          {/* VISUAL */}
          <div className="lg:col-span-5 relative">
            {/* video card */}
            <div className="absolute -top-6 -left-10 hidden xl:block w-[230px] rounded-[1.5rem] bg-white/10 backdrop-blur p-3 -rotate-[5deg] z-10 ring-1 ring-inset ring-white/10">
              <div
                className="relative h-[120px] rounded-2xl overflow-hidden bg-[#1f1f1f] grid place-items-center"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(135deg, rgba(255,255,255,.05) 0 2px, transparent 2px 14px)",
                }}
              >
                <div className="w-12 h-12 rounded-full bg-white grid place-items-center">
                  <Video className="w-5 h-5 text-black" />
                </div>
                <span className="absolute bottom-2 left-2 font-mono text-[10px] uppercase tracking-widest text-white/70">
                  / ONIX 2022
                </span>
                <span className="absolute top-2 right-2 font-mono text-[10px] uppercase bg-[#ef4444] px-1.5 py-0.5 rounded text-white">
                  REC
                </span>
              </div>
              <div className="mt-2 px-1">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/60">
                  Vídeo gerado em
                </div>
                <div className="text-xl font-semibold tracking-[-0.02em]">4m 32s</div>
              </div>
            </div>

            {/* lead alert card */}
            <div className="absolute -bottom-6 -right-4 hidden xl:block w-[240px] rounded-[1.5rem] bg-[#ef4444] text-white p-4 rotate-[4deg] z-10 shadow-2xl shadow-red-900/40">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-[0.18em]">
                  / LEAD QUENTE
                </span>
                <span className="font-mono text-[10px]">02:14</span>
              </div>
              <div className="font-semibold tracking-[-0.02em] text-[22px] mt-2 leading-[1.1]">
                Cliente quer fechar agora.
              </div>
              <div className="text-[12px] text-white/85 mt-2">
                Onix LT 2022 · Entrada R$ 18k · troca Gol G6
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-[11px]">
                <span className="w-6 h-6 rounded-full bg-white/25 grid place-items-center font-mono">
                  RM
                </span>
                <span className="text-white/85">Encaminhado p/ Ricardo</span>
              </div>
            </div>

            <PhoneMock />
          </div>
        </div>

        {/* bottom strip */}
        <div className="mt-16 grid md:grid-cols-3 gap-x-10 gap-y-5 border-t border-white/10 pt-7">
          <BottomStrip kicker="/ 24 horas" copy="Lucas atende cada lead em segundos, todos os dias, mesmo às 3 da manhã." />
          <BottomStrip kicker="/ 5 minutos" copy="Você grava os takes no pátio, a IA monta o vídeo com narração e legenda." />
          <BottomStrip kicker="/ Lucro real" copy="Cada veículo com despesa, comissão e margem líquida — sem planilha." />
        </div>
      </div>
    </section>
  );
}

function BottomStrip({ kicker, copy }: { kicker: string; copy: string }) {
  return (
    <div>
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40 mb-1.5">
        {kicker}
      </div>
      <div className="text-[15px] text-white/85 max-w-[300px]">{copy}</div>
    </div>
  );
}

function PhoneMock() {
  return (
    <div className="relative mx-auto w-[330px] rounded-[2.5rem] bg-[#0a0a0a] p-2.5 ring-1 ring-white/10 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]">
      <div className="rounded-[2rem] bg-[#0e1418] overflow-hidden">
        {/* status bar */}
        <div className="flex items-center justify-between px-5 pt-3 pb-1.5 font-mono text-[11px] text-white/80">
          <span>02:07</span>
          <div className="flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-white/80" />
            <span className="w-1 h-1 rounded-full bg-white/80" />
            <span className="w-1 h-1 rounded-full bg-white/80" />
            <span className="ml-2">100%</span>
          </div>
        </div>
        {/* whatsapp header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-[#0b1417] border-b border-white/5">
          <div className="w-9 h-9 rounded-full bg-[#ef4444] grid place-items-center text-white font-black text-sm">
            L
          </div>
          <div className="flex-1">
            <div className="text-white text-[13px] font-semibold flex items-center gap-1.5">
              Lucas — RM Multimarcas
              <span className="text-[10px] font-black uppercase tracking-[0.18em] px-1.5 py-0.5 rounded bg-[#ef4444]/20 text-[#ef4444]">
                IA
              </span>
            </div>
            <div className="text-[11px] text-[#22c55e] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
              respondendo agora
            </div>
          </div>
        </div>

        {/* messages */}
        <div
          className="px-3 py-4 space-y-2.5 bg-[#0e1418]"
          style={{
            backgroundImage:
              "radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        >
          <Bubble out>Boa, vi o Onix branco de vocês no insta. Tá disponível?</Bubble>
          <Bubble>
            Boa madrugada! Tá sim 😊 Onix LT 2022, 38 mil km, único dono. Posso te
            mandar o vídeo completo dele?
          </Bubble>
          <Bubble out>Manda. E aceita meu Gol 2014 na troca?</Bubble>
          <Bubble>
            Avalio sim! Me manda 4 fotos do Gol (frente, traseira, lateral, painel) e
            o KM atual que já te passo o valor.
          </Bubble>
          <div className="flex justify-start">
            <div className="bg-[#1c2227] px-3 py-2.5 rounded-2xl rounded-tl-sm flex gap-1">
              <Dot /> <Dot delay="0.2s" /> <Dot delay="0.4s" />
            </div>
          </div>
        </div>

        {/* handoff alert */}
        <div className="bg-[#ef4444]/15 border-t border-[#ef4444]/30 px-4 py-2.5 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-[#ef4444] grid place-items-center">
            <Zap className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
          </div>
          <div className="flex-1 text-[11px]">
            <div className="text-white font-semibold">Lead aquecido — quer fechar</div>
            <div className="text-white/60">
              Encaminhado p/ Ricardo · histórico anexado
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-white/70" />
        </div>
      </div>
    </div>
  );
}

function Bubble({ children, out }: { children: ReactNode; out?: boolean }) {
  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[82%] text-[13px] px-3 py-2 rounded-2xl ${
          out
            ? "bg-[#1f3a36] text-white rounded-tr-sm"
            : "bg-[#1c2227] text-white/95 rounded-tl-sm"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function Dot({ delay = "0s" }: { delay?: string }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse"
      style={{ animationDelay: delay }}
    />
  );
}

/* ============================================================== */
/*  STATS                                                          */
/* ============================================================== */
function Stats() {
  return (
    <section className="bg-[#161616] text-white border-t border-white/5">
      <div className="max-w-[1400px] mx-auto px-6 py-14 grid grid-cols-2 lg:grid-cols-4 gap-y-10">
        <StatItem big="2.4" suffix="×" caption="mais leads qualificados em 30 dias" />
        <StatItem big="5" suffix="min" caption="para gerar um vídeo pronto p/ Instagram" />
        <StatItem big="0" suffix="h" caption="de atendimento de madrugada na sua agenda" />
        <StatItem big="100" suffix="%" caption="dos seus dados sob seu controle" accent />
      </div>
    </section>
  );
}

function StatItem({
  big,
  suffix,
  caption,
  accent,
}: {
  big: string;
  suffix: string;
  caption: string;
  accent?: boolean;
}) {
  return (
    <div className={`pl-5 border-l ${accent ? "border-[#ef4444]" : "border-white/15"}`}>
      <div
        className={`font-bold tracking-[-0.03em] text-[56px] leading-none ${
          accent ? "text-[#ef4444]" : ""
        }`}
      >
        {big}
        <span
          className={`text-[32px] align-top ml-1 font-medium ${
            accent ? "" : "text-white/40"
          }`}
        >
          {suffix}
        </span>
      </div>
      <div className="mt-3 text-sm text-white/60 max-w-[200px]">{caption}</div>
    </div>
  );
}

/* ============================================================== */
/*  MARQUEE                                                        */
/* ============================================================== */
function Marquee() {
  const items = [
    "RM Multimarcas",
    "CS Veículos",
    "PF Motors",
    "Auto Lima",
    "Garage 47",
    "Bandeira Veículos",
    "Único Multimarcas",
    "Perfil Auto",
    "Strada Cars",
  ];
  const row = (
    <div className="flex items-center gap-10 px-5">
      {items.map((it) => (
        <span key={it} className="flex items-center gap-10">
          <span>{it}</span>
          <span className="text-[#ef4444]">→</span>
        </span>
      ))}
    </div>
  );
  return (
    <section className="bg-[#0d0d0d] text-white/40 py-5 overflow-hidden border-y border-white/5">
      <style>{`@keyframes marquee-scroll { from { transform: translateX(0) } to { transform: translateX(-50%) } }`}</style>
      <div
        className="flex whitespace-nowrap font-mono text-[12px] uppercase tracking-[0.25em]"
        style={{ animation: "marquee-scroll 38s linear infinite" }}
      >
        {row}
        {row}
      </div>
    </section>
  );
}

/* ============================================================== */
/*  FUNIL                                                          */
/* ============================================================== */
function Funil() {
  const steps = [
    {
      n: "01",
      title: "Cliente vê o carro.",
      copy: "Anúncio no Instagram ou Vitrine Digital. Um clique abre o WhatsApp.",
      Icon: Instagram,
    },
    {
      n: "02",
      title: "IA assume em",
      titleAccent: "segundos.",
      copy: "Lucas responde 24h, 7 dias por semana — em texto, áudio ou foto.",
      Icon: MessageSquare,
    },
    {
      n: "03",
      title: "Qualificação conversacional.",
      copy: "Tem carro na troca? Quanto de entrada? Vai financiar? — tudo natural.",
      Icon: Brain,
    },
    {
      n: "04",
      title: "Preço & agendamento.",
      copy: "Condições, simulação de financiamento e visita ao pátio agendada.",
      Icon: Calendar,
    },
    {
      n: "05",
      title: "Você só fecha.",
      copy: "Alerta de lead quente com histórico completo. Apertou a mão, vendeu.",
      Icon: BadgeCheck,
      red: true,
    },
  ];

  return (
    <section id="funil" className="bg-[#efefed]">
      <div className="max-w-[1400px] mx-auto px-6 py-24">
        <div className="grid md:grid-cols-12 gap-8 items-end mb-14">
          <div className="md:col-span-7">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500 mb-4">
              / FUNIL EM 5 PASSOS
            </div>
            <h2
              className="font-bold tracking-[-0.03em] leading-[0.98] text-[#161616]"
              style={{ fontSize: "clamp(36px, 4.6vw, 68px)" }}
            >
              Do anúncio ao{" "}
              <span className="text-[#ef4444]">aperto de mão</span> — você só
              entra na hora certa.
            </h2>
          </div>
          <div className="md:col-span-5 md:pb-3">
            <p className="text-gray-600 text-[16px] leading-relaxed max-w-md">
              O cliente nem percebe que está conversando com IA. Quando o lead esquenta,
              o sistema te chama com o histórico inteiro pronto pro fechamento.
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-4">
          {steps.map((s) => (
            <div
              key={s.n}
              className={`relative rounded-[1.75rem] p-6 min-h-[320px] flex flex-col justify-between text-white ${
                s.red ? "bg-[#ef4444]" : "bg-[#161616]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`font-mono text-sm ${
                    s.red ? "text-white" : "text-[#ef4444]"
                  }`}
                >
                  / {s.n}
                </span>
                <s.Icon
                  className={`w-4 h-4 ${s.red ? "text-white" : "text-white/40"}`}
                />
              </div>
              <div>
                <div
                  className="font-semibold tracking-[-0.025em] text-[26px] leading-[1.1]"
                  style={{ wordBreak: "break-word" }}
                >
                  {s.title}
                  {s.titleAccent && (
                    <>
                      {" "}
                      <span className="text-[#ef4444]">{s.titleAccent}</span>
                    </>
                  )}
                </div>
                <p
                  className={`mt-3 text-sm ${
                    s.red ? "text-white/85" : "text-white/65"
                  }`}
                >
                  {s.copy}
                </p>
              </div>
              {s.red && (
                <div className="absolute -top-2 -right-2 font-mono text-[10px] uppercase tracking-widest bg-[#161616] text-white px-2 py-1 rounded">
                  você entra aqui
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="hidden lg:flex items-center gap-3 mt-8 font-mono text-[11px] uppercase tracking-[0.2em] text-gray-400">
          <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" />
          <span>tempo médio anúncio → lead quente: 14 min</span>
          <div className="flex-1 border-t border-dashed border-gray-300" />
          <span>fonte: dados internos · 1.200 revendas · 2025</span>
        </div>
      </div>
    </section>
  );
}

/* ============================================================== */
/*  FEATURES                                                       */
/* ============================================================== */
function Features() {
  return (
    <section id="funcionalidades" className="bg-[#e6e6e3]">
      <div className="max-w-[1400px] mx-auto px-6 py-24">
        <div className="flex items-end justify-between flex-wrap gap-6 mb-14">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500 mb-4">
              / TUDO EM UMA PLATAFORMA
            </div>
            <h2
              className="font-bold tracking-[-0.03em] leading-[0.98] text-[#161616] max-w-[820px]"
              style={{ fontSize: "clamp(36px, 4.6vw, 68px)" }}
            >
              Seis ferramentas. <span className="text-[#ef4444]">Um login.</span> Zero
              planilha.
            </h2>
          </div>
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-gray-500">
            06 módulos · integrações nativas
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* HERO FEATURE — IA WhatsApp */}
          <div className="lg:col-span-2 lg:row-span-2 bg-[#161616] text-white rounded-[2rem] p-8 lg:p-10 relative overflow-hidden min-h-[480px] flex flex-col justify-between">
            <div className="absolute -bottom-20 -right-20 w-[300px] h-[300px] rounded-full bg-[#ef4444]/30 blur-[120px]" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] bg-[#ef4444] text-white px-2 py-1 rounded">
                    / FEATURE PRINCIPAL
                  </span>
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/60">
                    24/7 AUTOMÁTICO
                  </span>
                </div>
                <ArrowUpRight className="w-6 h-6 text-white/70" />
              </div>
              <h3
                className="font-bold tracking-[-0.03em] leading-[0.98] mt-8 max-w-[520px]"
                style={{ fontSize: "clamp(40px, 4.4vw, 56px)" }}
              >
                IA no WhatsApp{" "}
                <em className="italic font-semibold text-[#ef4444]">que não dorme.</em>
              </h3>
              <p className="mt-5 text-white/70 max-w-[480px] text-[15px] leading-relaxed">
                Lucas qualifica leads em texto, áudio (Whisper) e foto. Avalia trocas,
                simula financiamento, agenda visita — e te chama só na hora do
                fechamento.
              </p>
            </div>
            <div className="relative grid grid-cols-3 gap-3 mt-8">
              <MiniStat label="CONVERSAS HOJE" value="142" />
              <MiniStat label="RESPOSTA MÉDIA" value="38" suffix="s" />
              <MiniStat label="LEADS QUENTES" value="7" red />
            </div>
            <div className="relative mt-6 flex items-center gap-4 text-[11px] font-mono uppercase tracking-[0.18em] text-white/40 flex-wrap">
              <span>/ integra com</span>
              <span className="text-white/70">Avisa</span>·
              <span className="text-white/70">Meta WhatsApp Business API</span>·
              <span className="text-white/70">Evolution API</span>
            </div>
          </div>

          {/* Vídeos */}
          <FeatureCard badge="5 MIN POR VÍDEO" title="Vídeos prontos pro Instagram." copy="Você grava os takes. A IA corta, narra com voz humana, sincroniza legenda e adiciona logo.">
            <div
              className="rounded-2xl bg-[#e6e6e3] h-[140px] grid place-items-center mb-5 relative overflow-hidden"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(135deg, rgba(0,0,0,.06) 0 2px, transparent 2px 14px)",
              }}
            >
              <div className="w-12 h-12 rounded-full bg-[#ef4444] grid place-items-center">
                <Video className="w-5 h-5 text-white" />
              </div>
              <span className="absolute top-2 left-3 font-mono text-[10px] uppercase tracking-widest text-gray-500">
                / TAKE 03 · INTERIOR
              </span>
              <span className="absolute bottom-2 right-3 font-mono text-[10px] uppercase bg-[#161616] text-white px-1.5 py-0.5 rounded">
                0:42
              </span>
            </div>
          </FeatureCard>

          {/* Vitrine */}
          <FeatureCard badge="LINK POR VEÍCULO" title="Vitrine digital própria." copy="Cada carro com fotos, vídeo, ficha, simulador de financiamento e botão de WhatsApp.">
            <div className="rounded-2xl bg-[#e6e6e3] h-[140px] mb-5 p-3 flex flex-col justify-between">
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                <span className="w-2 h-2 rounded-full bg-yellow-400" />
                <span className="w-2 h-2 rounded-full bg-green-400" />
                <span className="ml-2 text-gray-500">autozap.digital/v/onix-2022</span>
              </div>
              <div>
                <div className="font-semibold tracking-[-0.02em] text-base">
                  Chevrolet Onix LT 2022
                </div>
                <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-1">
                  <span>38.420 km</span>·<span>1.0 turbo</span>·
                  <span className="text-[#ef4444] font-bold">R$ 79.900</span>
                </div>
              </div>
            </div>
          </FeatureCard>

          {/* Financeiro */}
          <FeatureCard badge="RELATÓRIO PDF" title="Financeiro com lucro real." copy="Despesa por veículo, lucro bruto e líquido, comissões. Relatório em PDF todo mês.">
            <div className="rounded-2xl bg-[#e6e6e3] h-[140px] mb-5 p-4 flex flex-col justify-between">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
                    LUCRO LÍQUIDO · ABR
                  </div>
                  <div className="font-bold tracking-[-0.02em] text-2xl mt-1">
                    R$ 187.420
                  </div>
                </div>
                <div className="font-mono text-[11px] text-[#22c55e] flex items-center gap-1">
                  + 28% <TrendingUp className="w-3 h-3" />
                </div>
              </div>
              <div className="flex items-end gap-1.5 h-10">
                {[30, 55, 42, 70, 60, 88].map((h, i) => (
                  <span
                    key={i}
                    className={`w-3 rounded-t ${i === 5 ? "bg-[#ef4444]" : "bg-gray-300"}`}
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
            </div>
          </FeatureCard>

          {/* Multi-vendedor */}
          <div className="bg-[#161616] text-white rounded-[2rem] p-7 relative overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] bg-white text-[#161616] px-2 py-1 rounded">
                ACESSO POR NÍVEL
              </span>
              <ArrowUpRight className="w-5 h-5 text-white/50" />
            </div>
            <div className="space-y-2 mb-5">
              <UserRow ini="RM" name="Ricardo" role="Dono" tag="VÊ TUDO" green />
              <UserRow ini="JC" name="João" role="Vendedor" tag="SEUS LEADS" />
              <UserRow ini="AP" name="Ana" role="Financeiro" tag="RELATÓRIOS" />
            </div>
            <h3 className="font-semibold tracking-[-0.025em] text-[24px] leading-[1.1]">
              Time inteiro, um painel.
            </h3>
            <p className="mt-2 text-sm text-white/65">
              Logins individuais por vendedor. Cada um vê só o que precisa, dono vê tudo.
            </p>
          </div>

          {/* IA Cadastro */}
          <div className="bg-[#ef4444] text-white rounded-[2rem] p-7 relative overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] bg-[#161616] text-white px-2 py-1 rounded">
                EXTRAÇÃO AUTOMÁTICA
              </span>
              <ArrowUpRight className="w-5 h-5 text-white/70" />
            </div>
            <div className="bg-white/15 rounded-2xl p-3 mb-5 font-mono text-[11px] space-y-1.5 ring-1 ring-inset ring-white/10">
              <div className="flex items-center gap-2">
                <span className="text-white/50">→</span> instagram.com/p/abc123
              </div>
              <div className="border-t border-white/15 my-2" />
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                <div className="text-white/60">Marca</div>
                <div>Volkswagen</div>
                <div className="text-white/60">Modelo</div>
                <div>Polo Highline</div>
                <div className="text-white/60">Ano</div>
                <div>2023</div>
                <div className="text-white/60">Cor</div>
                <div>Prata</div>
                <div className="text-white/60">Opcionais</div>
                <div>Multimídia · Couro</div>
              </div>
            </div>
            <h3 className="font-semibold tracking-[-0.025em] text-[24px] leading-[1.1]">
              Cadastro inteligente.
            </h3>
            <p className="mt-2 text-sm text-white/85">
              Cole link do Insta ou envie um vídeo — a IA extrai marca, modelo, ano, cor,
              opcionais.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  badge,
  title,
  copy,
  children,
}: {
  badge: string;
  title: string;
  copy: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-white text-[#161616] rounded-[2rem] p-7 relative overflow-hidden flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] font-black uppercase tracking-[0.18em] bg-[#161616] text-white px-2 py-1 rounded">
          {badge}
        </span>
        <ArrowUpRight className="w-5 h-5 text-gray-400" />
      </div>
      {children}
      <h3 className="font-semibold tracking-[-0.025em] text-[24px] leading-[1.1]">
        {title}
      </h3>
      <p className="mt-2 text-sm text-gray-600">{copy}</p>
    </div>
  );
}

function MiniStat({
  label,
  value,
  suffix,
  red,
}: {
  label: string;
  value: string;
  suffix?: string;
  red?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-4 ring-1 ring-inset ${
        red ? "bg-[#ef4444]/15 ring-[#ef4444]/40" : "bg-white/5 ring-white/10"
      }`}
    >
      <div className={`font-black tracking-tight text-2xl ${red ? "text-[#ef4444]" : ""}`}>
        {value}
        {suffix && <span className="text-base text-white/50">{suffix}</span>}
      </div>
      <div
        className={`text-[10px] font-black uppercase tracking-[0.18em] mt-1 ${
          red ? "text-[#ef4444]" : "text-white/50"
        }`}
      >
        {label}
      </div>
    </div>
  );
}

function UserRow({
  ini,
  name,
  role,
  tag,
  green,
}: {
  ini: string;
  name: string;
  role: string;
  tag: string;
  green?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 bg-white/10 rounded-xl px-3 py-2 text-[12px] ring-1 ring-inset ring-white/10">
      <span
        className={`w-7 h-7 rounded-full grid place-items-center font-mono text-[11px] ${
          green ? "bg-[#ef4444]" : "bg-white/15"
        }`}
      >
        {ini}
      </span>
      <span className="flex-1">
        {name} · <span className="text-white/50">{role}</span>
      </span>
      <span
        className={`text-[10px] font-black uppercase tracking-[0.18em] ${
          green ? "text-[#22c55e]" : "text-white/50"
        }`}
      >
        {tag}
      </span>
    </div>
  );
}

/* ============================================================== */
/*  TESTIMONIALS                                                   */
/* ============================================================== */
function Testimonials() {
  return (
    <section id="cases" className="bg-[#161616] text-white relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-50 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="absolute top-20 right-0 w-[400px] h-[400px] rounded-full bg-[#ef4444]/20 blur-[120px]" />
      <div className="relative max-w-[1400px] mx-auto px-6 py-24">
        <div className="grid md:grid-cols-12 gap-8 items-end mb-14">
          <div className="md:col-span-8">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/50 mb-4">
              / QUEM JÁ DEIXOU O ZAP NO AUTOMÁTICO
            </div>
            <h2
              className="font-bold tracking-[-0.03em] leading-[0.98]"
              style={{ fontSize: "clamp(36px, 4.6vw, 68px)" }}
            >
              Eles dormem.
              <br />O <span className="text-[#ef4444]">AutoZap</span> vende.
            </h2>
          </div>
          <div className="md:col-span-4 font-mono text-[11px] uppercase tracking-[0.2em] text-white/50">
            / 03 cases · NPS 78 · ★★★★★
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <Testimonial
            ini="RM"
            quote={
              <>
                &ldquo;Em 2 semanas o WhatsApp parou de me{" "}
                <span className="text-[#ef4444]">acordar de madrugada.</span> A IA
                responde tudo e manda pra mim só o cliente que quer fechar.&rdquo;
              </>
            }
            name="Ricardo Mendes"
            sub="RM Multimarcas · São José/SC · 32 carros"
          />
          <Testimonial
            ini="CS"
            initBg="bg-white/15"
            quote={
              <>
                &ldquo;Antes perdia 3h por dia fazendo vídeo pro Instagram. Hoje gravo os
                takes no pátio e em{" "}
                <span className="text-[#ef4444]">5 minutos tá pronto</span> com narração
                e tudo.&rdquo;
              </>
            }
            name="Carla Souza"
            sub="CS Veículos · Curitiba/PR · 18 carros"
          />
          <Testimonial
            red
            ini="PF"
            quote={
              <>
                &ldquo;O relatório do mês mostrou que eu{" "}
                <span className="bg-[#161616] px-1.5 rounded">
                  estava perdendo dinheiro
                </span>{" "}
                em comissões. Ajustei na hora. Valeu cada centavo.&rdquo;
              </>
            }
            name="Paulo Ferreira"
            sub="PF Motors · Belo Horizonte/MG · 47 carros"
          />
        </div>
      </div>
    </section>
  );
}

function Testimonial({
  red,
  ini,
  initBg,
  quote,
  name,
  sub,
}: {
  red?: boolean;
  ini: string;
  initBg?: string;
  quote: ReactNode;
  name: string;
  sub: string;
}) {
  return (
    <article
      className={`rounded-[1.75rem] p-7 flex flex-col ${
        red
          ? "bg-[#ef4444]"
          : "bg-white/5 ring-1 ring-inset ring-white/10 backdrop-blur"
      }`}
    >
      <div
        className={`flex items-center gap-1 mb-5 ${
          red ? "text-white" : "text-[#ef4444]"
        }`}
      >
        {[...Array(5)].map((_, i) => (
          <Star key={i} className="w-4 h-4" fill="currentColor" />
        ))}
      </div>
      <blockquote className="text-[19px] leading-[1.4] flex-1 text-white font-medium tracking-[-0.01em]">
        {quote}
      </blockquote>
      <div
        className={`mt-7 pt-5 flex items-center gap-3 border-t ${
          red ? "border-white/20" : "border-white/10"
        }`}
      >
        <div
          className={`w-11 h-11 rounded-full grid place-items-center font-black ${
            initBg ? initBg : red ? "bg-[#161616]" : "bg-[#ef4444]"
          }`}
        >
          {ini}
        </div>
        <div>
          <div className="text-sm font-semibold">{name}</div>
          <div className={`text-xs ${red ? "text-white/80" : "text-white/50"}`}>
            {sub}
          </div>
        </div>
      </div>
    </article>
  );
}

/* ============================================================== */
/*  OFFER                                                          */
/* ============================================================== */
function Offer() {
  return (
    <section id="precos" className="bg-[#efefed]">
      <div className="max-w-[1400px] mx-auto px-6 py-20">
        <div className="grid lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500 mb-4">
              / COMO COMEÇAR
            </div>
            <h2
              className="font-bold tracking-[-0.03em] leading-[0.98] text-[#161616]"
              style={{ fontSize: "clamp(36px, 4.4vw, 64px)" }}
            >
              Um consultor vai até a sua revenda.{" "}
              <span className="text-[#ef4444]">De graça.</span>
            </h2>
            <p className="mt-6 text-gray-600 max-w-[520px] text-[16px] leading-relaxed">
              A gente configura tudo: número do WhatsApp, treino do Lucas com seu
              estoque, domínio da vitrine e integração com seu time. Você só assiste
              rodar.
            </p>

            <div className="mt-8 grid grid-cols-2 gap-4 max-w-[520px]">
              <OfferCard big="30 dias" sub="teste grátis" />
              <OfferCard big="0 fidelidade" sub="cancele quando quiser" />
              <OfferCard big="in-loco" sub="implantação no pátio" />
              <OfferCard big="whatsapp" sub="suporte humano" />
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="bg-[#161616] text-white rounded-[2rem] p-8 relative overflow-hidden h-full flex flex-col">
              <div className="absolute -top-20 -right-20 w-[300px] h-[300px] rounded-full bg-[#ef4444]/30 blur-[120px]" />
              <div className="relative">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#ef4444] mb-2">
                  / AGENDA
                </div>
                <div className="font-semibold tracking-[-0.025em] text-2xl mb-6">
                  Próximas visitas técnicas
                </div>
                <ul className="divide-y divide-white/10">
                  <VisitRow day="SEG 12" city="São Paulo · ABC" tag="2 vagas" />
                  <VisitRow day="TER 13" city="Curitiba · CIC" tag="3 vagas" />
                  <VisitRow day="QUI 15" city="Belo Horizonte" tag="1 vaga" warn />
                  <VisitRow day="SEX 16" city="Florianópolis" tag="4 vagas" />
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function OfferCard({ big, sub }: { big: string; sub: string }) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-200">
      <div className="font-bold tracking-[-0.02em] text-2xl">{big}</div>
      <div className="font-mono text-[11px] uppercase tracking-widest text-gray-500 mt-1">
        {sub}
      </div>
    </div>
  );
}

function VisitRow({
  day,
  city,
  tag,
  warn,
}: {
  day: string;
  city: string;
  tag: string;
  warn?: boolean;
}) {
  return (
    <li className="flex items-center justify-between py-3 text-sm">
      <div>
        <span className="font-mono text-white/50 mr-3">{day}</span>
        {city}
      </div>
      <span
        className={`text-[10px] font-black uppercase tracking-[0.18em] ${
          warn ? "text-yellow-400" : "text-[#22c55e]"
        }`}
      >
        {tag}
      </span>
    </li>
  );
}

/* ============================================================== */
/*  FINAL CTA                                                      */
/* ============================================================== */
function FinalCTA() {
  return (
    <section className="bg-[#161616] text-white relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-60 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-[#ef4444]/40 blur-[120px]" />
      <div className="absolute -bottom-20 -right-10 w-[400px] h-[400px] rounded-full bg-[#ef4444]/20 blur-[120px]" />

      <div className="relative max-w-[1400px] mx-auto px-6 py-28 text-center">
        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/60 mb-7">
          / TÁ NA HORA DE DORMIR
        </div>
        <h2
          className="font-bold tracking-[-0.03em] leading-[0.98] max-w-[1100px] mx-auto"
          style={{ fontSize: "clamp(48px, 7.4vw, 120px)" }}
        >
          Deixa o <span className="text-[#ef4444]">Lucas</span> cuidar do{" "}
          <em className="italic font-semibold">zap.</em>
        </h2>
        <p className="mt-7 text-white/70 text-lg max-w-[560px] mx-auto">
          30 dias grátis. Implantação no seu pátio. Sem cartão, sem fidelidade — cancele
          com uma mensagem.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/onboarding"
            className="group inline-flex items-center gap-3 bg-[#ef4444] hover:bg-[#dc2626] text-white pl-7 pr-2 py-3 rounded-full text-[16px] font-semibold transition-colors"
          >
            Quero uma demonstração
            <span className="w-10 h-10 rounded-full bg-white/15 grid place-items-center transition-transform group-hover:translate-x-1">
              <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </span>
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2.5 bg-white/10 hover:bg-white/15 text-white pl-6 pr-6 py-3 rounded-full text-[16px] font-medium ring-1 ring-inset ring-white/10 transition-colors"
          >
            Já tenho conta
          </Link>
        </div>
        <div className="mt-12 flex items-center justify-center gap-8 font-mono text-[11px] uppercase tracking-[0.2em] text-white/40 flex-wrap">
          <span className="flex items-center gap-1">
            <Star className="w-3 h-3 fill-current" /> 4.9 / 5 · 312 reviews
          </span>
          <span>·</span>
          <span>1.200+ revendas ativas</span>
          <span>·</span>
          <span>LGPD compliant</span>
        </div>
      </div>
    </section>
  );
}
