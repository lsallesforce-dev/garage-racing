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
const DIMS: Record<CapaFormato, { W: number; H: number; FOTO_H: number; PAD_BOTTOM: number }> = {
  feed:  { W: 1080, H: 1350, FOTO_H: 860,  PAD_BOTTOM: 44 },
  story: { W: 1080, H: 1920, FOTO_H: 1230, PAD_BOTTOM: 150 },
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

export function renderCapa(opts: {
  foto: FotoCapa | null;
  logoUri: string | null;
  cfg: MarketingCfg;
  veiculo: any;
  fontData: ArrayBuffer;
  formato?: CapaFormato;
}): ImageResponse {
  const { foto, cfg, veiculo, fontData } = opts;
  const { W, H, FOTO_H, PAD_BOTTOM } = DIMS[opts.formato ?? "feed"];
  const cor = cfg.corPrimaria;
  // Se as fotos já têm marca d'água da loja, não sobrepõe logo/nome (marca dupla).
  const logoUri = cfg.fotoComMarca ? null : opts.logoUri;
  const mostraBranding = !cfg.fotoComMarca;

  // cover × contain: corte VERTICAL (foto mais alta que a janela) é seguro — o viés
  // 62% come céu, não carro. Corte HORIZONTAL (foto deitada em janela alta, típico
  // no story) come a frente/traseira do carro: acima de 10%, mostra a foto inteira
  // (contain) sobre fundo escuro em vez de dar zoom.
  const windowAR = W / FOTO_H;
  const fotoAR = foto ? foto.w / foto.h : windowAR;
  const cortariaHorizontal = fotoAR > windowAR && 1 - windowAR / fotoAR > 0.1;
  const fotoFit: "cover" | "contain" = cortariaHorizontal ? "contain" : "cover";
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
        {/* ── Área da foto (topo) — o carro tem esse espaço inteiro, sem texto por cima ── */}
        <div
          style={{
            display: "flex",
            width: W,
            height: FOTO_H,
            overflow: "hidden",
            position: "relative",
          }}
        >
          {foto ? (
            <>
              {/* Fundo desfocado: some quando a foto cabe inteira (cover) — só
                  aparece no "contain" (comum no story, foto deitada numa
                  janela em pé), pra não sobrar tarja sólida em cima/embaixo
                  do carro. Mesma foto, ampliada + borrada, atrás da nítida. */}
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
                    filter: "blur(60px) brightness(0.55)",
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
              height: 180,
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
              height: 120,
              backgroundImage: "linear-gradient(to top, rgba(11,11,15,1) 0%, rgba(11,11,15,0) 100%)",
            }}
          />
        </div>

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
