import Link from "next/link";
import { Zap, Target, Shield, Cpu, ArrowRight, Heart } from "lucide-react";

const valores = [
  {
    icon: Target,
    title: "Focado no resultado",
    desc: "Cada funcionalidade existe para um motivo: ajudar você a vender mais carros. Sem recursos supérfluos.",
  },
  {
    icon: Cpu,
    title: "IA com propósito",
    desc: "Não usamos IA por modismo. Cada aplicação foi pensada para resolver um problema real de quem vive no pátio.",
  },
  {
    icon: Shield,
    title: "Seus dados são seus",
    desc: "Nada dos seus clientes, veículos ou negociações é compartilhado ou usado para treinar modelos externos.",
  },
  {
    icon: Heart,
    title: "Feito por quem entende",
    desc: "O AutoZap nasceu de conversas com revendedores reais. Cada dor que resolvemos é uma dor que ouvimos.",
  },
];

const stack = [
  { name: "Next.js",      desc: "Interface web ultra-rápida"               },
  { name: "Supabase",     desc: "Banco de dados e autenticação"            },
  { name: "Gemini 2.5",   desc: "Análise e geração de conteúdo com IA"    },
  { name: "OpenAI TTS",   desc: "Narração realista para vídeos"            },
  { name: "Cloudflare R2", desc: "Armazenamento de vídeos em escala global"   },
  { name: "FFmpeg",       desc: "Montagem e edição de vídeos"              },
];

export default function SobrePage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-gray-900 text-white py-24 relative overflow-hidden">
        <div className="absolute bottom-0 left-1/3 w-[500px] h-[300px] bg-red-600/10 rounded-full blur-[100px]" />
        <div className="relative max-w-4xl mx-auto px-6 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-500 mb-4">Nossa história</p>
          <h1 className="text-4xl md:text-6xl font-black italic uppercase tracking-tighter mb-6 leading-none">
            Nascemos no pátio.<br />
            <span className="text-red-500">Construímos no código.</span>
          </h1>
          <p className="text-gray-300 text-lg max-w-2xl mx-auto leading-relaxed">
            O AutoZap surgiu de uma pergunta simples: por que revendedores passam horas respondendo WhatsApp,
            editando vídeos e controlando planilhas, se a tecnologia pode fazer tudo isso por eles?
          </p>
        </div>
      </section>

      {/* História */}
      <section className="max-w-4xl mx-auto px-6 py-24">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-600 mb-4">O problema</p>
            <h2 className="text-3xl font-black italic uppercase tracking-tighter text-gray-900 mb-6">
              Todo dono de revenda tem os mesmos problemas.
            </h2>
            <div className="space-y-4 text-gray-600 text-sm leading-relaxed">
              <p>
                WhatsApp bombando às 23h com pergunta sobre o Gol 2018. Vídeo do carro que levou 2h para editar
                e teve 34 visualizações. Planilha com os custos desatualizada há 3 semanas.
              </p>
              <p>
                O revendedor brasileiro é empreendedor, é vendedor, é mecânico de pronto-socorro, é designer
                e é analista financeiro — tudo ao mesmo tempo. E ainda precisa estar de bom humor com o cliente.
              </p>
              <p>
                A gente viu isso de perto e decidiu usar inteligência artificial para dar de volta o que esse
                profissional mais precisa: <strong className="text-gray-900">tempo para fechar vendas.</strong>
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { n: "4h",   l: "por dia em atendimento WhatsApp"      },
              { n: "2h",   l: "para editar um vídeo de 1 minuto"     },
              { n: "62%",  l: "dos leads abandonados sem follow-up"  },
              { n: "0%",   l: "de controle financeiro por veículo"   },
            ].map(s => (
              <div key={s.n} className="bg-gray-50 rounded-2xl p-6 text-center border border-gray-100">
                <p className="text-3xl font-black italic text-red-600 tracking-tighter">{s.n}</p>
                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1 leading-tight">{s.l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Valores */}
      <section className="bg-gray-50 py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-600 mb-3">Princípios</p>
            <h2 className="text-3xl md:text-4xl font-black italic uppercase tracking-tighter text-gray-900">
              O que nos guia.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {valores.map(v => (
              <div key={v.title} className="bg-white rounded-[2rem] p-8 border border-gray-100 hover:shadow-lg transition-all">
                <div className="w-12 h-12 bg-gray-900 rounded-2xl flex items-center justify-center mb-5">
                  <v.icon size={20} className="text-white" />
                </div>
                <h3 className="font-black uppercase italic tracking-tight text-gray-900 mb-2 text-sm">{v.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stack técnico */}
      <section className="max-w-4xl mx-auto px-6 py-24">
        <div className="text-center mb-12">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-600 mb-3">Tecnologia</p>
          <h2 className="text-3xl font-black italic uppercase tracking-tighter text-gray-900">
            Construído com as melhores ferramentas.
          </h2>
          <p className="text-gray-500 mt-3 text-sm max-w-xl mx-auto">
            Usamos infraestrutura de nível enterprise para que você tenha confiabilidade sem precisar se preocupar com isso.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {stack.map(s => (
            <div key={s.name} className="bg-gray-50 rounded-2xl p-5 border border-gray-100 flex items-center gap-4">
              <div className="w-2 h-2 bg-red-600 rounded-full shrink-0" />
              <div>
                <p className="font-black text-sm text-gray-900 uppercase italic">{s.name}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gray-900 text-white py-20">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-red-600 rounded-2xl flex items-center justify-center">
              <Zap size={30} className="text-white" fill="white" />
            </div>
          </div>
          <h2 className="text-3xl md:text-5xl font-black italic uppercase tracking-tighter mb-4 leading-none">
            Faça parte da revolução.
          </h2>
          <p className="text-gray-400 mb-8 text-lg">
            Junte-se às revendas que já trabalham com IA. 14 dias grátis, sem compromisso.
          </p>
          <Link href="/planos"
            className="inline-flex items-center gap-3 px-8 py-4 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-red-500 transition-all hover:gap-4 group">
            Ver planos
            <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </section>
    </>
  );
}
