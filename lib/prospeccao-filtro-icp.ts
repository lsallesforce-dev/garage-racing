// lib/prospeccao-filtro-icp.ts
// =============================================================================
// AutoZap — Quem NÃO é cliente, e por isso não entra na base de prospecção
// =============================================================================
// A busca do Google Maps por "revenda de carros" traz junto locadora, oficina,
// autopeças, desmanche, feirão e concessionária de marca. Todos passam pelo
// scoring — que mede tamanho (avaliações, fotos) — e alguns passam MELHOR que o
// alvo real, porque rede nacional tem mais avaliação que multimarcas de bairro.
//
// Caso que motivou o arquivo: 25/08, o primeiro contato da leva de Bauru foi a
// "Movida Aluguel de Carros", com score 75 — o maior da base inteira. Locadora
// nacional não compra AutoZap. Respondeu com robô e queimou o contato.
//
// A categoria do Google NÃO serve de filtro sozinha: ela chama de
// "Concessionária" metade das multimarcas de bairro ("Fabinho Automóveis",
// "Pioneiro Multimarcas"). Por isso a decisão olha o NOME, que é o que o próprio
// lojista escreveu, e usa a categoria só como reforço.
// =============================================================================

// Declara venda de carro no próprio nome. Vence qualquer outro sinal, menos os
// que são exclusão por natureza (locadora e concessionária de marca também
// vendem carro — por isso a checagem delas vem ANTES deste salvo-conduto? Não:
// vem depois, e é de propósito. Locadora nacional não escreve "compra e venda"
// no nome; multimarcas de bairro escreve o tempo todo.)
const VENDE_CARRO = /compra\s*(?:e|\/|&)\s*venda|venda\s*(?:e|\/|&)\s*compra/i;

/** Motivo pelo qual o contato foi barrado. Vai pra `notas`, pra dar auditoria. */
export type MotivoForaDoICP = "locadora" | "concessionaria_de_marca" | "nao_e_revenda" | "feirao";

// Fronteira com (?<!\p{L}) … (?!\p{L}) e flag u, nunca \b — o \b do JS é ASCII e
// quebra em acento ("autopeças", "mecânica"). Mesma armadilha do "robô".
const B = (corpo: string) => new RegExp(`(?<!\\p{L})(?:${corpo})(?!\\p{L})`, "iu");

// ─── Locadora ─────────────────────────────────────────────────────────────────
// As redes vendem a frota usada ("Localiza Seminovos", "Seminovos Movida") e por
// isso caem na busca por seminovos. Não são clientes: têm sistema próprio.
const LOCADORA = [
  B("localiza|movida|unidas|foco alugu[ée]l|rent\\s*a\\s*car"),
  B("alugu[ée]l\\s+de\\s+(?:carros?|ve[íi]culos?|autom[óo]veis)"),
  B("loca[çc][ãa]o\\s+de\\s+(?:carros?|ve[íi]culos?|frotas?)"),
];

// ─── Concessionária de marca ──────────────────────────────────────────────────
// Só entra quando a MARCA aparece no nome da loja. Multimarcas não põe marca no
// nome; concessionária põe sempre, por exigência da montadora.
// ⚠️ Só MARCA, nunca MODELO: "Onix Veículos em Bauru" é multimarcas batizada com
// nome de modelo, e barrar por "Onix" tiraria um cliente de verdade.
const MARCAS = [
  "chevrolet", "fiat", "toyota", "honda", "volkswagen", "hyundai", "renault",
  "nissan", "ford", "peugeot", "citro[ëe]n", "byd", "jetour", "caoa", "chery",
  "gwm", "haval", "mitsubishi", "kia", "audi", "bmw", "mercedes", "volvo",
  "land\\s*rover", "suzuki", "ram", "jaguar", "porsche", "iveco", "scania",
];
const MARCA_NO_NOME = B(MARCAS.join("|"));
// Se o nome também diz multimarcas/seminovos, é revenda que citou a marca —
// mantém. Concessionária não se anuncia como multimarcas.
const SE_DIZ_MULTIMARCA = B("multimarcas?|seminovos?|semi\\s*novos?");

// ─── Nem vende carro ──────────────────────────────────────────────────────────
const NAO_E_REVENDA = [
  B("autope[çc]as|pe[çc]as\\s+automotivas?|desmanche|desmonte|sucata|ferro\\s*velho"),
  B("oficina|mec[âa]nica|funilaria|pintura|retifica|borracharia|lava\\s*-?\\s*r[áa]pido|est[ée]tica\\s+automotiva"),
  B("guincho|reboque|despachante|seguros?|financeira|consórcio|cons[óo]rcio"),
  B("estacionamento|lava\\s*jato"),
];

// ─── Feirão / shopping de carros ──────────────────────────────────────────────
// Pátio coletivo com vários vendedores: não tem estoque próprio pra gerir.
const FEIRAO = [
  B("feir[ãa]o|feira\\s+d[eo]\\s+autom[óo]vel|feira\\s+de\\s+autom[óo]veis"),
  B("shopping\\s+(?:de\\s+)?(?:carros?|autos?|ve[íi]culos?)|autofest|auto\\s*shopping"),
];

/**
 * Diz se o contato coletado está fora do perfil de cliente do AutoZap.
 * Retorna o motivo, ou null quando é revenda de verdade.
 */
export function foraDoICP(
  nomeEmpresa: string | null,
  categoria?: string | null,
): MotivoForaDoICP | null {
  const nome = (nomeEmpresa || "").trim();
  if (!nome) return null;
  const cat = (categoria || "").trim();

  // Salvo-conduto: quem escreve "compra e venda" no nome vende carro, ponto —
  // mesmo que o nome carregue outra atividade junto. Caso real: "Carneiro
  // Estacionamento de Veículos - Compra e Venda" era barrado por
  // "estacionamento", e é exatamente o pequeno lote que a gente quer.
  if (VENDE_CARRO.test(nome)) return null;

  if (LOCADORA.some((re) => re.test(nome))) return "locadora";
  // A categoria pega a locadora que não diz isso no nome ("Agência de aluguel").
  if (/alugu[ée]l|loca[çc][ãa]o|rent/i.test(cat)) return "locadora";

  if (NAO_E_REVENDA.some((re) => re.test(nome))) return "nao_e_revenda";
  if (/autope[çc]as|pe[çc]as|oficina|mec[âa]nica|desmanche|sucata|lava/i.test(cat)) {
    return "nao_e_revenda";
  }

  if (FEIRAO.some((re) => re.test(nome))) return "feirao";

  if (MARCA_NO_NOME.test(nome) && !SE_DIZ_MULTIMARCA.test(nome)) {
    return "concessionaria_de_marca";
  }

  return null;
}

/** Texto curto pra `notas`, pra dar pra auditar depois por que saiu. */
export function descreverMotivo(m: MotivoForaDoICP): string {
  switch (m) {
    case "locadora": return "Locadora de veículos — tem sistema próprio, não é cliente.";
    case "concessionaria_de_marca": return "Concessionária de marca — usa o DMS da montadora.";
    case "nao_e_revenda": return "Não é revenda (oficina, autopeças, desmanche ou serviço).";
    case "feirao": return "Feirão/shopping de carros — pátio coletivo, sem estoque próprio.";
  }
}
