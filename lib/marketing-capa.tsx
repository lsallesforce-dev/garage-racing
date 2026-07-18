// Render da capa do Kit de Postagem (1080x1350, next/og ImageResponse + Montserrat local).
// Compartilhado entre /api/marketing/pacote (produção) e /api/marketing/capa-dev (preview local).
// No F2 este layout vira a cena de intro do template Remotion — manter os tokens
// (cor primária, Montserrat Black, faixa + título + chips de specs) espelhados lá.

import { ImageResponse } from "next/og";
import { promises as fs } from "fs";
import path from "path";
import { linhaSpecs, precoFormatado, tituloVeiculo, type MarketingCfg } from "@/lib/marketing-kit";

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

export function renderCapa(opts: {
  fotoUri: string | null;
  logoUri: string | null;
  cfg: MarketingCfg;
  veiculo: any;
  fontData: ArrayBuffer;
}): ImageResponse {
  const { fotoUri, logoUri, cfg, veiculo, fontData } = opts;
  const cor = cfg.corPrimaria;
  const nomeCurto = [veiculo?.marca, veiculo?.modelo].filter(Boolean).join(" ").toUpperCase() || tituloVeiculo(veiculo);
  const tituloSize = nomeCurto.length > 24 ? 46 : nomeCurto.length > 16 ? 56 : 66;
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
        {fotoUri ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fotoUri}
            alt=""
            style={{ position: "absolute", top: 0, left: 0, width: 1080, height: 1350, objectFit: "cover" }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: 1080,
            height: 700,
            backgroundImage:
              "linear-gradient(to top, rgba(0,0,0,0.93) 18%, rgba(0,0,0,0.6) 55%, rgba(0,0,0,0) 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1080,
            height: 200,
            backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)",
          }}
        />

        {/* Topo: logo (chip branco) ou nome da loja */}
        <div style={{ position: "absolute", top: 44, left: 48, display: "flex", alignItems: "center" }}>
          {logoUri ? (
            <div
              style={{
                display: "flex",
                backgroundColor: "rgba(255,255,255,0.94)",
                borderRadius: 20,
                padding: "14px 22px",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUri} alt="" style={{ width: 170, height: 84, objectFit: "contain" }} />
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                color: "#FFFFFF",
                fontSize: 34,
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

        {/* Selo */}
        <div
          style={{
            position: "absolute",
            top: 52,
            right: 48,
            display: "flex",
            backgroundColor: cor,
            color: "#FFFFFF",
            padding: "14px 28px",
            borderRadius: 999,
            fontSize: 26,
            fontWeight: 900,
            letterSpacing: 3,
          }}
        >
          DISPONÍVEL
        </div>

        {/* Bloco inferior */}
        <div
          style={{
            position: "absolute",
            bottom: 56,
            left: 48,
            right: 48,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", width: 130, height: 12, backgroundColor: cor, marginBottom: 26, borderRadius: 6 }} />
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
                marginTop: 10,
                fontSize: 32,
                color: "rgba(255,255,255,0.88)",
                letterSpacing: 2,
              }}
            >
              {subtitulo}
            </div>
          ) : null}

          {specs.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 26 }}>
              {specs.map((s) => (
                <div
                  key={s}
                  style={{
                    display: "flex",
                    border: "2px solid rgba(255,255,255,0.4)",
                    borderRadius: 999,
                    padding: "10px 24px",
                    fontSize: 26,
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

          {preco ? (
            <div style={{ display: "flex", marginTop: 30 }}>
              <div
                style={{
                  display: "flex",
                  backgroundColor: cor,
                  color: "#FFFFFF",
                  padding: "12px 34px",
                  borderRadius: 18,
                  fontSize: 58,
                  fontWeight: 900,
                }}
              >
                {preco}
              </div>
            </div>
          ) : null}

          {cfg.claim ? (
            <div
              style={{
                display: "flex",
                marginTop: 24,
                fontSize: 24,
                color: "rgba(255,255,255,0.85)",
                letterSpacing: 2,
                textTransform: "uppercase",
              }}
            >
              ✅ {cfg.claim}
            </div>
          ) : null}
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1350,
      fonts: [{ name: "Montserrat", data: fontData, weight: 900, style: "normal" }],
    }
  );
}
