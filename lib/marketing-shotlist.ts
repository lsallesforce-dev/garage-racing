// Shot list da captura guiada do Kit de Postagem (marketing F1).
// Isomórfico — sem imports de servidor. Usado pelo componente de captura
// (client) e pelas rotas de marketing (server).

export type ShotTipo = "foto" | "take";

export interface ShotItem {
  tag: string;
  label: string;
  dica: string;
  tipo: ShotTipo;
  obrigatoria: boolean;
}

// Fotos: a "frente-3-4" é a capa do carrossel (vira fundo da capa templatada).
export const SHOT_FOTOS: ShotItem[] = [
  { tag: "frente-3-4",  label: "Frente 3/4",   dica: "De frente, levemente de lado. Carro inteiro no quadro, sem cortar rodas.", tipo: "foto", obrigatoria: true },
  { tag: "lateral",     label: "Lateral",      dica: "Perfil completo do carro, câmera na altura da maçaneta.",                   tipo: "foto", obrigatoria: true },
  { tag: "traseira-3-4",label: "Traseira 3/4", dica: "De trás, levemente de lado — mesmo ângulo da frente, invertido.",           tipo: "foto", obrigatoria: true },
  { tag: "painel",      label: "Painel",       dica: "Do banco de trás, volante e central de mídia ligada.",                      tipo: "foto", obrigatoria: true },
  { tag: "bancos",      label: "Bancos",       dica: "Porta aberta, banco dianteiro inteiro. Interior limpo.",                    tipo: "foto", obrigatoria: true },
  { tag: "porta-malas", label: "Porta-malas",  dica: "Aberto, mostrando o espaço. Tampa fora do quadro se possível.",             tipo: "foto", obrigatoria: false },
  { tag: "roda",        label: "Roda",         dica: "Uma roda dianteira em close, de leve diagonal.",                            tipo: "foto", obrigatoria: false },
  { tag: "motor",       label: "Motor",        dica: "Capô aberto, motor centralizado, boa luz.",                                 tipo: "foto", obrigatoria: false },
];

// Takes: 5–10s cada, celular na VERTICAL, movimento LENTO e contínuo.
// Alimentam o reel automatizado (F2), mas já são coletados etiquetados no F1.
export const SHOT_TAKES: ShotItem[] = [
  { tag: "walk-in-frontal", label: "Aproximação frontal", dica: "Comece a ~5 passos e ande devagar em direção à frente do carro.", tipo: "take", obrigatoria: true },
  { tag: "pan-lateral",     label: "Passada lateral",     dica: "Caminhe ao longo da lateral, câmera estável apontada pro carro.",  tipo: "take", obrigatoria: true },
  { tag: "traseira",        label: "Traseira",            dica: "Contorne a traseira devagar, de um farol ao outro.",               tipo: "take", obrigatoria: true },
  { tag: "interior",        label: "Interior",            dica: "Da porta aberta: painel → central → bancos, movimento lento.",     tipo: "take", obrigatoria: true },
  { tag: "detalhe-roda",    label: "Detalhe da roda",     dica: "Close na roda subindo até o retrovisor.",                          tipo: "take", obrigatoria: false },
  { tag: "multimidia",      label: "Multimídia",          dica: "Central ligada mostrando a tela; toque em algo pra dar vida.",     tipo: "take", obrigatoria: false },
  { tag: "painel-digital",  label: "Painel",              dica: "Painel de instrumentos ligado, do banco do motorista.",           tipo: "take", obrigatoria: false },
  { tag: "porta-malas-take",label: "Porta-malas",         dica: "Abrindo o porta-malas devagar, mostrando o espaço.",               tipo: "take", obrigatoria: false },
  { tag: "farol-detalhe",   label: "Faróis",              dica: "Close no farol de LED / detalhe da frente.",                       tipo: "take", obrigatoria: false },
  { tag: "assinatura",      label: "Assinatura",          dica: "O melhor ângulo do carro, parado 5s. Vira o encerramento.",        tipo: "take", obrigatoria: false },
];

export const SHOT_LIST: ShotItem[] = [...SHOT_FOTOS, ...SHOT_TAKES];

export interface CapturaRegistro { tag: string; url: string }
export interface MarketingCapturas {
  fotos?: CapturaRegistro[];
  takes?: CapturaRegistro[];
}

// Ordem narrativa do carrossel de feed (slide 1 é a capa templatada; a
// frente-3-4 crua fica de fora — ela já é o fundo da capa). Máx 10 slides (IG).
export const CARROSSEL_ORDEM = [
  "lateral",
  "traseira-3-4",
  "painel",
  "bancos",
  "porta-malas",
  "roda",
  "motor",
];
export const CARROSSEL_MAX = 10;

export function montarCarrossel(
  capaUrl: string,
  capturas: MarketingCapturas,
  galeria: string[] | null | undefined
): string[] {
  const slides: string[] = [capaUrl];
  const usadas = new Set<string>([capturas.fotos?.find((f) => f.tag === "frente-3-4")?.url ?? ""]);
  for (const tag of CARROSSEL_ORDEM) {
    const url = capturas.fotos?.find((f) => f.tag === tag)?.url;
    if (url && !usadas.has(url)) {
      slides.push(url);
      usadas.add(url);
    }
  }
  for (const url of galeria ?? []) {
    if (slides.length >= CARROSSEL_MAX) break;
    if (!usadas.has(url)) {
      slides.push(url);
      usadas.add(url);
    }
  }
  return slides.slice(0, CARROSSEL_MAX);
}
