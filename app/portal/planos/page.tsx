import Link from "next/link";
import { CheckCircle2, X, Zap, ArrowRight, MessageSquare, Video, BarChart3, Users, Star } from "lucide-react";

const planos = [
  {
    id: "starter",
    nome: "Starter",
    preco: 97,
    periodo: "mês",
    destaque: false,
    desc: "Para revendas pequenas que querem começar a usar IA.",
    itens: [
      { ok: true,  text: "Até 30 veículos no pátio"            },
      { ok: true,  text: "1 vendedor (você mesmo)"             },
      { ok: true,  text: "IA de atendimento no WhatsApp"       },
      { ok: true,  text: "Vitrine digital por veículo"         },
      { ok: true,  text: "Gestão financeira básica"            },
      { ok: true,  text: "Relatório mensal em PDF"             },
      { ok: false, text: "Vídeos de marketing IA"              },
      { ok: false, text: "Multi-vendedor com controle de acesso"},
      { ok: false, text: "Suporte prioritário"                 },
    ],
    cta: "Começar no Starter",
    ctaHref: "/register?plano=starter",
  },
  {
    id: "pro",
    nome: "Pro",
    preco: 197,
    periodo: "mês",
    destaque: true,
    desc: "O plano mais escolhido. Para quem quer crescer de verdade.",
    badge: "Mais popular",
    itens: [
      { ok: true, text: "Veículos ilimitados"                  },
      { ok: true, text: "Até 5 vendedores"                     },
      { ok: true, text: "IA de atendimento no WhatsApp"        },
      { ok: true, text: "Vitrine digital por veículo"          },
      { ok: true, text: "Financeiro completo + comissões"      },
      { ok: true, text: "Relatório mensal em PDF"              },
      { ok: true, text: "Vídeos de marketing IA (30/mês)"      },
      { ok: true, text: "Multi-vendedor com controle de acesso"},
      { ok: false, text: "Suporte prioritário"                 },
    ],
    cta: "Começar no Pro",
    ctaHref: "/register?plano=pro",
  },
  {
    id: "enterprise",
    nome: "Enterprise",
    preco: null,
    periodo: null,
    destaque: false,
    desc: "Para redes e grupos com múltiplas lojas. Negociamos juntos.",
    itens: [
      { ok: true, text: "Tudo do Pro"                                   },
      { ok: true, text: "Lojas ilimitadas (multi-tenant)"               },
      { ok: true, text: "Vídeos de marketing IA ilimitados"             },
      { ok: true, text: "Integração via API"                            },
      { ok: true, text: "Suporte dedicado via WhatsApp"                 },
      { ok: true, text: "Onboarding presencial ou remoto"               },
      { ok: true, text: "SLA e contrato personalizado"                  },
      { ok: true, text: "Personalização de marca (white-label parcial)" },
      { ok: true, text: "Relatórios personalizados"                     },
    ],
    cta: "Falar com vendas",
    ctaHref: "https://wa.me/5511999999999?text=Olá!%20Quero%20saber%20mais%20sobre%20o%20AutoZap%20Enterprise.",
  },
];

const faq = [
  {
    q: "Preciso de cartão de crédito para testar?",
    a: "Não. O período de teste é de 14 dias completamente grátis, sem cadastrar nenhum método de pagamento.",
  },
  {
    q: "Como funciona o atendimento por IA no WhatsApp?",
    a: "Você conecta seu número do WhatsApp Business ao AutoZap. A IA responde automaticamente com informações dos seus veículos, qualifica o interesse e agenda visitas — tudo com sua identidade visual.",
  },
  {
    q: "O número do WhatsApp fica bloqueado?",
    a: "Não. Você continua usando o mesmo número normalmente. A IA atua em paralelo e você pode assumir qualquer conversa quando quiser.",
  },
  {
    q: "Posso mudar de plano depois?",
    a: "Sim, a qualquer momento. Upgrades são aplicados imediatamente com cobrança proporcional. Downgrades entram no próximo ciclo.",
  },
  {
    q: "E se eu precisar de mais vídeos no plano Pro?",
    a: "Você pode comprar pacotes de vídeos avulsos ou fazer upgrade para o Enterprise.",
  },
  {
    q: "Os meus dados ficam seguros?",
    a: "Sim. Cada revenda tem seus dados completamente isolados. Utilizamos Supabase com Row Level Security e criptografia em trânsito e em repouso.",
  },
];

export default function PlanosPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-gray-900 text-white py-20 text-center relative overflow-hidden">
        <div className="absolute top-0 right-1/4 w-[400px] h-[400px] bg-red-600/10 rounded-full blur-[100px]" />
        <div className="relative max-w-3xl mx-auto px-6">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-500 mb-4">Planos e Preços</p>
          <h1 className="text-4xl md:text-6xl font-black italic uppercase tracking-tighter mb-4 leading-none">
            Simples. Transparente.<br />
            <span className="text-red-500">Sem surpresa.</span>
          </h1>
          <p className="text-gray-400 text-lg">
            Comece grátis por 14 dias. Cancele quando quiser.
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
                  ? "bg-gray-900 text-white border-gray-900 shadow-2xl scale-[1.02]"
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
                <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${p.destaque ? "text-red-400" : "text-gray-400"}`}>
                  {p.nome}
                </p>
                {p.preco ? (
                  <div className="flex items-end gap-2">
                    <span className="text-4xl font-black italic tracking-tighter">R$ {p.preco}</span>
                    <span className={`text-sm font-bold mb-1 ${p.destaque ? "text-gray-400" : "text-gray-500"}`}>/{p.periodo}</span>
                  </div>
                ) : (
                  <p className="text-3xl font-black italic tracking-tighter">Sob consulta</p>
                )}
                <p className={`text-sm mt-2 ${p.destaque ? "text-gray-400" : "text-gray-500"}`}>{p.desc}</p>
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {p.itens.map((item, i) => (
                  <li key={i} className={`flex items-start gap-3 text-sm ${!item.ok ? "opacity-40" : ""}`}>
                    {item.ok
                      ? <CheckCircle2 size={16} className={`mt-0.5 shrink-0 ${p.destaque ? "text-green-400" : "text-green-600"}`} />
                      : <X size={16} className="mt-0.5 shrink-0" />
                    }
                    <span className={item.ok ? (p.destaque ? "text-gray-200" : "text-gray-700") : ""}>{item.text}</span>
                  </li>
                ))}
              </ul>

              <Link href={p.ctaHref}
                className={`w-full py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-widest text-center flex items-center justify-center gap-2 hover:gap-3 transition-all group
                  ${p.destaque
                    ? "bg-red-600 text-white hover:bg-red-500"
                    : "bg-gray-900 text-white hover:bg-gray-700"
                  }`}>
                {p.cta}
                <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>
          ))}
        </div>

        {/* Trial banner */}
        <div className="mt-10 bg-green-50 border border-green-100 rounded-2xl px-8 py-5 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center">
              <Zap size={18} className="text-white" fill="white" />
            </div>
            <div>
              <p className="font-black text-green-900 uppercase italic text-sm tracking-tight">14 dias grátis em qualquer plano</p>
              <p className="text-green-700 text-xs">Sem cartão de crédito. Ative quando quiser.</p>
            </div>
          </div>
          <Link href="/register"
            className="px-6 py-3 bg-green-600 text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-green-500 transition-colors whitespace-nowrap">
            Começar grátis →
          </Link>
        </div>
      </section>

      {/* Comparativo de recursos */}
      <section className="max-w-4xl mx-auto px-6 pb-20">
        <h2 className="text-2xl font-black uppercase italic tracking-tighter text-gray-900 mb-8 text-center">
          Compare os planos
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-900">
                <th className="text-left pb-4 text-[10px] font-black uppercase tracking-widest text-gray-500">Recurso</th>
                {planos.map(p => (
                  <th key={p.id} className={`pb-4 text-center text-[10px] font-black uppercase tracking-widest ${p.destaque ? "text-red-600" : "text-gray-500"}`}>
                    {p.nome}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[
                ["Veículos", "Até 30", "Ilimitados", "Ilimitados"],
                ["Vendedores", "1", "Até 5", "Ilimitados"],
                ["IA no WhatsApp", "✓", "✓", "✓"],
                ["Vitrine Digital", "✓", "✓", "✓"],
                ["Financeiro + Relatórios", "✓", "✓", "✓"],
                ["Vídeos de marketing IA", "—", "30/mês", "Ilimitados"],
                ["Multi-lojas", "—", "—", "✓"],
                ["API de integração", "—", "—", "✓"],
                ["Suporte", "Email", "Email", "WhatsApp dedicado"],
              ].map(([recurso, ...vals]) => (
                <tr key={recurso} className="hover:bg-gray-50">
                  <td className="py-3 font-medium text-gray-700">{recurso}</td>
                  {vals.map((v, i) => (
                    <td key={i} className={`py-3 text-center text-[12px] font-bold ${planos[i].destaque ? "text-red-600" : v === "—" ? "text-gray-300" : "text-gray-700"}`}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-3xl font-black uppercase italic tracking-tighter text-gray-900 mb-12 text-center">
            Perguntas frequentes
          </h2>
          <div className="space-y-6">
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
