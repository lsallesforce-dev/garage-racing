// Shot list da captura guiada do Kit de Postagem (marketing F1).
// Isomórfico — sem imports de servidor. Usado pelo componente de captura
// (client) e pelas rotas de marketing (server).

export type ShotTipo = "foto" | "take";
export type ShotBloco = "exterior" | "interior" | "traseira" | "mecanica";

export interface ShotItem {
  tag: string;
  label: string;
  dica: string;
  tipo: ShotTipo;
  obrigatoria: boolean;
  // Campos abaixo só existem nos takes. Opcionais de propósito: obrigatórios
  // quebrariam as literais de SHOT_FOTOS.
  bloco?: ShotBloco;
  segundos?: number;   // duração alvo do clipe no reel (substitui o DEFAULT_SEG chapado)
  refInicio?: number;  // trecho correspondente no vídeo modelo (Takes padrão)
  refFim?: number;
  /** Fora do classificador automático: o que define o slot é COMO a foto foi
   *  tirada (enquadramento/orientação), não o que ela mostra — o Gemini Vision
   *  olha o conteúdo e preencheria com a foto errada. */
  soManual?: boolean;
}

// Bumpar quando a lista de takes mudar de forma que invalide decupagem já feita.
export const SHOTLIST_VERSAO = 2;
// Prefixo versionado dos clipes de referência no R2 (o proxy manda cache immutable,
// então trocar o vídeo modelo exige subir um prefixo novo, não sobrescrever).
export const REF_VERSAO = "v1";

// Mapa de tag legada → tag atual. Vazio hoje: a v2 só ADICIONOU tags, não renomeou
// nenhuma (renomear embaralharia a narrativa em silêncio — o indexOf da ordenação
// devolve -1 e joga o take pro início do array). É o hook pra quando precisar.
export const TAKE_ALIAS: Record<string, string> = {};

export function normalizarTag(tag: string): string {
  return TAKE_ALIAS[tag] ?? tag;
}

export function refClipUrl(tag: string): string {
  return `/api/r2/referencia/takes/${REF_VERSAO}/${tag}.mp4`;
}
export function refCompletoUrl(): string {
  return `/api/r2/referencia/takes/${REF_VERSAO}/completo.mp4`;
}
export function refPosterUrl(tag: string): string {
  return `/ref/${tag}.jpg`;
}

// Fotos: a "frente-3-4" é a capa do carrossel (vira fundo da capa templatada).
export const SHOT_FOTOS: ShotItem[] = [
  { tag: "frente-3-4",  label: "Frente 3/4",   dica: "De frente, levemente de lado. Carro inteiro no quadro, sem cortar rodas.", tipo: "foto", obrigatoria: true },
  { tag: "frente-vertical", label: "Frente (story)", dica: "A MESMA frente, mas com o celular EM PÉ. É essa que vira o story e a capa do reel — sem ela, a foto deitada sobra tarja no 9:16.", tipo: "foto", obrigatoria: false, soManual: true },
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
//
// A ORDEM e os campos ref* saem da decupagem frame a frame do vídeo modelo
// ("Takes padrão.mp4" — Tucson, 9:16, 57,73s de conteúdo). É essa sequência que o
// vendedor vê no grid e é essa que o reel monta. Não renomear tag existente:
// as tags são chave de dados em veiculos.marketing_capturas.takes[].tag.
export const SHOT_TAKES: ShotItem[] = [
  { tag: "walk-in-frontal",     label: "Aproximação frontal",  dica: "Comece a ~5 passos e ande devagar em direção à frente do carro.",  tipo: "take", obrigatoria: true,  bloco: "exterior", segundos: 3.0, refInicio: 0.0,  refFim: 3.0 },
  { tag: "pan-lateral",         label: "Passada lateral",      dica: "Da frente 3/4 até o perfil, caminhando devagar ao lado do carro.", tipo: "take", obrigatoria: true,  bloco: "exterior", segundos: 2.2, refInicio: 3.0,  refFim: 5.2 },
  { tag: "farol-detalhe",       label: "Farol / para-choque",  dica: "Close no farol ou no farol de neblina, aproximando devagar.",      tipo: "take", obrigatoria: false, bloco: "exterior", segundos: 1.2, refInicio: 5.2,  refFim: 6.4 },
  { tag: "detalhe-roda",        label: "Roda dianteira",       dica: "Close na roda dianteira, de leve diagonal.",                       tipo: "take", obrigatoria: false, bloco: "exterior", segundos: 1.0, refInicio: 6.4,  refFim: 7.4 },
  { tag: "interior",            label: "Interior (porta → painel)", dica: "Porta aberta: entre com a câmera até enquadrar o painel.",    tipo: "take", obrigatoria: true,  bloco: "interior", segundos: 3.0, refInicio: 7.4,  refFim: 11.0 },
  { tag: "painel-digital",      label: "Volante e painel",     dica: "Close no volante com o painel de instrumentos atrás.",             tipo: "take", obrigatoria: false, bloco: "interior", segundos: 1.2, refInicio: 11.0, refFim: 12.2 },
  { tag: "multimidia",          label: "Multimídia",           dica: "Central ligada mostrando a tela; toque em algo pra dar vida.",     tipo: "take", obrigatoria: false, bloco: "interior", segundos: 2.2, refInicio: 12.2, refFim: 15.2 },
  { tag: "cambio",              label: "Câmbio",               dica: "Close na alavanca de câmbio e no console.",                        tipo: "take", obrigatoria: false, bloco: "interior", segundos: 1.0, refInicio: 15.2, refFim: 16.2 },
  { tag: "bancos-take",         label: "Bancos dianteiros",    dica: "Da porta aberta, passe devagar pelos dois bancos da frente.",      tipo: "take", obrigatoria: true,  bloco: "interior", segundos: 2.5, refInicio: 16.2, refFim: 23.0 },
  { tag: "banco-traseiro",      label: "Banco traseiro",       dica: "Porta de trás aberta, mostre o banco e o espaço pras pernas.",     tipo: "take", obrigatoria: false, bloco: "interior", segundos: 2.5, refInicio: 23.0, refFim: 31.8 },
  { tag: "traseira",            label: "Traseira",             dica: "Contorne a traseira devagar, de uma lanterna à outra.",            tipo: "take", obrigatoria: true,  bloco: "traseira", segundos: 2.5, refInicio: 31.8, refFim: 37.5 },
  { tag: "porta-malas-take",    label: "Porta-malas",          dica: "Abra o porta-malas devagar e mostre o espaço por dentro.",         tipo: "take", obrigatoria: false, bloco: "traseira", segundos: 3.0, refInicio: 37.5, refFim: 43.0 },
  { tag: "pan-lateral-traseira",label: "Passada lateral traseira", dica: "Câmera baixa, passando da lanterna até a roda de trás.",       tipo: "take", obrigatoria: false, bloco: "traseira", segundos: 2.2, refInicio: 43.0, refFim: 48.0 },
  { tag: "motor-take",          label: "Motor",                dica: "Capô aberto, entre com a câmera mostrando o motor.",               tipo: "take", obrigatoria: false, bloco: "mecanica", segundos: 2.2, refInicio: 48.0, refFim: 52.0 },
  { tag: "assinatura",          label: "Assinatura",           dica: "O melhor ângulo do carro, movimento lento. Vira o encerramento.",  tipo: "take", obrigatoria: true,  bloco: "mecanica", segundos: 2.8, refInicio: 52.0, refFim: 55.5 },
];

// Ordem e rótulo dos blocos no grid (agrupa os 15 slots em 4 seções).
export const SHOT_BLOCOS: { bloco: ShotBloco; label: string }[] = [
  { bloco: "exterior", label: "Por fora" },
  { bloco: "interior", label: "Por dentro" },
  { bloco: "traseira", label: "Traseira e porta-malas" },
  { bloco: "mecanica", label: "Motor e fechamento" },
];

// Duração alvo do clipe no reel. Fallback pro antigo DEFAULT_SEG quando a tag
// não é conhecida (take legado sem etiqueta).
export const TAKE_SEGUNDOS_PADRAO = 2.2;
export function segundosDoTake(tag: string | null | undefined): number {
  if (!tag) return TAKE_SEGUNDOS_PADRAO;
  const s = SHOT_TAKES.find((t) => t.tag === normalizarTag(tag));
  return s?.segundos ?? TAKE_SEGUNDOS_PADRAO;
}

export const SHOT_LIST: ShotItem[] = [...SHOT_FOTOS, ...SHOT_TAKES];

// origem: "manual" = vendedor subiu no slot; "auto" = veio da decupagem de um
// vídeo único; "classificado" = foto etiquetada pelo Gemini Vision.
export type CapturaOrigem = "manual" | "auto" | "classificado";
export interface CapturaRegistro { tag: string; url: string; origem?: CapturaOrigem }

// Restauro de piso/calçada: guarda o par original→restaurada pra o antes/depois
// e pra reversão. `aplicada` = a restaurada tomou o lugar da original em fotos[].
// Mora aqui dentro (jsonb já existente) de propósito: coluna nova exigiria
// migration, e migration não aplicada é modo de falha conhecido do projeto.
export interface PisoRegistro { original: string; restaurada: string; aplicada?: boolean }

export interface MarketingCapturas {
  fotos?: CapturaRegistro[];
  takes?: CapturaRegistro[];
  piso?: PisoRegistro[];
}

export const TAG_FOTO_CAPA = "frente-3-4";
export const TAG_FOTO_VERTICAL = "frente-vertical";

// Qual foto vira o fundo de cada formato.
//
// Feed é 4:5 e story/reel são 9:16. Uma foto deitada no 9:16 ou corta a frente e
// a traseira do carro, ou entra inteira sobrando tarja escura em cima e embaixo
// (é o que o cover×contain de renderCapa/Intro faz hoje). A foto tirada com o
// celular em pé resolve — quando existir.
export function fotoDoFormato(
  capturas: MarketingCapturas | null | undefined,
  galeria: string[] | null | undefined,
  formato: "feed" | "story",
): string | null {
  const etiquetada = (tag: string) => capturas?.fotos?.find((f) => f.tag === tag)?.url ?? null;
  const vertical = formato === "story" ? etiquetada(TAG_FOTO_VERTICAL) : null;
  return vertical ?? etiquetada(TAG_FOTO_CAPA) ?? galeria?.[0] ?? null;
}

// Ordena os takes gravados na ordem narrativa da shot list. Tag desconhecida vai
// pro FIM (o indexOf cru devolve -1 e jogaria pro início, embaralhando em silêncio).
export function ordenarTakes<T extends { tag?: string | null }>(takes: T[]): T[] {
  const ordem = SHOT_TAKES.map((s) => s.tag);
  const pos = (t: T) => {
    const i = ordem.indexOf(normalizarTag(t.tag ?? ""));
    return i < 0 ? ordem.length : i;
  };
  return [...takes].sort((a, b) => pos(a) - pos(b));
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
