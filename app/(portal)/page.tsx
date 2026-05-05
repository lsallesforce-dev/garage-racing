import Link from "next/link";
import {
  Zap, MessageSquare, Video, BarChart3, Users, ArrowRight,
  CheckCircle2, Star, TrendingUp, Car, Brain, Instagram,
  Phone, Calendar, BadgeCheck,
} from "lucide-react";

const features = [
  {
    icon: MessageSquare,
    color: "bg-green-500",
    title: "IA no WhatsApp",
    desc: "O Lucas, seu vendedor virtual, qualifica leads 24h por dia, responde dúvidas sobre os carros e agenda visitas — sem você levantar um dedo.",
    badge: "24/7 automático",
  },
  {
    icon: Video,
    color: "bg-red-600",
    title: "Vídeos de Marketing",
    desc: "Grave os takes com seu celular. A IA monta o vídeo completo com narração, legenda sincronizada e trilha sonora em menos de 5 minutos.",
    badge: "5 min por vídeo",
  },
  {
    icon: Car,
    color: "bg-blue-600",
    title: "Vitrine Digital",
    desc: "Cada carro tem sua própria página pública com fotos, vídeo, ficha técnica e botão de WhatsApp. Compartilhe um link e feche negócio.",
    badge: "Link por veículo",
  },
  {
    icon: BarChart3,
    color: "bg-amber-500",
    title: "Financeiro Completo",
    desc: "Controle de despesas por veículo, cálculo de lucro bruto e líquido, comissões de vendedores e relatórios mensais prontos para imprimir.",
    badge: "Relatório PDF",
  },
  {
    icon: Users,
    color: "bg-purple-600",
    title: "Multi-vendedor",
    desc: "Crie logins individuais para seus vendedores. Cada um vê apenas os leads e carros que precisa. Você enxerga tudo.",
    badge: "Acesso por nível",
  },
  {
    icon: Brain,
    color: "bg-gray-900",
    title: "IA de Análise",
    desc: "Cole o link de um Instagram ou envie um vídeo e a IA extrai marca, modelo, ano e descrição automaticamente. Cadastro em segundos.",
    badge: "Extração automática",
  },
];

const testimonials = [
  {
    name: "Ricardo Mendes",
    role: "Dono — RM Multimarcas",
    text: "Em 2 semanas o WhatsApp parou de me acordar de madrugada. A IA responde tudo e manda pra mim só o cliente que quer fechar.",
    stars: 5,
  },
  {
    name: "Carla Souza",
    role: "Gestora — CS Veículos",
    text: "Antes perdia 3h por dia fazendo vídeo pro Instagram. Hoje gravo os takes no pátio e em 5 minutos tá pronto com narração e tudo.",
    stars: 5,
  },
  {
    name: "Paulo Ferreira",
    role: "Sócio — PF Motors",
    text: "O relatório de fechamento do mês mostrou que eu estava perdendo dinheiro em comissões. Ajustei na hora. Valeu cada centavo.",
    stars: 5,
  },
];

const stats = [
  { value: "2.4×",  label: "mais leads qualificados"    },
  { value: "5 min", label: "para gerar um vídeo"        },
  { value: "0h",    label: "de atendimento noturno"     },
  { value: "100%",  label: "dos dados sob seu controle" },
];

const funilSteps = [
  {
    num: "01",
    icon: Instagram,
    color: "bg-pink-500",
    title: "Cliente vê o carro",
    desc: "Ele encontra o anúncio no Instagram ou acessa a Vitrine Digital do veículo — com fotos, ficha técnica e vídeo de marketing já prontos. Um clique leva direto ao WhatsApp.",
  },
  {
    num: "02",
    icon: Zap,
    color: "bg-green-500",
    title: "IA assume em segundos",
    desc: "O Lucas — seu vendedor virtual — responde na hora, 24 horas por dia. O cliente nunca fica sem resposta, mesmo de madrugada ou no fim de semana.",
  },
  {
    num: "03",
    icon: MessageSquare,
    color: "bg-blue-500",
    title: "Qualificação conversacional",
    desc: "Em vez de um formulário frio, a IA conduz uma conversa natural: tem carro pra troca? Qual a entrada disponível? Prefere financiamento? Tudo coletado sem o cliente perceber que está sendo qualificado.",
  },
  {
    num: "04",
    icon: Phone,
    color: "bg-amber-500",
    title: "Preço e agendamento",
    desc: "Com o perfil do cliente formado, a IA revela as condições, simula o financiamento e já tenta agendar a visita ao pátio — tudo dentro do WhatsApp.",
  },
  {
    num: "05",
    icon: BadgeCheck,
    color: "bg-red-600",
    title: "Você só fecha",
    desc: "Você recebe o alerta de lead quente com o histórico completo da conversa. Sua função: aparecer na visita e assinar o contrato.",
  },
];

// Exemplo de conversa simulada
const chatMock = [
  { side: "in",  text: "Oi, vi o Polo Track 2023 no Instagram. Qual o preço?"          },
  { side: "out", text: "Olá! O Polo Track 2023 está R$ 89.900. Você tem algum carro pra dar na troca?" },
  { side: "in",  text: "Tenho um Gol 2019"                                               },
  { side: "out", text: "Ótimo! Quanto você estima o seu Gol? Assim já consigo ver as melhores condições pra você 😊" },
  { side: "in",  text: "Umas 45 mil"                                                     },
  { side: "out", text: "Perfeito. Com R$ 45k na troca, a diferença seria R$ 44.900. Posso te mostrar uma simulação de financiamento?" },
];

export default function PortalHome() {
  return (
    <>
      {/* Hero */}
      <section className="relative bg-gray-900 text-white overflow-hidden">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-5" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-red-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-600/10 rounded-full blur-[100px]" />

        <div className="relative max-w-6xl mx-auto px-6 py-32 md:py-40">
          <div className="inline-flex items-center gap-2 bg-red-600/10 border border-red-600/20 rounded-full px-4 py-1.5 mb-8">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            <span className="text-[11px] font-black uppercase tracking-widest text-red-400">IA para revendas brasileiras</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-black italic uppercase tracking-tighter leading-none mb-6 max-w-4xl">
            Sua revenda no<br />
            <span className="text-red-500">piloto automático.</span>
          </h1>

          <p className="text-lg md:text-xl text-gray-300 max-w-2xl leading-relaxed mb-10">
            O <strong className="text-white">AutoZap</strong> qualifica seus leads no WhatsApp, gera vídeos de marketing
            dos seus carros e controla o financeiro — enquanto você dorme.
          </p>

          <div className="flex flex-col sm:flex-row gap-4">
            <Link href="/onboarding"
              className="inline-flex items-center gap-3 px-8 py-4 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-red-500 transition-all hover:gap-4 group">
              Quero uma demonstração
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link href="#como-funciona"
              className="inline-flex items-center gap-3 px-8 py-4 bg-white/10 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-white/20 transition-colors border border-white/10">
              Ver como funciona
            </Link>
          </div>

          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6">
            {stats.map(s => (
              <div key={s.label} className="text-center">
                <p className="text-3xl md:text-4xl font-black italic text-white tracking-tighter">{s.value}</p>
                <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Wave divider */}
        <div className="relative h-16">
          <svg viewBox="0 0 1440 64" className="absolute bottom-0 w-full" preserveAspectRatio="none">
            <path d="M0,64 C360,0 1080,64 1440,0 L1440,64 Z" fill="white" />
          </svg>
        </div>
      </section>

      {/* Funil Conversacional */}
      <section id="como-funciona" className="py-24 bg-gray-900 text-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-500 mb-3">Como funciona</p>
            <h2 className="text-4xl md:text-5xl font-black italic uppercase tracking-tighter">
              O funil que fecha vendas<br />
              <span className="text-red-500">enquanto você descansa.</span>
            </h2>
            <p className="text-gray-400 mt-4 max-w-xl mx-auto text-sm">
              Em vez de formulários estáticos, o AutoZap conduz o cliente por uma conversa natural no WhatsApp —
              qualificando, aquecendo e agendando sem você tocar no telefone.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            {/* Steps */}
            <div className="space-y-8">
              {funilSteps.map((s, i) => (
                <div key={s.num} className="flex gap-5">
                  <div className="flex flex-col items-center shrink-0">
                    <div className={`w-10 h-10 ${s.color} rounded-2xl flex items-center justify-center`}>
                      <s.icon size={18} className="text-white" />
                    </div>
                    {i < funilSteps.length - 1 && (
                      <div className="w-px flex-1 bg-gray-700 mt-2" />
                    )}
                  </div>
                  <div className="pb-6">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-1">Passo {s.num}</p>
                    <h3 className="text-base font-black uppercase italic tracking-tight text-white mb-1.5">{s.title}</h3>
                    <p className="text-sm text-gray-400 leading-relaxed">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Chat mock */}
            <div className="relative">
              <div className="bg-[#0b0f0e] rounded-[2rem] p-6 border border-gray-800 shadow-2xl">
                {/* Header do chat */}
                <div className="flex items-center gap-3 pb-4 mb-4 border-b border-gray-800">
                  <div className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center shrink-0">
                    <Zap size={16} className="text-white" fill="white" />
                  </div>
                  <div>
                    <p className="text-white text-sm font-black">Lucas · AutoZap</p>
                    <p className="text-green-400 text-[10px] font-bold uppercase tracking-widest">● Online agora</p>
                  </div>
                </div>

                {/* Mensagens */}
                <div className="space-y-3">
                  {chatMock.map((m, i) => (
                    <div key={i} className={`flex ${m.side === "out" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                        m.side === "out"
                          ? "bg-green-600 text-white rounded-br-sm"
                          : "bg-gray-800 text-gray-200 rounded-bl-sm"
                      }`}>
                        {m.text}
                      </div>
                    </div>
                  ))}
                  {/* Digitando */}
                  <div className="flex justify-end">
                    <div className="bg-green-600 rounded-2xl rounded-br-sm px-4 py-3 flex gap-1 items-center">
                      <span className="w-1.5 h-1.5 bg-white/60 rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 bg-white/60 rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 bg-white/60 rounded-full animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>

                {/* Badge */}
                <div className="mt-5 flex items-center justify-center gap-2 text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                  <Zap size={10} className="text-red-500" />
                  Respondido às 2h37 da manhã
                </div>
              </div>

              {/* Notificação de lead quente */}
              <div className="absolute -bottom-5 -right-4 bg-red-600 text-white rounded-2xl px-4 py-3 shadow-2xl max-w-[220px]">
                <p className="text-[9px] font-black uppercase tracking-widest text-red-200 mb-0.5">🔥 Lead Quente</p>
                <p className="text-[11px] font-black">João — Polo Track</p>
                <p className="text-[10px] text-red-200 mt-0.5">Visita agendada · Amanhã 10h</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="funcionalidades" className="py-24 max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-600 mb-3">Funcionalidades</p>
          <h2 className="text-4xl md:text-5xl font-black italic uppercase tracking-tighter text-gray-900">
            Tudo que sua revenda precisa.
          </h2>
          <p className="text-gray-500 mt-4 max-w-xl mx-auto">
            Uma plataforma completa. Sem planilha, sem app separado pra cada coisa.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map(f => (
            <div key={f.title}
              className="bg-gray-50 rounded-[2rem] p-8 hover:bg-white hover:shadow-xl transition-all duration-300 border border-transparent hover:border-gray-100 group">
              <div className={`w-12 h-12 ${f.color} rounded-2xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform`}>
                <f.icon size={22} className="text-white" />
              </div>
              <div className="inline-block bg-gray-200 rounded-full px-3 py-0.5 text-[9px] font-black uppercase tracking-widest text-gray-600 mb-3">
                {f.badge}
              </div>
              <h3 className="text-lg font-black uppercase italic tracking-tight text-gray-900 mb-2">{f.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24 max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-600 mb-3">Depoimentos</p>
          <h2 className="text-4xl md:text-5xl font-black italic uppercase tracking-tighter text-gray-900">
            Quem já usa, não volta atrás.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {testimonials.map(t => (
            <div key={t.name} className="bg-gray-50 rounded-[2rem] p-8 border border-gray-100">
              <div className="flex gap-1 mb-4">
                {Array.from({ length: t.stars }).map((_, i) => (
                  <Star key={i} size={14} className="text-amber-400 fill-amber-400" />
                ))}
              </div>
              <p className="text-gray-700 italic leading-relaxed mb-6 text-sm">"{t.text}"</p>
              <div>
                <p className="font-black text-sm text-gray-900 uppercase italic">{t.name}</p>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{t.role}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Final */}
      <section className="bg-red-600 py-24">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-6">
            <TrendingUp size={24} className="text-red-200" />
          </div>
          <h2 className="text-4xl md:text-6xl font-black italic uppercase tracking-tighter text-white mb-6 leading-none">
            Pronto para vender mais<br />sem trabalhar mais?
          </h2>
          <p className="text-red-100 text-lg mb-10 max-w-xl mx-auto">
            Um consultor visita sua revenda, configura tudo e você testa por 30 dias sem pagar nada.
            Se gostar, assina. Se não gostar, sem custo.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/onboarding"
              className="inline-flex items-center justify-center gap-3 px-8 py-4 bg-white text-red-600 rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-gray-100 transition-colors">
              Quero uma demonstração
              <ArrowRight size={16} />
            </Link>
            <Link href="/login"
              className="inline-flex items-center justify-center gap-3 px-8 py-4 bg-red-700/50 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-red-700 transition-colors border border-red-500">
              Já tenho conta
            </Link>
          </div>
          <div className="mt-8 flex items-center justify-center gap-6 flex-wrap">
            {["Teste grátis por 30 dias", "Consultor vai até você", "Suporte via WhatsApp", "Cancele quando quiser"].map(i => (
              <div key={i} className="flex items-center gap-2 text-red-100 text-[11px] font-bold uppercase tracking-widest">
                <CheckCircle2 size={12} />
                {i}
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
