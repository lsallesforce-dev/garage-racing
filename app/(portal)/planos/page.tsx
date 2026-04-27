import Link from "next/link";
import { CheckCircle2, X, Zap, ArrowRight, Star, Phone } from "lucide-react";

const planos = [
  {
    id: "starter",
    nome: "Starter",
    preco: "1.150",
    destaque: false,
    desc: "Para quem está começando e quer a IA trabalhando no WhatsApp desde o primeiro dia.",
    itens: [
      { ok: true,  text: "Até 30 veículos no pátio"        },
      { ok: true,  text: "1 vendedor (você mesmo)"         },
      { ok: true,  text: "IA de atendimento no WhatsApp"   },
      { ok: true,  text: "Vitrine digital por veículo"     },
      { ok: true,  text: "15 vídeos de marketing IA/mês"   },
      { ok: true,  text: "Trial de 30 dias grátis"         },
      { ok: false, text: "Multi-vendedor"                  },
      { ok: false, text: "Financeiro completo + comissões" },
      { ok: false, text: "Relatório mensal em PDF"         },
    ],
    cta: "Começar trial grátis",
    ctaHref: "/onboarding?plano=starter",
  },
  {
    id: "pro",
    nome: "Pro",
    preco: "1.500",
    destaque: true,
    badge: "Mais completo",
    desc: "Para revendas que já rodam e querem controle total: equipe, financeiro e marketing.",
    itens: [
      { ok: true, text: "Veículos ilimitados"                   },
      { ok: true, text: "Até 5 vendedores com acesso individual" },
      { ok: true, text: "IA de atendimento no WhatsApp"          },
      { ok: true, text: "Vitrine digital por veículo"            },
      { ok: true, text: "30 vídeos de marketing IA/mês"          },
      { ok: true, text: "Financeiro completo + comissões"        },
      { ok: true, text: "Relatório mensal em PDF"                },
      { ok: true, text: "Multi-vendedor com controle de acesso"  },
      { ok: true, text: "Trial de 30 dias grátis"                },
    ],
    cta: "Começar trial grátis",
    ctaHref: "/onboarding?plano=pro",
  },
  {
    id: "enterprise",
    nome: "Enterprise",
    preco: null,
    destaque: false,
    desc: "Para redes e grupos com múltiplas lojas. Negociamos juntos.",
    itens: [
      { ok: true, text: "Tudo do Pro"                                   },
      { ok: true, text: "Múltiplas lojas (multi-tenant)"                },
      { ok: true, text: "Vídeos de marketing IA ilimitados"             },
      { ok: true, text: "Onboarding presencial ou remoto"               },
      { ok: true, text: "Suporte dedicado via WhatsApp"                 },
      { ok: true, text: "SLA e contrato personalizado"                  },
      { ok: true, text: "Personalização de marca (white-label parcial)" },
    ],
    cta: "Falar com vendas",
    ctaHref: "https://wa.me/5511999999999?text=Olá!%20Quero%20saber%20mais%20sobre%20o%20AutoZap%20Enterprise.",
    ctaExterno: true,
  },
];

const faq = [
  {
    q: "Como funciona o trial de 30 dias?",
    a: "Um de nossos consultores agenda uma visita para configurar o sistema na sua revenda. Você usa por 30 dias sem pagar nada. Se gostar, assina. Se não gostar, não tem custo.",
  },
  {
    q: "Como funciona a IA no WhatsApp?",
    a: "Você conecta seu número do WhatsApp Business ao AutoZap. A IA responde automaticamente com informações dos seus veículos, qualifica o interesse e avisa você quando o cliente está pronto para fechar. Você assume a conversa quando quiser.",
  },
  {
    q: "O número do WhatsApp fica bloqueado?",
    a: "Não. Você continua usando o mesmo número normalmente. A IA atua em paralelo e você assume qualquer conversa com um clique.",
  },
  {
    q: "O que é a vitrine digital por veículo?",
    a: "Cada veículo do seu pátio ganha uma página pública com fotos, ficha técnica, vídeo de marketing e botão direto para o WhatsApp. Ideal para compartilhar no Instagram e grupos.",
  },
  {
    q: "Posso mudar de plano depois?",
    a: "Sim, a qualquer momento. Upgrade aplicado na hora. Downgrade entra no próximo ciclo.",
  },
  {
    q: "Os meus dados ficam seguros?",
    a: "Sim. Cada revenda tem seus dados completamente isolados. Utilizamos Supabase com Row Level Security e criptografia em trânsito e em repouso. Estamos em conformidade com a LGPD.",
  },
];

export default function PlanosPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-gray-900 text-white py-20 text-center relative overflow-hidden">
        <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-red-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-1/4 w-[300px] h-[300px] bg-red-600/5 rounded-full blur-[80px]" />
        <div className="relative max-w-3xl mx-auto px-6">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-500 mb-4">Planos e Preços</p>
          <h1 className="text-4xl md:text-6xl font-black italic uppercase tracking-tighter mb-6 leading-none">
            30 dias grátis.<br />
            <span className="text-red-500">Sem cartão.</span>
          </h1>
          <p className="text-gray-400 text-lg max-w-xl mx-auto">
            Um consultor vai até sua revenda, configura tudo e você vê a IA funcionando antes de pagar qualquer coisa.
          </p>
        </div>
      </section>

      {/* Cards */}
      <section className="py-20 max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          {planos.map(p => (
            <div key={p.id}
              className={`rounded-[2rem] p-8 border relative flex flex-col
                ${p.destaque
                  ? "bg-gray-900 text-white border-gray-900 shadow-2xl md:scale-[1.03]"
                  : "bg-gray-50 text-gray-900 border-gray-100"
                }`}>

              {p.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-red-600 text-white text-[9px] font-black uppercase tracking-widest px-4 py-1.5 rounded-full flex items-center gap-1">
                    <Star size={9} fill="white" /> {p.badge}
                  </span>
                </div>
              )}

              <div className="mb-6">
                <p className={`text-[10px] font-black uppercase tracking-widest mb-2 ${p.destaque ? "text-red-400" : "text-gray-400"}`}>
                  {p.nome}
                </p>
                {p.preco ? (
                  <div className="flex items-end gap-2 mb-1">
                    <span className={`text-[11px] font-black ${p.destaque ? "text-gray-400" : "text-gray-500"}`}>R$</span>
                    <span className="text-4xl font-black italic tracking-tighter">{p.preco}</span>
                    <span className={`text-sm font-bold mb-1 ${p.destaque ? "text-gray-400" : "text-gray-500"}`}>/mês</span>
                  </div>
                ) : (
                  <p className="text-3xl font-black italic tracking-tighter mb-1">Sob consulta</p>
                )}
                <p className={`text-xs mt-3 leading-relaxed ${p.destaque ? "text-gray-400" : "text-gray-500"}`}>{p.desc}</p>
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {p.itens.map((item, i) => (
                  <li key={i} className={`flex items-start gap-3 text-sm ${!item.ok ? "opacity-35" : ""}`}>
                    {item.ok
                      ? <CheckCircle2 size={15} className={`mt-0.5 shrink-0 ${p.destaque ? "text-green-400" : "text-green-600"}`} />
                      : <X size={15} className="mt-0.5 shrink-0" />
                    }
                    <span className={item.ok ? (p.destaque ? "text-gray-200" : "text-gray-700") : "text-gray-400"}>
                      {item.text}
                    </span>
                  </li>
                ))}
              </ul>

              {(p as any).ctaExterno ? (
                <a href={p.ctaHref} target="_blank" rel="noopener noreferrer"
                  className="w-full py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-widest text-center flex items-center justify-center gap-2 hover:gap-3 transition-all group bg-gray-900 text-white hover:bg-gray-700">
                  <Phone size={13} />
                  {p.cta}
                </a>
              ) : (
                <Link href={p.ctaHref}
                  className={`w-full py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-widest text-center flex items-center justify-center gap-2 hover:gap-3 transition-all group
                    ${p.destaque
                      ? "bg-red-600 text-white hover:bg-red-500"
                      : "bg-gray-900 text-white hover:bg-gray-700"
                    }`}>
                  {p.cta}
                  <ArrowRight size={13} className="group-hover:translate-x-1 transition-transform" />
                </Link>
              )}
            </div>
          ))}
        </div>

        {/* Link para quem já tem conta */}
        <p className="text-center text-gray-400 text-sm mt-8">
          Já tem uma conta?{" "}
          <Link href="/assinar" className="text-red-500 hover:text-red-400 font-bold underline underline-offset-2 transition-colors">
            Clique aqui para assinar
          </Link>
        </p>

        {/* Banner trial */}
        <div className="mt-6 bg-gray-900 rounded-[2rem] px-8 py-7 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-red-600 rounded-2xl flex items-center justify-center shrink-0">
              <Zap size={20} className="text-white" fill="white" />
            </div>
            <div>
              <p className="font-black text-white uppercase italic tracking-tight">Um consultor vai até você</p>
              <p className="text-gray-400 text-sm mt-0.5">Configuramos tudo na sua revenda. 30 dias para testar. Zero custo.</p>
            </div>
          </div>
          <Link href="/onboarding"
            className="px-8 py-3.5 bg-red-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-red-500 transition-colors whitespace-nowrap">
            Quero testar grátis →
          </Link>
        </div>
      </section>

      {/* Comparativo */}
      <section className="max-w-4xl mx-auto px-6 pb-20">
        <h2 className="text-2xl font-black uppercase italic tracking-tighter text-gray-900 mb-8 text-center">
          Compare os planos
        </h2>
        <div className="overflow-x-auto rounded-[2rem] border border-gray-100 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-5 px-6 text-[10px] font-black uppercase tracking-widest text-gray-400">Recurso</th>
                <th className="py-5 px-4 text-center text-[10px] font-black uppercase tracking-widest text-gray-500">Starter</th>
                <th className="py-5 px-4 text-center text-[10px] font-black uppercase tracking-widest text-red-600">Pro</th>
                <th className="py-5 px-4 text-center text-[10px] font-black uppercase tracking-widest text-gray-500">Enterprise</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[
                ["Veículos",                  "Até 30",     "Ilimitados",  "Ilimitados"      ],
                ["Vendedores",                "1",          "Até 5",       "Ilimitados"      ],
                ["IA no WhatsApp",            "✓",          "✓",           "✓"               ],
                ["Vitrine digital",           "✓",          "✓",           "✓"               ],
                ["Vídeos de marketing IA",    "15/mês",     "30/mês",      "Ilimitados"      ],
                ["Financeiro + Comissões",    "—",          "✓",           "✓"               ],
                ["Relatório mensal PDF",      "—",          "✓",           "✓"               ],
                ["Multi-vendedor",            "—",          "✓",           "✓"               ],
                ["Múltiplas lojas",           "—",          "—",           "✓"               ],
                ["Suporte",                   "Email",      "Email",       "WhatsApp direto" ],
                ["Trial",                     "30 dias",    "30 dias",     "Personalizado"   ],
              ].map(([recurso, starter, pro, enterprise]) => (
                <tr key={recurso} className="hover:bg-gray-50/50 transition-colors">
                  <td className="py-4 px-6 font-bold text-gray-700">{recurso}</td>
                  <td className={`py-4 px-4 text-center text-[12px] font-bold ${starter === "—" ? "text-gray-200" : "text-gray-600"}`}>{starter}</td>
                  <td className={`py-4 px-4 text-center text-[12px] font-bold ${pro === "—" ? "text-gray-200" : "text-red-600"}`}>{pro}</td>
                  <td className={`py-4 px-4 text-center text-[12px] font-bold ${enterprise === "—" ? "text-gray-200" : "text-gray-600"}`}>{enterprise}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ROI simples */}
      <section className="bg-gray-900 text-white py-20">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-500 mb-4">A conta é simples</p>
          <h2 className="text-3xl md:text-5xl font-black italic uppercase tracking-tighter mb-6 leading-none">
            1 venda a mais por mês<br />
            <span className="text-red-500">já paga o sistema.</span>
          </h2>
          <p className="text-gray-400 text-lg mb-10">
            A margem média de um carro usado é R$ 2.000 a R$ 5.000. Se a IA fechar um lead que você perderia respondendo tarde, o AutoZap já se pagou — e sobrou.
          </p>
          <Link href="/onboarding"
            className="inline-flex items-center gap-2 px-8 py-4 bg-red-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-red-500 transition-colors">
            Testar 30 dias grátis <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-3xl font-black uppercase italic tracking-tighter text-gray-900 mb-12 text-center">
            Perguntas frequentes
          </h2>
          <div className="space-y-4">
            {faq.map(f => (
              <div key={f.q} className="bg-white rounded-2xl p-6 border border-gray-100">
                <p className="font-black text-gray-900 mb-2 text-sm uppercase italic tracking-tight">{f.q}</p>
                <p className="text-gray-500 text-sm leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
