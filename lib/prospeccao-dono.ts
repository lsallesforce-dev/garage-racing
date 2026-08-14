// lib/prospeccao-dono.ts
// =============================================================================
// Descoberta do DONO da revenda a partir de fontes públicas
// =============================================================================
// Por que isso existe: em junho abordamos 39 revendas e 12 das 21 "respostas"
// eram a AUTORESPOSTA do robô da própria loja; uma delas respondeu "Que modelo
// vc se interessou?" — ou seja, leram a Mari como CLIENTE. O telefone que o
// Google Maps entrega é a LINHA DE VENDAS, atendida por balconista ou bot cujo
// trabalho é vender carro, não comprar software. O dono nunca viu a mensagem.
//
// Não dá pra achar o CELULAR pessoal do dono em fonte pública — e caçar isso
// seria invasivo. O que dá, e resolve o problema, é o NOME dele: com o nome,
// a abordagem deixa de ser pitch pra balconista e vira o pedido mais banal do
// mundo — "o Fabiano está?" — que qualquer atendente roteia sem pensar.
//
// Duas fontes públicas, em ordem de confiança:
//   1. REVIEWS do Google — cliente escreve "fui atendido pelo Fabiano, dono".
//      É a melhor fonte: diz quem de fato toca a loja, não quem está no papel.
//   2. NOME DA LOJA — "Fabiano Veículos", "André Moi Veículos". Só vale quando
//      o primeiro token é um nome de pessoa DE VERDADE; senão "Berlim Motors"
//      e "Astra Veículos" viram "o Berlim está?" e queimam a abordagem.
// =============================================================================

export type DonoFonte = "review" | "nome_loja";

export interface DonoEncontrado {
  nome: string;
  fonte: DonoFonte;
  /** 0–100. Abaixo de CONFIANCA_MINIMA_DONO a abertura NÃO deve usar o nome. */
  confianca: number;
  /** Quantas vezes o nome apareceu nos reviews (só na fonte "review"). */
  mencoes?: number;
}

// ─── Nomes próprios brasileiros comuns em dono de revenda ─────────────────────
// Lista curada, não exaustiva de propósito: é melhor deixar de achar um dono
// (a abertura cai no fallback sem nome) do que chamar o cara de "Berlim".
// Inclui apelidos, que em revenda pequena são o nome real do negócio
// ("Fabinho", "Jorjão", "Tonico", "Nelsinho").
const NOMES_PROPRIOS = new Set([
  "adailton","adalberto","ademir","adilson","adriano","affonso","agnaldo","alan","alberto","alcides",
  "alex","alexandre","alfredo","aloisio","altair","alvaro","amauri","anderson","andre","andres",
  "anselmo","antonio","ari","ariel","arlindo","armando","arnaldo","arthur","artur","augusto",
  "aurelio","bento","bernardo","betinho","beto","bruno","caio","carlinhos","carlos","cassio",
  "cesar","charles","cicero","claudemir","claudio","cleber","cleison","cleiton","clovis","cristiano",
  "daniel","danilo","dario","davi","david","denis","denilson","dermival","diego","dilson",
  "dinho","diogo","dirceu","djalma","domingos","donizete","donizeti","douglas","edson","eduardo",
  "edvaldo","elias","elton","emerson","enio","erasmo","eric","erick","ernesto","evandro",
  "everton","ezequiel","fabiano","fabinho","fabio","fabricio","felipe","fernando","flavio","francisco",
  "gabriel","genivaldo","geraldo","gerson","gilberto","gilmar","gilson","giovani","giovanni","gustavo",
  "haroldo","heitor","helio","henrique","hermes","hugo","humberto","igor","ilton","irineu",
  "isaias","ismael","israel","itamar","ivan","ivo","jacir","jackson","jaime","jair",
  "jamil","janio","jean","jefferson","jeferson","jesus","joao","joaquim","joel","jonas",
  "jonathan","jorge","jorjao","jose","josias","jovino","juarez","juliano","julio","junior",
  "juninho","kleber","laercio","lauro","lazaro","leandro","leonardo","leonel","levi","lincoln",
  "lourival","lucas","luciano","lucio","luis","luiz","luizinho","manoel","manuel","marcelo",
  "marcio","marco","marcos","marcus","mariano","mario","matheus","mauricio","mauro","maycon",
  "messias","michel","miguel","milton","moacir","moises","murilo","natal","nelson","nelsinho",
  "neto","nicolau","nilson","nilton","nivaldo","noel","norberto","odair","olavo","orlando",
  "osmar","osvaldo","oswaldo","otavio","pablo","paulo","paulinho","pedro","peterson","rafael",
  "raimundo","ramon","raul","regis","reinaldo","renan","renato","ricardo","richard","rivaldo",
  "robson","rodolfo","rodrigo","rogerio","romario","romeu","ronaldo","roni","rubens","rui",
  "samuel","sandro","saulo","sebastiao","selmo","sergio","severino","sidnei","sidney","silvio",
  "simao","sinval","tadeu","tarcisio","thiago","tiago","tonico","toninho","ubirajara","valdir",
  "valter","vanderlei","vagner","wagner","valdemar","vicente","victor","vitor","vinicius","wallace",
  "walter","wanderley","washington","welington","wellington","wesley","willian","william","wilson","zeca",
  // femininos — revenda com dona é comum e a lista não pode ser só masculina
  "adriana","alessandra","aline","amanda","ana","andrea","angela","aparecida","beatriz","bianca",
  "camila","carla","carol","carolina","cassia","cintia","claudia","cristiane","cristina","daniela",
  "debora","denise","edna","elaine","eliana","elisa","fabiana","fernanda","flavia","gabriela",
  "gisele","helena","ingrid","isabel","jaqueline","joana","juliana","karina","katia","larissa",
  "leticia","livia","luana","lucia","luciana","marcia","maria","mariana","marilia","marta",
  "michele","monica","natalia","patricia","paula","priscila","raquel","regina","renata","rita",
  "roberta","rosana","rosangela","sandra","sheila","silvia","simone","solange","sonia","tatiana",
  "tania","teresa","thais","vanessa","vera","viviane","zilda",
]);

/** Remove acentos e baixa a caixa — a lista de nomes é toda sem acento. */
function normalizar(s: string): string {
  // Remove as marcas de acento que o NFD separa da letra base. Escape
  // unicode de proposito: o caractere literal aqui e invisivel no editor.
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** É um nome de pessoa conhecido? (token já normalizado) */
function ehNomeProprio(token: string): boolean {
  return NOMES_PROPRIOS.has(token);
}

/** Devolve o nome com a caixa apresentável ("FABIANO" / "fabiano" → "Fabiano"). */
function capitalizar(nome: string): string {
  return nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase();
}

// ─── Fonte 1: reviews do Google ───────────────────────────────────────────────
// Padrões reais de review de revenda, do mais forte pro mais fraco. O grupo de
// captura 1 é sempre o nome.
// ATENÇÃO: nada de flag `i` aqui. O nome PRECISA vir capitalizado ([A-ZÀ-Ý]…)
// — é o que separa "o Marcelo" (pessoa) de "o marcelo" (não acontece) e evita
// casar lixo no meio da frase. Como o conector pode abrir a frase em maiúscula
// ("O Marcelo…", "Obrigado Junior!"), cada conector traz as duas caixas na mão.
const PADROES_REVIEW: { re: RegExp; peso: number }[] = [
  // "o Fabiano, dono da loja" / "Fabiano (proprietário)" — cita o cargo: ouro.
  { re: /\b([A-ZÀ-Ý][a-zà-ÿ]{2,})\s*,?\s*(?:\(|—|-)?\s*(?:[Oo]\s+)?(?:[Dd]ono|[Pp]ropriet[áa]ri[oa]|[Pp]atr[ãa]o)\b/g, peso: 60 },
  { re: /\b(?:[Dd]ono|[Pp]ropriet[áa]ri[oa])\s*(?:da\s+loja)?\s*,?\s*(?:[OoAa]\s+|[Ss]r\.?\s*|[Ss]ra\.?\s*)?([A-ZÀ-Ý][a-zà-ÿ]{2,})/g, peso: 60 },
  // "fui atendido pelo Fabiano" / "atendida pela Carla" — quem toca a loja.
  { re: /\b[Aa]tendid[oa]\s+(?:muito bem\s+)?(?:pelo|pela|por)\s+(?:[Ss]r[a]?\.?\s*)?([A-ZÀ-Ý][a-zà-ÿ]{2,})/g, peso: 30 },
  // "atendimento do Vitor" / "atendimento da Carla"
  { re: /\b[Aa]tendimento\s+(?:d[oa]|com\s+[oa])\s+([A-ZÀ-Ý][a-zà-ÿ]{2,})/g, peso: 30 },
  // "…com o Marcelo" — o que vem antes varia demais ("Comprei meu carro com o
  // Marcelo") pra listar verbo por verbo; ancora no "com o/a" + nome conhecido.
  { re: /\bcom\s+[oa]\s+([A-ZÀ-Ý][a-zà-ÿ]{2,})/g, peso: 28 },
  // "o Fabiano me atendeu" — e também sem artigo ("Vitor vendeu certinho"),
  // que é como metade dos reviews escreve.
  { re: /\b(?:[OoAa]\s+)?([A-ZÀ-Ý][a-zà-ÿ]{2,})\s+(?:me\s+|nos\s+)?(?:atendeu|vendeu|explicou|resolveu|ajudou|indicou)/g, peso: 25 },
  // "obrigado Fabiano" / "recomendo o Fabiano" / "parabéns Fabiano"
  { re: /\b(?:[Oo]brigad[oa]|[Rr]ecomendo|[Pp]arab[ée]ns|[Vv]aleu)\s*,?\s*(?:ao?\s+)?([A-ZÀ-Ý][a-zà-ÿ]{2,})/g, peso: 20 },
];

/**
 * Varre os textos de review e devolve o nome de pessoa mais citado, com peso.
 * Só considera token que está na lista de nomes próprios — review tem muita
 * palavra capitalizada que não é nome ("Loja", "Excelente", "Recomendo").
 */
export function nomeDonoPorReviews(textos: string[]): DonoEncontrado | null {
  if (!Array.isArray(textos) || textos.length === 0) return null;

  const pontos = new Map<string, number>();
  const mencoes = new Map<string, number>();

  for (const texto of textos) {
    if (typeof texto !== "string" || !texto.trim()) continue;
    for (const { re, peso } of PADROES_REVIEW) {
      // `re` é global e stateful entre chamadas — zera antes de cada texto.
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(texto)) !== null) {
        const bruto = normalizar(m[1] ?? "");
        if (!ehNomeProprio(bruto)) continue;
        pontos.set(bruto, (pontos.get(bruto) ?? 0) + peso);
        mencoes.set(bruto, (mencoes.get(bruto) ?? 0) + 1);
      }
    }
  }

  if (pontos.size === 0) return null;

  const [nome, soma] = [...pontos.entries()].sort((a, b) => b[1] - a[1])[0];

  // Confiança = soma dos pesos, que já embute a repetição (cada menção soma de
  // novo). Uma citação solta de "com o Marcelo" fica em 28 e NÃO passa do corte
  // — pode ser o vendedor que já saiu da loja. Três menções, ou uma que diz
  // "dono", passam. Teto 95: fonte pública nunca é certeza.
  const confianca = Math.min(95, soma);

  return { nome: capitalizar(nome), fonte: "review", confianca, mencoes: mencoes.get(nome) ?? 1 };
}

/**
 * Nome do dono deduzido do nome da loja ("Fabiano Veículos" → Fabiano).
 * Só dispara quando o primeiro token é nome de pessoa conhecido — é o que
 * separa "Fabiano Veículos" de "Berlim Motors" e "Astra Veículos".
 */
export function nomeDonoPorNomeLoja(nomeEmpresa: string | null): DonoEncontrado | null {
  const bruto = (nomeEmpresa || "").trim();
  if (!bruto) return null;

  // "Garagem do Nelsinho" / "Veículos do Zeca": o nome vem depois do "do/da".
  const posse = bruto.match(/\b(?:do|da|de)\s+([A-Za-zÀ-ÿ]{3,})\b/);
  if (posse) {
    const tok = normalizar(posse[1]);
    if (ehNomeProprio(tok)) return { nome: capitalizar(tok), fonte: "nome_loja", confianca: 70 };
  }

  const primeiro = normalizar(bruto.split(/[\s|\-–—]+/)[0].replace(/[^\p{L}]/gu, ""));
  if (primeiro.length >= 3 && ehNomeProprio(primeiro)) {
    return { nome: capitalizar(primeiro), fonte: "nome_loja", confianca: 65 };
  }

  return null;
}

/**
 * Melhor palpite do dono, combinando as fontes. Review ganha do nome da loja
 * quando tem confiança comparável: o nome da loja pode ser do fundador que
 * morreu ou vendeu o ponto; o review é de quem está no balcão AGORA.
 */
export function descobrirDono(
  nomeEmpresa: string | null,
  textosReviews: string[],
): DonoEncontrado | null {
  const porReview = nomeDonoPorReviews(textosReviews);
  const porNome = nomeDonoPorNomeLoja(nomeEmpresa);

  if (porReview && porNome) {
    // As duas fontes concordam → é ele, sem dúvida.
    if (normalizar(porReview.nome) === normalizar(porNome.nome)) {
      return { ...porReview, confianca: 100 };
    }
    return porReview.confianca >= porNome.confianca ? porReview : porNome;
  }

  return porReview ?? porNome;
}

/** Confiança mínima pra Mari citar o nome na abordagem. */
export const CONFIANCA_MINIMA_DONO = 60;
