// lib/frases-motivacionais.ts
//
// Banco fixo de frases pra mensagem de "Bom dia" do Repasse Automático em
// Comunidade (ver lib/repasse.ts → gerarTextoBomDia). Lista estática, sem
// depender de API — evita custo/risco de billing do Gemini (compartilhado
// com outros produtos) só pra gerar uma frase de bom dia.
//
// Rotação: 1 frase por dia do ano, sem repetir até a lista dar a volta
// completa (ver fraseDoDia).

export interface FraseDoDia {
  frase: string;
  autor: string;
}

export const FRASES_MOTIVACIONAIS: FraseDoDia[] = [
  { frase: "Tente mover o mundo, mas o primeiro passo é mover a si mesmo.", autor: "Sócrates" },
  { frase: "Aos que correm em busca da felicidade, aviso que ela não está no fim da estrada, mas em toda a parte.", autor: "Carlos Drummond de Andrade" },
  { frase: "Não é o mais forte que sobrevive, nem o mais inteligente, mas o que melhor se adapta às mudanças.", autor: "Charles Darwin" },
  { frase: "O sucesso é a soma de pequenos esforços repetidos dia após dia.", autor: "Robert Collier" },
  { frase: "Faça o que puder, com o que tiver, no lugar em que estiver.", autor: "Theodore Roosevelt" },
  { frase: "A persistência é o caminho do êxito.", autor: "Charles Chaplin" },
  { frase: "Grandes realizações são possíveis quando se dá atenção aos pequenos começos.", autor: "Lao-Tsé" },
  { frase: "O único lugar onde o sucesso vem antes do trabalho é no dicionário.", autor: "Albert Einstein" },
  { frase: "Não espere por circunstâncias ideais. Elas nunca serão perfeitas.", autor: "Napoleon Hill" },
  { frase: "A qualidade nunca é um acidente; é sempre o resultado de um esforço inteligente.", autor: "John Ruskin" },
  { frase: "Fracassar é apenas a oportunidade de recomeçar de novo, com mais inteligência.", autor: "Henry Ford" },
  { frase: "A vida é 10% o que acontece comigo e 90% como eu reajo a isso.", autor: "Charles Swindoll" },
  { frase: "Comece onde você está, use o que você tem, faça o que você pode.", autor: "Arthur Ashe" },
  { frase: "O pessimista vê dificuldade em cada oportunidade; o otimista vê oportunidade em cada dificuldade.", autor: "Winston Churchill" },
  { frase: "Quem quer fazer algo encontra um meio; quem não quer, encontra uma desculpa.", autor: "Provérbio popular" },
  { frase: "Não deixe o barulho da opinião dos outros abafar sua voz interior.", autor: "Steve Jobs" },
  { frase: "A disciplina é a ponte entre metas e realizações.", autor: "Jim Rohn" },
  { frase: "Aquilo que fazemos com constância se torna mais fácil, não porque a natureza da tarefa mudou, mas nossa capacidade de fazê-la aumentou.", autor: "Ralph Waldo Emerson" },
  { frase: "Ninguém pode voltar atrás e fazer um novo começo, mas qualquer um pode começar agora e fazer um novo fim.", autor: "Chico Xavier" },
  { frase: "Não importa o quão devagar você vá, desde que você não pare.", autor: "Confúcio" },
  { frase: "A força não vem da capacidade física. Vem de uma vontade indomável.", autor: "Mahatma Gandhi" },
  { frase: "Ganhar não é tudo, mas querer ganhar sim.", autor: "Vince Lombardi" },
  { frase: "Você nunca sabe que resultados virão da sua ação. Mas se você não fizer nada, não existirão resultados.", autor: "Mahatma Gandhi" },
  { frase: "A melhor forma de prever o futuro é criá-lo.", autor: "Peter Drucker" },
  { frase: "Só existem dois dias no ano em que nada pode ser feito: ontem e amanhã.", autor: "Dalai Lama" },
  { frase: "O sucesso nasce do querer, da determinação e persistência em se chegar a um objetivo.", autor: "José de Alencar" },
  { frase: "Determinação, coragem e autoconfiança são fatores decisivos para o sucesso.", autor: "Dalai Lama" },
  { frase: "A maior glória em viver não está em nunca cair, mas em nos levantarmos a cada vez que caímos.", autor: "Nelson Mandela" },
  { frase: "Se você quer ir rápido, vá sozinho. Se quer ir longe, vá acompanhado.", autor: "Provérbio africano" },
  { frase: "O trabalho duro vence o talento quando o talento não trabalha duro.", autor: "Tim Notke" },
  { frase: "Não tenha medo de desistir do bom para perseguir o ótimo.", autor: "John D. Rockefeller" },
  { frase: "A confiança em si mesmo é o primeiro segredo do sucesso.", autor: "Ralph Waldo Emerson" },
  { frase: "Cair é permitido, levantar é obrigatório.", autor: "Provérbio popular" },
  { frase: "Transforme suas feridas em sabedoria.", autor: "Oprah Winfrey" },
  { frase: "O único jeito de fazer um excelente trabalho é amar o que você faz.", autor: "Steve Jobs" },
  { frase: "Todo mestre já foi um dia iniciante.", autor: "Provérbio popular" },
  { frase: "Aprender é a única coisa de que a mente nunca se cansa, nunca tem medo e nunca se arrepende.", autor: "Leonardo da Vinci" },
  { frase: "A vida é como andar de bicicleta. Para manter o equilíbrio, você deve se manter em movimento.", autor: "Albert Einstein" },
  { frase: "Foco em progresso, não em perfeição.", autor: "Bill Gates" },
  { frase: "Um objetivo bem colocado é a metade do caminho andado.", autor: "Provérbio popular" },
  { frase: "A ação é a chave fundamental para todo sucesso.", autor: "Pablo Picasso" },
  { frase: "Quem não sabe para onde vai, qualquer caminho serve.", autor: "Lewis Carroll" },
  { frase: "O impossível é apenas uma questão de opinião.", autor: "Muhammad Ali" },
  { frase: "Seja a mudança que você quer ver no mundo.", autor: "Mahatma Gandhi" },
  { frase: "Nada na vida deve ser temido, apenas compreendido.", autor: "Marie Curie" },
  { frase: "Você é o único responsável pela sua vida. Ponto final.", autor: "Oprah Winfrey" },
  { frase: "A persistência realiza o impossível.", autor: "Provérbio chinês" },
  { frase: "O primeiro passo para chegar a algum lugar é decidir que você não vai ficar onde está.", autor: "J.P. Morgan" },
  { frase: "Grandes coisas nunca vêm de zonas de conforto.", autor: "Provérbio popular" },
  { frase: "Se a oportunidade não bater na porta, construa uma porta.", autor: "Milton Berle" },
  { frase: "Sonhos não têm prazo de validade. Persista.", autor: "Renato Russo" },
  { frase: "A jornada de mil quilômetros começa com um único passo.", autor: "Lao-Tsé" },
  { frase: "O sucesso é ir de fracasso em fracasso sem perder o entusiasmo.", autor: "Winston Churchill" },
  { frase: "Aja como se fosse impossível fracassar.", autor: "Dorothea Brande" },
  { frase: "Cuide bem de cada cliente como se fosse o único, porque pra ele, você é a única loja.", autor: "Provérbio comercial" },
  { frase: "Boas vendas começam com um bom dia. Bora trabalhar.", autor: "Provérbio comercial" },
  { frase: "Quem vende sonhos precisa acordar cedo pra realizá-los.", autor: "Provérbio comercial" },
  { frase: "Cliente satisfeito é a melhor propaganda que existe.", autor: "Provérbio comercial" },
  { frase: "Não venda um carro, venda uma solução.", autor: "Provérbio comercial" },
  { frase: "A vitória pertence ao mais perseverante.", autor: "Napoleão Bonaparte" },
  { frase: "As dificuldades preparam pessoas comuns para destinos extraordinários.", autor: "C.S. Lewis" },
  { frase: "É muito melhor arriscar coisas grandiosas, alcançar triunfos e glórias, mesmo expondo-se à derrota, do que formar fila com os pobres de espírito.", autor: "Theodore Roosevelt" },
  { frase: "Sonhe grande e não pare até chegar lá.", autor: "Provérbio popular" },
  { frase: "O que sabemos é uma gota; o que ignoramos é um oceano.", autor: "Isaac Newton" },
  { frase: "Tudo o que um sonho precisa para ser realizado é alguém que acredite que ele possa acontecer.", autor: "Roberto Shinyashiki" },
  { frase: "A coragem é a primeira das qualidades humanas porque garante todas as outras.", autor: "Winston Churchill" },
  { frase: "Não é sobre ter tempo, é sobre fazer tempo.", autor: "Provérbio popular" },
  { frase: "Nunca deixe que lhe digam que não pode fazer alguma coisa.", autor: "Will Smith" },
  { frase: "Toda conquista começa com a decisão de tentar.", autor: "Gail Devers" },
  { frase: "Ninguém constrói uma reputação com base no que vai fazer.", autor: "Henry Ford" },
  { frase: "Motivação é o que te faz começar. Hábito é o que te faz continuar.", autor: "Jim Ryun" },
  { frase: "O êxito é a soma de esforços correntemente repetidos.", autor: "Og Mandino" },
  { frase: "Quem tem um porquê pra viver pode suportar quase todos os comos.", autor: "Friedrich Nietzsche" },
  { frase: "Faça hoje o que os outros não querem, para ter amanhã o que os outros não têm.", autor: "Provérbio popular" },
  { frase: "Comece devagar, mas nunca pare.", autor: "Provérbio popular" },
  { frase: "Um vendedor de sucesso é antes de tudo um bom ouvinte.", autor: "Provérbio comercial" },
  { frase: "Segunda-feira é o primeiro dia do resto da sua semana. Comece bem.", autor: "Provérbio popular" },
  { frase: "A sorte favorece a mente preparada.", autor: "Louis Pasteur" },
  { frase: "Os grandes espíritos sempre encontraram violenta oposição de mentes medíocres.", autor: "Albert Einstein" },
  { frase: "É preciso força pra sonhar e perceber que a estrada vai além do que se vê.", autor: "Los Hermanos" },
  { frase: "A vida é feita de escolhas, e cada escolha molda o seu destino.", autor: "Provérbio popular" },
  { frase: "O que não te desafia não te transforma.", autor: "Fred DeVito" },
  { frase: "Comece cada dia com a certeza de que hoje é uma nova chance.", autor: "Provérbio popular" },
  { frase: "Trabalhe em silêncio, deixe o sucesso fazer barulho.", autor: "Frank Ocean" },
  { frase: "Ser feliz não significa que tudo é perfeito. Significa que você decidiu ver além dos problemas.", autor: "Provérbio popular" },
  { frase: "A gente não desiste quando erra, desiste quando cansa.", autor: "Provérbio popular" },
  { frase: "Tudo que um dia foi construído por mãos humanas pode ser reconstruído.", autor: "Ariano Suassuna" },
  { frase: "O tempo urge, os dias avançam, e o que temos a fazer, precisamos fazer bem feito.", autor: "Provérbio popular" },
  { frase: "Cada dia é uma nova oportunidade de recomeçar com mais sabedoria.", autor: "Provérbio popular" },
  { frase: "Não existe elevador para o sucesso, você tem que subir de escada mesmo.", autor: "Provérbio popular" },
  { frase: "Feito é melhor que perfeito.", autor: "Sheryl Sandberg" },
  { frase: "Faça o seu melhor nas condições que você tem, enquanto você não tem as condições que você quer ter.", autor: "Mário Sérgio Cortella" },
  { frase: "Levante, arrume-se, vá trabalhar. O universo recompensa quem age.", autor: "Provérbio popular" },
  { frase: "Onde há vontade, há um caminho.", autor: "Provérbio popular" },
  { frase: "Só se vive uma vez, mas se vivida corretamente, uma vez é suficiente.", autor: "Mae West" },
  { frase: "A melhor propaganda é o cliente satisfeito.", autor: "Philip Kotler" },
  { frase: "Quem não é visto, não é lembrado. Apareça, converse, venda.", autor: "Provérbio comercial" },
  { frase: "Todo grande negócio começou com um pequeno passo de coragem.", autor: "Provérbio comercial" },
  { frase: "Servir bem hoje é vender mais amanhã.", autor: "Provérbio comercial" },
  { frase: "Bom humor também é ferramenta de trabalho.", autor: "Provérbio popular" },
];

// Data no calendário de Brasília (evita virar o dia errado perto da meia-noite UTC)
function dataBRT(data: Date): { ano: number; diaDoAno: number } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(data);
  const ano = Number(partes.find(p => p.type === "year")!.value);
  const mes = Number(partes.find(p => p.type === "month")!.value);
  const dia = Number(partes.find(p => p.type === "day")!.value);
  const inicioAno = Date.UTC(ano, 0, 1);
  const hoje = Date.UTC(ano, mes - 1, dia);
  const diaDoAno = Math.round((hoje - inicioAno) / 86_400_000);
  return { ano, diaDoAno };
}

/** Frase do dia — 1 por dia do ano (calendário BRT), cicla sem repetir até dar a volta na lista. */
export function fraseDoDia(data: Date = new Date()): FraseDoDia {
  const { diaDoAno } = dataBRT(data);
  return FRASES_MOTIVACIONAIS[diaDoAno % FRASES_MOTIVACIONAIS.length];
}

/** Chave de data BRT (YYYY-MM-DD) — usada pra saber se o "bom dia" já foi enviado hoje. */
export function chaveDataBRT(data: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(data);
}
