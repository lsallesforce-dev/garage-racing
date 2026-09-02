// Render da capa do Kit de Postagem (1080x1350, next/og ImageResponse + Montserrat local).
// Compartilhado entre /api/marketing/pacote (produção) e /api/marketing/capa-dev (preview local).
// Layout DIVIDIDO: foto ocupa o topo inteirinha (nenhum texto por cima do carro) e o
// painel de informações fica sólido embaixo — evita "cortar" o carro atrás do texto.
// No F2 este layout vira a cena de intro do template Remotion — manter os tokens
// (cor primária, Montserrat Black, faixa + título + chips de specs) espelhados lá.

import { ImageResponse } from "next/og";
import { promises as fs } from "fs";
import path from "path";
import { linhaSpecs, precoFormatado, tituloVeiculo, type MarketingCfg } from "@/lib/marketing-kit";

// Formatos de saída: feed 4:5 (post/carrossel) e story 9:16 (Stories/status).
// FOTO_H = área exclusiva da foto; o restante é o painel de infos.
// No story, o painel ganha respiro extra embaixo (barra de resposta do IG).
export type CapaFormato = "feed" | "story";
// GRAD_TOPO/GRAD_BASE = altura das faixas pretas translúcidas sobre a foto
// (sombra do topo + transição foto→painel). Eram fixas (180/120) nos dois
// formatos; o story tem FOTO_H 43% maior, então a mesma faixa em px ficava
// proporcionalmente pequena e sumia visualmente — por isso "o feed tem o
// preto transparente e o story não" (achado 02/09). Escalar com FOTO_H.
const DIMS: Record<CapaFormato, { W: number; H: number; FOTO_H: number; PAD_BOTTOM: number; GRAD_TOPO: number; GRAD_BASE: number }> = {
  feed:  { W: 1080, H: 1350, FOTO_H: 860,  PAD_BOTTOM: 44,  GRAD_TOPO: 180, GRAD_BASE: 120 },
  story: { W: 1080, H: 1920, FOTO_H: 1230, PAD_BOTTOM: 150, GRAD_TOPO: 258, GRAD_BASE: 172 },
};

// Anti-SSRF: só baixamos imagens do nosso próprio storage (regra do CLAUDE.md).
export function isOwnStorage(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    const allowed = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.R2_PUBLIC_URL]
      .filter(Boolean)
      .map((u) => new URL(u!).hostname);
    return allowed.includes(h);
  } catch {
    return false;
  }
}

export async function toDataUri(url: string | null): Promise<string | null> {
  if (!url || !url.startsWith("https://") || !isOwnStorage(url)) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const mime = r.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.byteLength > 12 * 1024 * 1024) return null;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function loadCapaFont(): Promise<ArrayBuffer> {
  const f = await fs.readFile(path.join(process.cwd(), "public", "fonts", "Montserrat-Black.ttf"));
  return f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer;
}

// Foto da capa com dimensões (via sharp) — o render decide cover×contain por formato.
export interface FotoCapa { uri: string; w: number; h: number }

export async function fotoParaCapa(url: string | null): Promise<FotoCapa | null> {
  const uri = await toDataUri(url);
  if (!uri) return null;
  try {
    const sharp = (await import("sharp")).default;
    const buf = Buffer.from(uri.split(",")[1], "base64");
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return { uri, w: 4, h: 3 };
    return { uri, w: meta.width, h: meta.height };
  } catch {
    return { uri, w: 4, h: 3 };
  }
}

// Área da foto (topo da arte) — chassi compartilhado pela capa e pelos slides de
// opcionais do carrossel. Fica numa função só pra que os dois tenham EXATAMENTE
// o mesmo acabamento (fundo desfocado, gradientes, logo, selo); duplicar o JSX
// fazia a capa e os slides divergirem a cada ajuste.
function areaFoto(p: {
  foto: FotoCapa | null;
  logoUri: string | null;
  cfg: MarketingCfg;
  cor: string;
  mostraBranding: boolean;
  /** Brilho do fundo desfocado. A capa mantém 0.55 (valor original); o slide
   *  usa 0.45 — com painel de opcionais, fundo mais fundo dá mais contraste. */
  brilhoFundo?: number;
  W: number;
  FOTO_H: number;
  GRAD_TOPO: number;
  GRAD_BASE: number;
}) {
  const { foto, logoUri, cfg, cor, mostraBranding, W, FOTO_H, GRAD_TOPO, GRAD_BASE } = p;
  const brilhoFundo = p.brilhoFundo ?? 0.55;
  // cover × contain: corte VERTICAL (foto mais alta que a janela) é seguro — o viés
  // 62% come céu, não carro. Corte HORIZONTAL (foto deitada em janela alta, típico
  // no story) come a frente/traseira do carro: acima de 10%, mostra a foto inteira
  // (contain) sobre o fundo desfocado em vez de dar zoom.
  const windowAR = W / FOTO_H;
  const fotoAR = foto ? foto.w / foto.h : windowAR;
  const cortariaHorizontal = fotoAR > windowAR && 1 - windowAR / fotoAR > 0.1;
  const fotoFit: "cover" | "contain" = cortariaHorizontal ? "contain" : "cover";

  return (
    <div style={{ display: "flex", width: W, height: FOTO_H, overflow: "hidden", position: "relative" }}>
      {foto ? (
        <>
          {/* Fundo desfocado: some quando a foto cabe inteira (cover) — só
              aparece no "contain" (foto deitada numa janela mais alta), pra não
              sobrar tarja sólida em cima/embaixo do carro. */}
          {fotoFit === "contain" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={foto.uri}
              alt=""
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: W,
                height: FOTO_H,
                objectFit: "cover",
                objectPosition: "50% 50%",
                transform: "scale(1.2)",
                filter: `blur(60px) brightness(${brilhoFundo})`,
              }}
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={foto.uri}
            alt=""
            style={{
              position: fotoFit === "contain" ? "absolute" : "static",
              top: 0,
              left: 0,
              width: W,
              height: FOTO_H,
              objectFit: fotoFit,
              objectPosition: fotoFit === "cover" ? "50% 62%" : "50% 50%",
              backgroundColor: fotoFit === "contain" ? "transparent" : "#16161C",
            }}
          />
        </>
      ) : (
        <div style={{ display: "flex", width: W, height: FOTO_H, backgroundColor: "#16161C" }} />
      )}

      {/* Sombra sutil no topo pra segurar logo/selo */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: W,
          height: GRAD_TOPO,
          backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)",
        }}
      />

      {/* Logo (chip branco) ou nome da loja — some quando a foto já tem marca d'água */}
      {mostraBranding && (
        <div style={{ position: "absolute", top: 40, left: 48, display: "flex", alignItems: "center" }}>
          {logoUri ? (
            <div
              style={{
                display: "flex",
                backgroundColor: "rgba(255,255,255,0.94)",
                borderRadius: 20,
                padding: "12px 20px",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUri} alt="" style={{ width: 160, height: 78, objectFit: "contain" }} />
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                color: "#FFFFFF",
                fontSize: 32,
                fontWeight: 900,
                letterSpacing: 3,
                textTransform: "uppercase",
                textShadow: "0 2px 8px rgba(0,0,0,0.6)",
              }}
            >
              {cfg.nome}
            </div>
          )}
        </div>
      )}

      {/* Selo */}
      <div
        style={{
          position: "absolute",
          top: 48,
          right: 48,
          display: "flex",
          backgroundColor: cor,
          color: "#FFFFFF",
          padding: "12px 26px",
          borderRadius: 999,
          fontSize: 25,
          fontWeight: 900,
          letterSpacing: 3,
        }}
      >
        DISPONÍVEL
      </div>

      {/* Transição suave foto → painel */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: W,
          height: GRAD_BASE,
          backgroundImage: "linear-gradient(to top, rgba(11,11,15,1) 0%, rgba(11,11,15,0) 100%)",
        }}
      />
    </div>
  );
}

export function renderCapa(opts: {
  foto: FotoCapa | null;
  logoUri: string | null;
  cfg: MarketingCfg;
  veiculo: any;
  fontData: ArrayBuffer;
  formato?: CapaFormato;
}): ImageResponse {
  const { foto, cfg, veiculo, fontData } = opts;
  const { W, H, FOTO_H, PAD_BOTTOM, GRAD_TOPO, GRAD_BASE } = DIMS[opts.formato ?? "feed"];
  const cor = cfg.corPrimaria;
  // Se as fotos já têm marca d'água da loja, não sobrepõe logo/nome (marca dupla).
  const logoUri = cfg.fotoComMarca ? null : opts.logoUri;
  const mostraBranding = !cfg.fotoComMarca;

  const nomeCurto = [veiculo?.marca, veiculo?.modelo].filter(Boolean).join(" ").toUpperCase() || tituloVeiculo(veiculo);
  const tituloSize = nomeCurto.length > 24 ? 44 : nomeCurto.length > 16 ? 54 : 64;
  const anos = [veiculo?.ano, veiculo?.ano_modelo].filter(Boolean);
  const anoStr = anos.length === 2 && anos[0] !== anos[1] ? `${anos[0]}/${anos[1]}` : anos.length ? String(anos[anos.length - 1]) : "";
  const subtitulo = [veiculo?.versao, anoStr].filter(Boolean).join(" • ").toUpperCase();
  const specs = linhaSpecs(veiculo).split(" | ").filter(Boolean).slice(0, 4);
  const preco = cfg.mostrarPreco ? precoFormatado(veiculo) : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0B0B0F",
          fontFamily: "Montserrat",
          position: "relative",
        }}
      >
        {areaFoto({ foto, logoUri, cfg, cor, mostraBranding, W, FOTO_H, GRAD_TOPO, GRAD_BASE })}

        {/* ── Painel de informações (base sólida — nunca cobre o carro) ── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: W,
            height: H - FOTO_H,
            padding: `8px 48px ${PAD_BOTTOM}px 48px`,
            backgroundColor: "#0B0B0F",
          }}
        >
          <div style={{ display: "flex", width: 130, height: 12, backgroundColor: cor, marginBottom: 22, borderRadius: 6 }} />
          <div
            style={{
              display: "flex",
              fontSize: tituloSize,
              color: "#FFFFFF",
              fontWeight: 900,
              textTransform: "uppercase",
              lineHeight: 1.06,
              letterSpacing: 1,
            }}
          >
            {nomeCurto}
          </div>
          {subtitulo ? (
            <div
              style={{
                display: "flex",
                marginTop: 8,
                fontSize: 30,
                color: "rgba(255,255,255,0.88)",
                letterSpacing: 2,
              }}
            >
              {subtitulo}
            </div>
          ) : null}

          {specs.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
              {specs.map((s) => (
                <div
                  key={s}
                  style={{
                    display: "flex",
                    border: "2px solid rgba(255,255,255,0.4)",
                    borderRadius: 999,
                    padding: "9px 22px",
                    fontSize: 25,
                    color: "#FFFFFF",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  {s}
                </div>
              ))}
            </div>
          ) : null}

          <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 28 }}>
            {preco ? (
              <div
                style={{
                  display: "flex",
                  backgroundColor: cor,
                  color: "#FFFFFF",
                  padding: "10px 32px",
                  borderRadius: 18,
                  fontSize: 54,
                  fontWeight: 900,
                }}
              >
                {preco}
              </div>
            ) : null}
            {cfg.claim ? (
              <div
                style={{
                  display: "flex",
                  flex: 1,
                  fontSize: 22,
                  color: "rgba(255,255,255,0.85)",
                  letterSpacing: 1.5,
                  textTransform: "uppercase",
                  lineHeight: 1.35,
                }}
              >
                ✅ {cfg.claim}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [{ name: "Montserrat", data: fontData, weight: 900, style: "normal" }],
    }
  );
}

// Opcional do estoque vem em texto corrido do cadastro, às vezes com a
// explicação inteira ("Wi-Fi nativo a bordo (mediante contratação de pacote de
// dados)"). No painel isso vira 3 linhas e estoura. Corta o parêntese e o rabo
// depois de "com/para", e por fim trunca na palavra.
const OPCIONAL_MAX = 38;
export function encurtarOpcional(bruto: string): string {
  let t = String(bruto).replace(/\s*\([^)]*\)\s*/g, " ").trim();
  if (t.length > OPCIONAL_MAX) t = t.split(/\s+(?:com|para|mediante)\s+/i)[0].trim();
  if (t.length <= OPCIONAL_MAX) return t;
  const corte = t.slice(0, OPCIONAL_MAX);
  const espaco = corte.lastIndexOf(" ");
  return (espaco > 12 ? corte.slice(0, espaco) : corte).trim();
}

// Slides 2..N do carrossel de feed: mesma moldura da capa (foto + gradientes +
// logo + selo), mas o painel de baixo lista OPCIONAIS em vez da ficha do carro.
// Sem isso os slides eram a foto crua, que o IG cortava em 40% da largura pra
// caber no 4:5 do slide 1 — decepando a frente/traseira do carro (achado 02/09).
export function renderSlide(opts: {
  foto: FotoCapa | null;
  logoUri: string | null;
  cfg: MarketingCfg;
  opcionais: string[];
  /** Fallback quando os opcionais acabam antes dos slides. */
  veiculo: any;
  fontData: ArrayBuffer;
}): ImageResponse {
  const { foto, cfg, opcionais, veiculo, fontData } = opts;
  const { W, H, FOTO_H, PAD_BOTTOM, GRAD_TOPO, GRAD_BASE } = DIMS.feed;
  const cor = cfg.corPrimaria;
  // Slide não leva logo/nome no topo: a foto do estoque já vem com a marca
  // d'água da loja e a capa (slide 1) já abriu o carrossel com o branding —
  // repetir em todos os 9 slides é marca dupla.
  const logoUri = null;
  const mostraBranding = false;

  // Slide sem opcional (carro com ficha curta) vira recap do nome + preço, pra
  // não sobrar painel vazio no meio do carrossel.
  const itens = opcionais.map(encurtarOpcional);
  const temOpcionais = itens.length > 0;
  const nomeCurto =
    [veiculo?.marca, veiculo?.modelo].filter(Boolean).join(" ").toUpperCase() || tituloVeiculo(veiculo);
  const preco = cfg.mostrarPreco ? precoFormatado(veiculo) : null;
  // O painel tem ~438px úteis. Item longo quebra em 2 linhas, então a fonte cai
  // pra não estourar quando o slide leva 3 itens compridos.
  const maisLongo = itens.reduce((m, o) => Math.max(m, o.length), 0);
  const itemSize = itens.length >= 3 ? (maisLongo > 28 ? 34 : 40) : maisLongo > 28 ? 40 : 48;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0B0B0F",
          fontFamily: "Montserrat",
          position: "relative",
        }}
      >
        {areaFoto({ foto, logoUri, cfg, cor, mostraBranding, W, FOTO_H, GRAD_TOPO, GRAD_BASE, brilhoFundo: 0.45 })}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            // Painel do slide tem menos conteúdo que o da capa — centralizado,
            // não deixa um vão morto embaixo.
            justifyContent: "center",
            width: W,
            height: H - FOTO_H,
            padding: `8px 48px ${PAD_BOTTOM}px 48px`,
            backgroundColor: "#0B0B0F",
          }}
        >
          <div style={{ display: "flex", width: 130, height: 12, backgroundColor: cor, marginBottom: 22, borderRadius: 6 }} />

          {/* Fragment (<>) aqui saía torto no Satori — ele espremia o label numa
              coluna de 1 letra por linha. Cada ramo precisa de um div próprio,
              com largura explícita. */}
          {temOpcionais ? (
            <div style={{ display: "flex", flexDirection: "column", width: W - 96 }}>
              <div
                style={{
                  display: "flex",
                  width: W - 96,
                  fontSize: 26,
                  color: "rgba(255,255,255,0.65)",
                  letterSpacing: 4,
                  textTransform: "uppercase",
                  marginBottom: 22,
                }}
              >
                O que vem nele
              </div>
              {itens.map((o) => (
                <div
                  key={o}
                  style={{ display: "flex", width: W - 96, alignItems: "flex-start", marginBottom: 16 }}
                >
                  <div
                    style={{
                      display: "flex",
                      width: 14,
                      height: 14,
                      backgroundColor: cor,
                      borderRadius: 7,
                      marginTop: itemSize * 0.4,
                      marginRight: 18,
                      flexShrink: 0,
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      fontSize: itemSize,
                      color: "#FFFFFF",
                      fontWeight: 900,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      lineHeight: 1.2,
                    }}
                  >
                    {o}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", width: W - 96 }}>
              <div
                style={{
                  display: "flex",
                  width: W - 96,
                  fontSize: nomeCurto.length > 24 ? 44 : 54,
                  color: "#FFFFFF",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  lineHeight: 1.06,
                  letterSpacing: 1,
                }}
              >
                {nomeCurto}
              </div>
              {preco ? (
                <div
                  style={{
                    display: "flex",
                    // Sem isso o badge estica até a borda: num pai flex column o
                    // filho ocupa a largura toda por padrão.
                    alignSelf: "flex-start",
                    marginTop: 24,
                    backgroundColor: cor,
                    color: "#FFFFFF",
                    padding: "10px 32px",
                    borderRadius: 18,
                    fontSize: 54,
                    fontWeight: 900,
                  }}
                >
                  {preco}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [{ name: "Montserrat", data: fontData, weight: 900, style: "normal" }],
    }
  );
}

/**
 * Reparte os opcionais entre os slides disponíveis, no máximo 3 por slide.
 * Slides que sobram recebem lista vazia (viram recap de nome + preço).
 */
export function distribuirOpcionais(opcionais: string[] | null | undefined, nSlides: number): string[][] {
  const lista = (opcionais ?? []).map((o) => String(o).trim()).filter(Boolean);
  if (!nSlides) return [];
  const out: string[][] = Array.from({ length: nSlides }, () => []);
  if (!lista.length) return out;
  // Espalha o mais uniformemente possível, sem passar de 3 por slide: com poucos
  // opcionais cada slide leva 1 (respira melhor) e o excedente sobra pro recap.
  const porSlide = Math.min(3, Math.max(1, Math.ceil(lista.length / nSlides)));
  for (let i = 0; i < nSlides; i++) {
    const chunk = lista.slice(i * porSlide, (i + 1) * porSlide);
    if (!chunk.length) break;
    out[i] = chunk;
  }
  return out;
}
