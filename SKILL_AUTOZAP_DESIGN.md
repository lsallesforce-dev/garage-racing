# AutoZap — Briefing Completo para Redesign da Landing Page

> Use este documento como contexto total para redesenhar a página inicial em `autozap.digital`.  
> O dono do produto não está satisfeito com o design atual e quer algo novo.

---

## 1. O QUE É O AUTOZAP

**AutoZap** é uma plataforma SaaS brasileira de inteligência artificial para **revendas de veículos** (multimarcas, concessionárias independentes).

### Proposta de valor em uma frase
> "Sua revenda no piloto automático — a IA qualifica leads no WhatsApp, gera vídeos de marketing dos carros e controla o financeiro enquanto você dorme."

### Problema que resolve
Donos de revendas pequenas e médias no Brasil sofrem com três dores reais:
1. **WhatsApp 24h** — o cliente manda mensagem às 2h da manhã perguntando o preço do carro. Sem resposta, perde o lead.
2. **Vídeos para Instagram** — gravar, editar, narrare postar consome horas por dia. A maioria abandona.
3. **Controle financeiro** — muitos não sabem o lucro real por veículo, perdem dinheiro em comissões e despesas escondidas.

### Público-alvo
- Donos e gestores de revendas de veículos usados no Brasil
- Porte: 5 a 80 carros no estoque
- Perfil: empreendedores práticos, não técnicos, que querem resultado sem complexidade
- Dor principal: trabalham 24/7 e não conseguem escalar sem contratar mais gente

---

## 2. FUNCIONALIDADES DO PRODUTO

### 2.1 IA no WhatsApp (feature principal)
- Um agente de IA chamado **"Lucas"** responde leads no WhatsApp automaticamente, 24h por dia
- Quando o cliente clica num anúncio do Instagram com link para WhatsApp, Lucas responde em segundos
- A conversa é natural: Lucas pergunta sobre carro na troca, entrada disponível, interesse em financiamento
- Quando o lead fica "quente" (quer fechar), o sistema alerta o vendedor humano com o histórico completo
- Integra com **Avisa**, **Meta WhatsApp Business API** e **Evolution API**
- Suporta áudio (transcreve com Whisper), fotos (avaliação de troca), vídeos do estoque
- Badge: **"24/7 automático"**

### 2.2 Vídeos de Marketing
- O dono grava os takes com o celular no pátio (carro por fora, por dentro, detalhes)
- A IA monta o vídeo completo: corta os takes, adiciona narração em voz humana, legenda sincronizada, trilha sonora e logo da revenda
- Resultado: vídeo profissional de 30-60s pronto para Instagram em menos de 5 minutos
- Pipeline: upload no celular → Gemini gera roteiro → TTS gera narração → FFmpeg monta o vídeo → publicado no R2
- Badge: **"5 min por vídeo"**

### 2.3 Vitrine Digital
- Cada veículo tem uma página pública própria com: fotos, vídeo de marketing, ficha técnica completa, simulador de financiamento e botão de WhatsApp
- A vitrine da revenda fica em `autozap.digital/vitrine/[slug-da-revenda]`
- Quando o cliente compartilha o link do carro, vai direto para a página do veículo
- Badge: **"Link por veículo"**

### 2.4 Financeiro Completo
- Controle de despesas por veículo (funilaria, seguro, documentação, etc.)
- Cálculo automático de lucro bruto e líquido ao vender
- Controle de comissões por vendedor
- Relatórios mensais em PDF prontos para imprimir
- Badge: **"Relatório PDF"**

### 2.5 Multi-vendedor
- O dono cria logins individuais para cada vendedor
- Cada vendedor vê apenas seus leads e os carros que precisa
- O dono tem visão total de tudo
- Badge: **"Acesso por nível"**

### 2.6 IA de Análise / Cadastro Inteligente
- Cole o link de um post do Instagram ou envie um vídeo e a IA extrai automaticamente: marca, modelo, ano, versão, cor, opcionais e descrição
- Cadastro de veículo em segundos, sem digitar nada
- Badge: **"Extração automática"**

### 2.7 Publicação em Portais
- Integração com **OLX**, **Webmotors** para publicar anúncios direto do sistema
- (em desenvolvimento: iCarros, outros)

---

## 3. FUNIL DE VENDAS DO PRODUTO (como o cliente usa)

```
Passo 01 — Cliente vê o carro
  Instagram / Vitrine Digital → foto, ficha, vídeo prontos → um clique abre WhatsApp

Passo 02 — IA assume em segundos
  Lucas responde na hora, 24h/dia, sete dias por semana

Passo 03 — Qualificação conversacional
  Conversa natural: troca? entrada? financiamento?
  Cliente qualificado sem perceber

Passo 04 — Preço e agendamento
  IA revela condições, simula financiamento, tenta agendar visita

Passo 05 — Você só fecha
  Alerta de lead quente com histórico completo
  Vendedor aparece na visita e assina o contrato
```

---

## 4. MÉTRICAS E PROVAS SOCIAIS

### Números usados atualmente
- **2.4×** mais leads qualificados
- **5 min** para gerar um vídeo completo
- **0h** de atendimento noturno necessário
- **100%** dos dados sob controle do lojista

### Depoimentos reais (3 clientes)
1. **Ricardo Mendes** (RM Multimarcas) — "Em 2 semanas o WhatsApp parou de me acordar de madrugada. A IA responde tudo e manda pra mim só o cliente que quer fechar."
2. **Carla Souza** (CS Veículos) — "Antes perdia 3h por dia fazendo vídeo pro Instagram. Hoje gravo os takes no pátio e em 5 minutos tá pronto com narração e tudo."
3. **Paulo Ferreira** (PF Motors) — "O relatório de fechamento do mês mostrou que eu estava perdendo dinheiro em comissões. Ajustei na hora. Valeu cada centavo."

### Oferta comercial
- Teste grátis por 30 dias
- Consultor vai até a revenda e configura tudo
- Suporte via WhatsApp
- Cancele quando quiser

---

## 5. IDENTIDADE VISUAL E MARCA

### Nome e personalidade
- **AutoZap** — nome combina "auto" (automóvel + automação) + "zap" (WhatsApp)
- Mascote: **"Zap"** — robô amigável com cara de garagem (`/zap-mascot.png`)
- Tom de voz: direto, sem frescura, brasileiro, fala de pátio — não de startup de São Paulo
- Energia: acelerado, confiante, prático

### Cores atuais
| Variável | Hex | Uso |
|---|---|---|
| `--primary` | `#ef4444` (red-500/600) | CTAs, destaques, brand |
| `--secondary` | `#161616` | Fundos dark, cards |
| `--accent` | `#facc15` | Amarelo alerta (pouco usado) |
| `--background` | `#efefed` | Fundo claro geral |
| `--foreground` | `#111827` | Texto principal |
| Verde | `#22c55e` (green-500) | WhatsApp, online, disponível |
| Cinza fundo card | `#f9fafb` (gray-50) | Cards de features |

### Tipografia
- **Fonte**: Inter (Google Fonts)
- Headlines: `font-black` (900) + `italic` + `uppercase` + `tracking-tighter`
- Exemplo: `text-5xl md:text-7xl font-black italic uppercase tracking-tighter`
- Badges/labels: `text-[10px] font-black uppercase tracking-widest`
- Body: `text-sm text-gray-500 leading-relaxed`

### Elementos visuais recorrentes
- Bordas arredondadas grandes: `rounded-[2rem]` (32px)
- Blur de fundo: círculos coloridos com `blur-[120px]` no hero
- Grid SVG sutil no fundo escuro (`/grid.svg` com opacity 5%)
- Badges de feature: pill com cor de fundo leve + texto minúsculo em caps
- Animações: pulse no verde (online), bounce nos pontos de digitação, hover scale nos ícones

---

## 6. ESTRUTURA ATUAL DA LANDING PAGE (arquivo: `app/(portal)/page.tsx`)

### Seções em ordem
1. **Hero** — fundo dark (gray-900), headline grande em itálico, subtítulo, 2 CTAs, grid de 4 stats
2. **Funil** ("Como funciona") — fundo dark, 5 passos com ícone + linha conectora, mockup de chat WhatsApp ao lado
3. **Features** ("Funcionalidades") — fundo branco, grid 3×2 de cards com ícone colorido, badge e descrição
4. **Demo ao vivo** — card dark com mascote Zap convidando a testar o widget de chat
5. **Depoimentos** — grid 3 cards, estrelas, citação, nome e cargo
6. **CTA Final** — fundo red-600, headline grande, 2 botões, 4 checkboxes de garantia

### Header (layout)
- Sticky com backdrop blur
- Logo SVG (barra vermelha + "ZAP" escuro)
- Links: Funcionalidades, Sobre
- Botões: Entrar | Começar grátis

### Footer
- 4 colunas: brand + missão | produto | conta | —
- Fundo dark (gray-900)

---

## 7. CÓDIGO COMPLETO DA PÁGINA ATUAL

```tsx
// app/(portal)/page.tsx — PÁGINA ATUAL COMPLETA

import Link from "next/link";
import {
  Zap, MessageSquare, Video, BarChart3, Users, ArrowRight,
  CheckCircle2, Star, TrendingUp, Car, Brain, Instagram,
  Phone, Calendar, BadgeCheck,
} from "lucide-react";

const features = [
  { icon: MessageSquare, color: "bg-green-500",  title: "IA no WhatsApp",    desc: "O Lucas, seu vendedor virtual, qualifica leads 24h por dia, responde dúvidas sobre os carros e agenda visitas — sem você levantar um dedo.", badge: "24/7 automático" },
  { icon: Video,         color: "bg-red-600",    title: "Vídeos de Marketing", desc: "Grave os takes com seu celular. A IA monta o vídeo completo com narração, legenda sincronizada e trilha sonora em menos de 5 minutos.", badge: "5 min por vídeo" },
  { icon: Car,           color: "bg-blue-600",   title: "Vitrine Digital",    desc: "Cada carro tem sua própria página pública com fotos, vídeo, ficha técnica e botão de WhatsApp. Compartilhe um link e feche negócio.", badge: "Link por veículo" },
  { icon: BarChart3,     color: "bg-amber-500",  title: "Financeiro Completo", desc: "Controle de despesas por veículo, cálculo de lucro bruto e líquido, comissões de vendedores e relatórios mensais prontos para imprimir.", badge: "Relatório PDF" },
  { icon: Users,         color: "bg-purple-600", title: "Multi-vendedor",     desc: "Crie logins individuais para seus vendedores. Cada um vê apenas os leads e carros que precisa. Você enxerga tudo.", badge: "Acesso por nível" },
  { icon: Brain,         color: "bg-gray-900",   title: "IA de Análise",      desc: "Cole o link de um Instagram ou envie um vídeo e a IA extrai marca, modelo, ano e descrição automaticamente. Cadastro em segundos.", badge: "Extração automática" },
];

const testimonials = [
  { name: "Ricardo Mendes", role: "Dono — RM Multimarcas", text: "Em 2 semanas o WhatsApp parou de me acordar de madrugada. A IA responde tudo e manda pra mim só o cliente que quer fechar.", stars: 5 },
  { name: "Carla Souza",    role: "Gestora — CS Veículos", text: "Antes perdia 3h por dia fazendo vídeo pro Instagram. Hoje gravo os takes no pátio e em 5 minutos tá pronto com narração e tudo.", stars: 5 },
  { name: "Paulo Ferreira", role: "Sócio — PF Motors",     text: "O relatório de fechamento do mês mostrou que eu estava perdendo dinheiro em comissões. Ajustei na hora. Valeu cada centavo.", stars: 5 },
];

const stats = [
  { value: "2.4×",  label: "mais leads qualificados" },
  { value: "5 min", label: "para gerar um vídeo"     },
  { value: "0h",    label: "de atendimento noturno"  },
  { value: "100%",  label: "dos dados sob seu controle" },
];

const funilSteps = [
  { num: "01", icon: Instagram,  color: "bg-pink-500",  title: "Cliente vê o carro",          desc: "Ele encontra o anúncio no Instagram ou acessa a Vitrine Digital do veículo — com fotos, ficha técnica e vídeo de marketing já prontos. Um clique leva direto ao WhatsApp." },
  { num: "02", icon: Zap,        color: "bg-green-500", title: "IA assume em segundos",        desc: "O Lucas — seu vendedor virtual — responde na hora, 24 horas por dia. O cliente nunca fica sem resposta, mesmo de madrugada ou no fim de semana." },
  { num: "03", icon: MessageSquare, color: "bg-blue-500", title: "Qualificação conversacional", desc: "Em vez de um formulário frio, a IA conduz uma conversa natural: tem carro pra troca? Qual a entrada disponível? Prefere financiamento?" },
  { num: "04", icon: Phone,      color: "bg-amber-500", title: "Preço e agendamento",          desc: "Com o perfil do cliente formado, a IA revela as condições, simula o financiamento e já tenta agendar a visita ao pátio." },
  { num: "05", icon: BadgeCheck, color: "bg-red-600",   title: "Você só fecha",               desc: "Você recebe o alerta de lead quente com o histórico completo da conversa. Sua função: aparecer na visita e assinar o contrato." },
];

const chatMock = [
  { side: "in",  text: "Oi, vi o Polo Track 2023 no Instagram. Qual o preço?" },
  { side: "out", text: "Olá! O Polo Track 2023 está R$ 89.900. Você tem algum carro pra dar na troca?" },
  { side: "in",  text: "Tenho um Gol 2019" },
  { side: "out", text: "Ótimo! Quanto você estima o seu Gol? Assim já consigo ver as melhores condições pra você 😊" },
  { side: "in",  text: "Umas 45 mil" },
  { side: "out", text: "Perfeito. Com R$ 45k na troca, a diferença seria R$ 44.900. Posso te mostrar uma simulação de financiamento?" },
];

export default function PortalHome() {
  return (
    <>
      {/* HERO — dark, headline grande itálica, 2 CTAs, 4 stats */}
      <section className="relative bg-gray-900 text-white overflow-hidden">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-5" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-red-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-600/10 rounded-full blur-[100px]" />
        <div className="relative max-w-6xl mx-auto px-6 py-32 md:py-40">
          <div className="inline-flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-full px-4 py-1.5 mb-8">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            <span className="text-[11px] font-black uppercase tracking-widest text-green-400">IA para revendas brasileiras</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-black italic uppercase tracking-tighter leading-none mb-6 max-w-4xl">
            Sua revenda no<br /><span className="text-red-500">piloto automático.</span>
          </h1>
          <p className="text-lg md:text-xl text-gray-300 max-w-2xl leading-relaxed mb-10">
            O <strong className="text-white">AutoZap</strong> qualifica seus leads no WhatsApp, gera vídeos de marketing
            dos seus carros e controla o financeiro — enquanto você dorme.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link href="/onboarding" className="inline-flex items-center gap-3 px-8 py-4 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-red-500 transition-all">
              Quero uma demonstração <ArrowRight size={16} />
            </Link>
            <Link href="#como-funciona" className="inline-flex items-center gap-3 px-8 py-4 bg-white/10 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-white/20 transition-colors border border-white/10">
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
        <div className="relative h-16">
          <svg viewBox="0 0 1440 64" className="absolute bottom-0 w-full" preserveAspectRatio="none">
            <path d="M0,64 C360,0 1080,64 1440,0 L1440,64 Z" fill="white" />
          </svg>
        </div>
      </section>

      {/* FUNIL — dark, 5 passos + chat mockup */}
      <section id="como-funciona" className="py-24 bg-gray-900 text-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-500 mb-3">Como funciona</p>
            <h2 className="text-4xl md:text-5xl font-black italic uppercase tracking-tighter">
              O funil que fecha vendas<br /><span className="text-red-500">enquanto você descansa.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-8">
              {funilSteps.map((s, i) => (
                <div key={s.num} className="flex gap-5">
                  <div className="flex flex-col items-center shrink-0">
                    <div className={`w-10 h-10 ${s.color} rounded-2xl flex items-center justify-center`}>
                      <s.icon size={18} className="text-white" />
                    </div>
                    {i < funilSteps.length - 1 && <div className="w-px flex-1 bg-gray-700 mt-2" />}
                  </div>
                  <div className="pb-6">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-1">Passo {s.num}</p>
                    <h3 className="text-base font-black uppercase italic tracking-tight text-white mb-1.5">{s.title}</h3>
                    <p className="text-sm text-gray-400 leading-relaxed">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="relative">
              <div className="bg-[#0b0f0e] rounded-[2rem] p-6 border border-gray-800 shadow-2xl">
                <div className="flex items-center gap-3 pb-4 mb-4 border-b border-gray-800">
                  <div className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center">
                    <Zap size={16} className="text-white" fill="white" />
                  </div>
                  <div>
                    <p className="text-white text-sm font-black">Lucas · AutoZap</p>
                    <p className="text-green-400 text-[10px] font-bold uppercase tracking-widest">● Online agora</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {chatMock.map((m, i) => (
                    <div key={i} className={`flex ${m.side === "out" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm ${m.side === "out" ? "bg-green-600 text-white rounded-br-sm" : "bg-gray-800 text-gray-200 rounded-bl-sm"}`}>
                        {m.text}
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-end">
                    <div className="bg-green-600 rounded-2xl rounded-br-sm px-4 py-3 flex gap-1">
                      <span className="w-1.5 h-1.5 bg-white/60 rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 bg-white/60 rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 bg-white/60 rounded-full animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
                <div className="mt-5 flex items-center justify-center gap-2 text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                  <Zap size={10} className="text-red-500" /> Respondido às 2h37 da manhã
                </div>
              </div>
              <div className="absolute -bottom-5 -right-4 bg-red-600 text-white rounded-2xl px-4 py-3 shadow-2xl max-w-[220px]">
                <p className="text-[9px] font-black uppercase tracking-widest text-red-200 mb-0.5">🔥 Lead Quente</p>
                <p className="text-[11px] font-black">João — Polo Track</p>
                <p className="text-[10px] text-red-200 mt-0.5">Visita agendada · Amanhã 10h</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES — branco, grid 3x2 */}
      <section id="funcionalidades" className="py-24 max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-600 mb-3">Funcionalidades</p>
          <h2 className="text-4xl md:text-5xl font-black italic uppercase tracking-tighter text-gray-900">Tudo que sua revenda precisa.</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map(f => (
            <div key={f.title} className="bg-gray-50 rounded-[2rem] p-8 hover:bg-white hover:shadow-xl transition-all duration-300 border border-transparent hover:border-gray-100 group">
              <div className={`w-12 h-12 ${f.color} rounded-2xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform`}>
                <f.icon size={22} className="text-white" />
              </div>
              <div className="inline-block bg-gray-200 rounded-full px-3 py-0.5 text-[9px] font-black uppercase tracking-widest text-gray-600 mb-3">{f.badge}</div>
              <h3 className="text-lg font-black uppercase italic tracking-tight text-gray-900 mb-2">{f.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* DEMO AO VIVO — card dark com mascote */}
      <section className="max-w-6xl mx-auto px-6 py-10">
        <div className="bg-gray-900 rounded-[2rem] px-8 py-7 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="w-14 h-14 shrink-0 rounded-full bg-white ring-2 ring-red-600 overflow-hidden">
              <img src="/zap-mascot.png" alt="Zap" className="w-full h-full object-cover scale-110" />
            </div>
            <div>
              <p className="font-black text-white uppercase italic tracking-tight text-base">Teste a IA agora, ao vivo</p>
              <p className="text-gray-400 text-sm mt-0.5">Clique no ícone do robô ↘ e veja como a IA atende um cliente de verdade.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" /> IA online agora
          </div>
        </div>
      </section>

      {/* DEPOIMENTOS — grid 3 cards */}
      <section className="py-24 max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-600 mb-3">Depoimentos</p>
          <h2 className="text-4xl md:text-5xl font-black italic uppercase tracking-tighter text-gray-900">Quem já usa, não volta atrás.</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {testimonials.map(t => (
            <div key={t.name} className="bg-gray-50 rounded-[2rem] p-8 border border-gray-100">
              <div className="flex gap-1 mb-4">{Array.from({ length: t.stars }).map((_, i) => <Star key={i} size={14} className="text-amber-400 fill-amber-400" />)}</div>
              <p className="text-gray-700 italic leading-relaxed mb-6 text-sm">"{t.text}"</p>
              <p className="font-black text-sm text-gray-900 uppercase italic">{t.name}</p>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{t.role}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA FINAL — fundo red-600 */}
      <section className="bg-red-600 py-24">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-4xl md:text-6xl font-black italic uppercase tracking-tighter text-white mb-6 leading-none">
            Pronto para vender mais<br />sem trabalhar mais?
          </h2>
          <p className="text-red-100 text-lg mb-10 max-w-xl mx-auto">
            Um consultor visita sua revenda, configura tudo e você testa por 30 dias sem pagar nada.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/onboarding" className="inline-flex items-center justify-center gap-3 px-8 py-4 bg-white text-red-600 rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-gray-100 transition-colors">
              Quero uma demonstração <ArrowRight size={16} />
            </Link>
            <Link href="/login" className="inline-flex items-center justify-center gap-3 px-8 py-4 bg-red-700/50 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-red-700 transition-colors border border-red-500">
              Já tenho conta
            </Link>
          </div>
          <div className="mt-8 flex items-center justify-center gap-6 flex-wrap">
            {["Teste grátis por 30 dias","Consultor vai até você","Suporte via WhatsApp","Cancele quando quiser"].map(i => (
              <div key={i} className="flex items-center gap-2 text-red-100 text-[11px] font-bold uppercase tracking-widest">
                <CheckCircle2 size={12} />{i}
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
```

---

## 8. INSTRUÇÕES PARA O REDESIGN

### O que o dono quer
- **Novo design** — não está satisfeito com o visual atual
- Manter toda a **estrutura de conteúdo** (seções, textos, funcionalidades, depoimentos)
- Resultado deve ser um **arquivo `page.tsx` completo e funcional** em Next.js + Tailwind CSS v4
- Deve ser **responsivo** (mobile-first)
- Deve ser **server component** (sem `"use client"`)

### Stack técnica obrigatória
- **Next.js App Router** — `Link` de `"next/link"`, sem `<a>` direto para rotas internas
- **Tailwind CSS v4** — utility classes, sem CSS modules
- **Lucide React** — ícones (já instalado)
- **Sem dependências novas** — não adicionar bibliotecas que não existem no projeto

### Rotas internas existentes
- `/onboarding` — cadastro / começar grátis
- `/login` — login
- `/#como-funciona` — âncora na própria página
- `/#funcionalidades` — âncora na própria página

### Assets disponíveis
- `/zap-mascot.png` — mascote robô do AutoZap
- `/grid.svg` — grid sutil para fundo
- Ícones Lucide: `Zap, MessageSquare, Video, BarChart3, Users, ArrowRight, CheckCircle2, Star, TrendingUp, Car, Brain, Instagram, Phone, Calendar, BadgeCheck` (e qualquer outro do pacote)

### O que NÃO mudar
- Textos dos CTAs principais: "Quero uma demonstração" e "Já tenho conta"
- Rotas: `/onboarding` e `/login`
- Conteúdo das seções (pode reorganizar visualmente)
- Os dados (`features`, `testimonials`, `stats`, `funilSteps`, `chatMock`) — só mova para dentro do componente se necessário

---

## 9. CONTEXTO DO MERCADO

- **País**: Brasil
- **Moeda**: Real (BRL)
- **Segmento**: Revendas de veículos usados, multimarcas
- **Concorrentes diretos**: Não existe um produto igual no Brasil — é pioneiro
- **Onde os clientes estão**: Instagram, WhatsApp, OLX, Webmotors
- **Dor principal do cliente**: Trabalha 24h, não dorme, não tem controle financeiro, perde lead por demora na resposta

---

*Documento gerado em 2026-05-09 para redesign de autozap.digital*
