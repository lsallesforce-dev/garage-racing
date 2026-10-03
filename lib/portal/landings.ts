// lib/portal/landings.ts
// =============================================================================
// Landing pages de SEO do portal — uma por intenção de busca do lojista
// ("sistema para revenda de carros", "crm para revenda"...). Até 10/2026 o site
// só aparecia no Google pra quem já digitava "autozap".
//
// Landing nova: entra aqui, ganha uma pasta em app/(portal)/<slug>/page.tsx e o
// path na LANDING_PATHS do proxy.ts (senão o visitante anônimo cai no /login).
// Só prometer o que o produto faz hoje.
// =============================================================================

export interface LandingSecao {
  titulo: string;
  paragrafos: string[];
  itens?: string[];
}

export interface Landing {
  slug: string;
  /** Rótulo curto no rodapé e nos links cruzados. */
  menu: string;
  /** <title> — o layout raiz acrescenta " | AutoZap". */
  title: string;
  description: string;
  chamada: string;
  h1: string;
  h1Destaque: string;
  intro: string;
  secoes: LandingSecao[];
  faq: { q: string; a: string }[];
}

export const LANDINGS: Landing[] = [
  {
    slug: "sistema-para-revenda-de-carros",
    menu: "Sistema para revenda",
    title: "Sistema para revenda de carros com IA no WhatsApp",
    description:
      "Sistema completo para revenda de carros: estoque, atendimento automático no WhatsApp, vitrine, anúncios em portais, financeiro e comissões. 30 dias grátis.",
    chamada: "Sistema para revenda de carros",
    h1: "O sistema para revenda de carros",
    h1Destaque: "que atende o cliente por você.",
    intro:
      "O AutoZap junta num só lugar o que a revenda usa todo dia: estoque, atendimento no WhatsApp, vitrine, anúncios, funil de vendas e financeiro. A diferença é que a IA faz o primeiro atendimento sozinha, a qualquer hora.",
    secoes: [
      {
        titulo: "Estoque cadastrado uma vez, usado em todo lugar",
        paragrafos: [
          "Você cadastra o carro com fotos, ficha e preço. A partir daí o mesmo cadastro alimenta a vitrine da loja, os anúncios nos portais, os vídeos de marketing e as respostas da IA no WhatsApp.",
          "Vendeu o carro? Ele sai da vitrine e a IA para de oferecer. Sem planilha paralela e sem anúncio de carro que já foi embora.",
        ],
      },
      {
        titulo: "Atendimento no WhatsApp 24 horas",
        paragrafos: [
          "A maior parte dos leads chega fora do horário comercial. A IA responde em segundos, tira dúvida sobre o carro, manda foto, entende áudio e qualifica o cliente: o que ele procura, se tem troca, se vai financiar.",
          "Quando o cliente está pronto pra negociar, o vendedor recebe o aviso e assume a conversa no mesmo número.",
        ],
      },
      {
        titulo: "Financeiro por veículo",
        paragrafos: [
          "Cada carro tem o seu custo: compra, preparação, documentação, comissão. O sistema mostra o lucro bruto e líquido de cada venda e fecha o mês num relatório em PDF.",
        ],
        itens: [
          "Despesas lançadas por veículo",
          "Comissão por vendedor",
          "Contrato de compra e venda",
          "Emissão de NF-e no plano Premium",
        ],
      },
      {
        titulo: "Pra revenda pequena e pra quem tem equipe",
        paragrafos: [
          "O plano Starter atende quem trabalha sozinho com até 30 carros no pátio. Os planos Pro e Premium liberam estoque ilimitado e acesso individual pra cada vendedor, com controle do que cada um enxerga.",
        ],
      },
    ],
    faq: [
      {
        q: "Quanto custa um sistema para revenda de carros?",
        a: "No AutoZap os planos começam em R$ 1.150 por mês, com 30 dias de teste grátis e sem fidelidade.",
      },
      {
        q: "Preciso trocar o número de WhatsApp da loja?",
        a: "Não. A IA atende no número que a loja já usa, e o vendedor continua conversando por ele normalmente.",
      },
      {
        q: "Funciona pra revenda pequena?",
        a: "Sim. O plano Starter foi feito pra quem tem até 30 veículos e atende sozinho.",
      },
      {
        q: "Quanto tempo leva pra começar a usar?",
        a: "A implantação é feita junto com a nossa equipe: cadastro do estoque, conexão do WhatsApp e configuração da vitrine.",
      },
    ],
  },
  {
    slug: "crm-para-revenda-de-veiculos",
    menu: "CRM para revenda",
    title: "CRM para revenda de veículos: leads do WhatsApp no funil",
    description:
      "CRM para revenda de veículos que captura o lead do WhatsApp sozinho, qualifica com IA, organiza o funil por vendedor e faz o follow-up. 30 dias grátis.",
    chamada: "CRM para revenda de veículos",
    h1: "CRM para revenda de veículos",
    h1Destaque: "que se preenche sozinho.",
    intro:
      "CRM que depende do vendedor digitar cada lead não dura duas semanas. No AutoZap o lead entra no funil no momento em que manda a primeira mensagem no WhatsApp, já com o carro de interesse e o que ele respondeu pra IA.",
    secoes: [
      {
        titulo: "Todo lead registrado, sem digitação",
        paragrafos: [
          "Cada conversa vira um cliente no sistema, com nome, telefone, carro de interesse e histórico completo. Veio de anúncio no Instagram, do portal ou da vitrine: a origem fica gravada.",
          "O gerente enxerga o que entrou, quem atendeu e em que etapa cada negociação parou.",
        ],
      },
      {
        titulo: "Qualificação feita pela IA",
        paragrafos: [
          "Antes de chegar no vendedor, a IA já perguntou o que importa: qual carro, forma de pagamento, se tem veículo na troca, quando pretende comprar. O vendedor recebe o lead quente e com contexto.",
        ],
        itens: [
          "Interesse e carro consultado",
          "Entrada, financiamento ou à vista",
          "Veículo na troca",
          "Agendamento de visita",
        ],
      },
      {
        titulo: "Funil e follow-up",
        paragrafos: [
          "As negociações ficam num funil por etapa. Lead que parou de responder recebe follow-up automático, e o que esfriou não fica esquecido na lista de conversas do celular.",
        ],
      },
      {
        titulo: "Equipe com acesso individual",
        paragrafos: [
          "Cada vendedor entra com o próprio login e vê os seus leads. O dono acompanha tudo: atendimentos, vendas e comissão de cada um.",
        ],
      },
    ],
    faq: [
      {
        q: "O que um CRM para revenda de veículos precisa ter?",
        a: "Captura automática dos leads do WhatsApp, histórico de conversa, funil por etapa, ligação com o estoque e controle por vendedor. Sem a captura automática, o CRM vira mais uma planilha.",
      },
      {
        q: "O CRM funciona com o WhatsApp da loja?",
        a: "Sim. As conversas do número da loja entram no sistema e o vendedor pode assumir o atendimento a qualquer momento.",
      },
      {
        q: "Consigo ver de onde veio cada lead?",
        a: "Sim. O sistema registra a origem do contato e mostra em gráfico quais canais trazem mais clientes.",
      },
      {
        q: "Meus vendedores veem os leads uns dos outros?",
        a: "Cada vendedor tem acesso individual. O dono da revenda enxerga todos.",
      },
    ],
  },
  {
    slug: "ia-whatsapp-para-revenda-de-carros",
    menu: "IA no WhatsApp",
    title: "IA no WhatsApp para revenda de carros: atendimento 24h",
    description:
      "Atendimento automático no WhatsApp para revenda de carros. A IA conhece o seu estoque, responde em segundos, entende áudio, manda fotos e passa o lead pronto pro vendedor.",
    chamada: "Atendimento automático no WhatsApp",
    h1: "IA no WhatsApp da sua revenda,",
    h1Destaque: "respondendo em segundos.",
    intro:
      "Cliente que pergunta de um carro às 22h e só recebe resposta no dia seguinte já falou com outra loja. A IA do AutoZap atende na hora, com as informações do seu estoque, e entrega pro vendedor só quem quer negociar.",
    secoes: [
      {
        titulo: "Uma IA que conhece o seu pátio",
        paragrafos: [
          "Ela não é um robô de menu com \"digite 1\". A IA lê o seu estoque e responde como um vendedor: preço, ano, quilometragem, opcionais, fotos do carro. Se o cliente pede algo que você não tem, ela sugere o que há de parecido.",
        ],
        itens: [
          "Responde texto e entende áudio",
          "Envia as fotos do veículo",
          "Busca no estoque por modelo, faixa de preço ou tipo de carro",
          "Informa endereço e horário da loja",
        ],
      },
      {
        titulo: "Qualifica antes de chamar o vendedor",
        paragrafos: [
          "A conversa segue até a IA entender o que o cliente quer e como pretende pagar. Em financiamento, ela coleta os dados pra simulação. Com o cliente pronto, o vendedor é avisado no WhatsApp e assume.",
        ],
      },
      {
        titulo: "O vendedor assume quando quiser",
        paragrafos: [
          "A qualquer momento o vendedor entra na conversa e a IA sai de cena. O cliente continua no mesmo número, sem perceber troca de atendente.",
        ],
      },
      {
        titulo: "Follow-up de quem sumiu",
        paragrafos: [
          "Lead que parou de responder recebe uma retomada automática. É o trabalho que ninguém da equipe tem tempo de fazer e que recupera venda.",
        ],
      },
    ],
    faq: [
      {
        q: "A IA responde no meu número de WhatsApp?",
        a: "Sim. Ela atende no número da loja, e o vendedor continua usando o mesmo número.",
      },
      {
        q: "A IA inventa preço ou informação do carro?",
        a: "Ela responde com base no estoque cadastrado no sistema. O que não está cadastrado ela não afirma: passa pro vendedor.",
      },
      {
        q: "Ela entende áudio?",
        a: "Sim. O cliente pode mandar áudio e a IA responde normalmente.",
      },
      {
        q: "E se o cliente quiser falar com uma pessoa?",
        a: "O vendedor é avisado e assume a conversa. A IA para de responder naquele atendimento.",
      },
    ],
  },
  {
    slug: "anunciar-carros-webmotors-olx",
    menu: "Anunciar em portais",
    title: "Anunciar carros na Webmotors, OLX, Facebook e Instagram",
    description:
      "Cadastre o carro uma vez e publique na Webmotors, OLX, Facebook e Instagram direto do sistema. Vitrine própria com link por veículo e leads atendidos por IA.",
    chamada: "Anúncios em vários portais",
    h1: "Cadastre o carro uma vez.",
    h1Destaque: "Anuncie em todos os canais.",
    intro:
      "Preencher o mesmo anúncio em quatro sites toma horas e sempre sobra um carro vendido no ar. No AutoZap o cadastro do estoque é a fonte: dele saem os anúncios dos portais, os posts e a vitrine da loja.",
    secoes: [
      {
        titulo: "Webmotors e OLX direto do estoque",
        paragrafos: [
          "Com o carro cadastrado, a publicação nos portais sai do próprio sistema, com as fotos e a ficha que você já preencheu. O status de cada anúncio aparece ao lado do veículo.",
        ],
      },
      {
        titulo: "Facebook e Instagram",
        paragrafos: [
          "O sistema posta o carro no feed da loja e cria anúncio pago na Meta com o público da sua região. Dá pra montar carrossel com vários carros do estoque e acompanhar o resultado de cada campanha.",
        ],
        itens: [
          "Post orgânico no Facebook e Instagram",
          "Anúncio pago com clique pro WhatsApp",
          "Carrossel de estoque",
          "Vídeo do carro gerado por IA",
        ],
      },
      {
        titulo: "Vitrine própria com link por veículo",
        paragrafos: [
          "Cada loja ganha uma vitrine online com o estoque atualizado. Todo carro tem a sua página, com fotos, vídeo, ficha, simulador de financiamento e botão de WhatsApp. É o link que vai no anúncio e na bio.",
        ],
      },
      {
        titulo: "O lead do anúncio já cai na IA",
        paragrafos: [
          "Anunciar é metade do trabalho. O cliente que clica chega no WhatsApp da loja e é atendido na hora pela IA, que já sabe de qual carro ele veio.",
        ],
      },
    ],
    faq: [
      {
        q: "Preciso ter conta na Webmotors e na OLX?",
        a: "Sim. O AutoZap publica usando a conta e o plano de anúncios que a revenda já tem em cada portal.",
      },
      {
        q: "Quando vendo o carro, o anúncio sai do ar?",
        a: "O carro vendido sai da vitrine da loja automaticamente e deixa de ser oferecido pela IA.",
      },
      {
        q: "Dá pra anunciar no Instagram sem agência?",
        a: "Sim. O sistema cria a campanha a partir do carro cadastrado, e você define o valor e o período.",
      },
      {
        q: "A vitrine pode usar o domínio da minha loja?",
        a: "Pode. A vitrine funciona num endereço do AutoZap ou no domínio próprio da revenda.",
      },
    ],
  },
];

export function getLanding(slug: string): Landing {
  const l = LANDINGS.find((x) => x.slug === slug);
  if (!l) throw new Error(`landing desconhecida: ${slug}`);
  return l;
}
