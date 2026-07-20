// Render do reel (marketing F2, bloco 3) — roda no WORKER Railway (Node, sem
// timeout de serverless), não na Vercel. Bundle do projeto Remotion + Chrome
// headless (@remotion/renderer) → MP4 no R2 → marketing_reel_url.
//
// ⚠️ Requer Chrome no ambiente do worker (Railway/nixpacks) — ver nixpacks.toml.

import path from "path";
import os from "os";
import { promises as fs } from "fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { cfgFromRow, formatFone, linhaSpecs, precoFormatado } from "@/lib/marketing-kit";
import { fotoParaCapa } from "@/lib/marketing-capa";
import { SHOT_TAKES, type MarketingCapturas } from "@/lib/marketing-shotlist";
import type { ReelProps, ReelClip } from "@/remotion/types";

const R2_BUCKET = "videos-estoque";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

// Marca costuma vir "VW - VolksWagen" → pega o nome depois do hífen.
function cleanMarca(m: string | null | undefined): string {
  if (!m) return "";
  return (m.includes("-") ? m.split("-").pop()! : m).trim();
}

// Modelo costuma trazer a versão inteira ("Nivus Highline 1.0 200 TSI Flex Aut.")
// — corta no primeiro token de motor/versão e limita a 2 palavras pro título do reel.
const STOP_MODELO = /^(\d|TSI|TDI|MSI|FLEX|AUT|MEC|8V|16V|12V|V6|V8|4X4|4X2|4P|5P|2P|CV|TB|POWER|FIRE|TOTAL)/i;
function cleanModelo(m: string | null | undefined): string {
  if (!m) return "";
  const out: string[] = [];
  for (const w of m.split(/\s+/)) {
    if (STOP_MODELO.test(w)) break;
    out.push(w);
    if (out.length >= 2) break;
  }
  return out.join(" ") || m.split(/\s+/)[0] || "";
}

// Opcionais viram callouts curtos e vendáveis sobre os clipes do reel. Um mapa de
// palavras-chave dá rótulos limpos ("Central multimídia VW Play 10,1..." → "MULTIMÍDIA");
// o que não casar é encurtado (sem parênteses, ≤3 palavras).
const PRETTY_OPCIONAL: [RegExp, string][] = [
  [/multim[íi]dia|carplay|android auto|vw play|tela touch/i, "CENTRAL MULTIMÍDIA"],
  [/c[âa]mera de r[ée]/i, "CÂMERA DE RÉ"],
  [/airbag/i, "AIRBAGS"],
  [/couro/i, "BANCOS EM COURO"],
  [/full led|far[óo]is? (full )?led|led/i, "FARÓIS DE LED"],
  [/roda.*liga|liga leve/i, "RODAS DE LIGA LEVE"],
  [/(adaptativo|acc|piloto autom|cruise)/i, "PILOTO AUTOMÁTICO"],
  [/frenagem|aeb/i, "FRENAGEM AUTOMÁTICA"],
  [/climat|dual zone|ar-condicionado autom|ar condicionado digital/i, "AR-CONDICIONADO DIGITAL"],
  [/sensor.*estacion|sensor de r[ée]|sensor dianteiro|park/i, "SENSOR DE ESTACIONAMENTO"],
  [/(kessy|presencial|keyless|push start|partida por bot)/i, "CHAVE PRESENCIAL"],
  [/active info|painel.*digital|tft|instrumentos digital/i, "PAINEL DIGITAL"],
  [/teto solar|panor[âa]mico/i, "TETO SOLAR"],
  [/vidros? el[ée]tricos?/i, "VIDROS ELÉTRICOS"],
  [/dire[çc][ãa]o el[ée]trica/i, "DIREÇÃO ELÉTRICA"],
  [/freio.*disco|freio abs|\babs\b/i, "FREIOS ABS"],
  [/controle de (estabilidade|tra[çc][ãa]o)|esp/i, "CONTROLE DE ESTABILIDADE"],
  [/engate|reboque/i, "ENGATE REBOQUE"],
  [/rack de teto/i, "RACK DE TETO"],
  [/pneus? novos?/i, "PNEUS NOVOS"],
];

function curtaOpcional(s: string): string {
  for (const [re, label] of PRETTY_OPCIONAL) if (re.test(s)) return label;
  let t = s.split("(")[0].split(/[,–-]/)[0].trim();
  const words = t.split(/\s+/);
  if (words.length > 3) t = words.slice(0, 3).join(" ");
  return t.toUpperCase();
}

// Lista de callouts únicos (sem repetir) a partir dos opcionais → pontos fortes.
function calloutsDoVeiculo(veiculo: any): string[] {
  const fontes: string[] = [...(veiculo?.opcionais ?? []), ...(veiculo?.pontos_fortes_venda ?? [])];
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const f of fontes) {
    const c = curtaOpcional(String(f));
    if (c && c.length >= 3 && !vistos.has(c)) {
      vistos.add(c);
      out.push(c);
    }
  }
  return out;
}

// Monta os ReelProps a partir do veículo + config do tenant.
export async function buildReelProps(veiculo: any, cfgRow: any): Promise<ReelProps> {
  const cfg = cfgFromRow(cfgRow);
  const capturas: MarketingCapturas = veiculo.marketing_capturas ?? {};

  // Clips: ordena os takes pela ordem da shot list. O callout de cada clip é um
  // OPCIONAL vendável do carro (não o rótulo do ângulo, que é jargão interno).
  const takesEtiquetados = capturas.takes ?? [];
  const ordemTag = SHOT_TAKES.map((s) => s.tag);
  let clips: ReelClip[] = [];
  if (takesEtiquetados.length) {
    clips = [...takesEtiquetados]
      .sort((a, b) => ordemTag.indexOf(a.tag) - ordemTag.indexOf(b.tag))
      .map((t) => ({ src: t.url }));
  } else {
    clips = (veiculo.video_takes ?? []).map((src: string) => ({ src }));
  }

  const anos = [veiculo.ano, veiculo.ano_modelo].filter(Boolean);
  const anoLabel =
    anos.length === 2 && anos[0] !== anos[1] ? `${anos[0]}/${anos[1]}` : anos.length ? String(anos[anos.length - 1]) : "";

  // Fundo da intro = FOTO CRUA (nunca a capa montada, que já tem texto embutido).
  const capaUrl = capturas.fotos?.find((f) => f.tag === "frente-3-4")?.url ?? veiculo.fotos?.[0] ?? null;
  // Mede a foto pra intro decidir cover×contain (não cortar o carro em foto deitada).
  const medida = capaUrl ? await fotoParaCapa(capaUrl) : null;

  return {
    marca: cleanMarca(veiculo.marca),
    modelo: cleanModelo(veiculo.modelo),
    versao: veiculo.versao ?? "",
    anoLabel,
    specs: linhaSpecs(veiculo).split(" | ").filter(Boolean),
    opcionais: calloutsDoVeiculo(veiculo),
    preco: cfg.mostrarPreco ? precoFormatado(veiculo) : null,
    claim: cfg.claim,
    loja: cfg.nome,
    corPrimaria: cfg.corPrimaria,
    capaUrl,
    capaW: medida?.w ?? null,
    capaH: medida?.h ?? null,
    logoUrl: supabaseAdmin.storage.from("configuracoes").getPublicUrl(`logos/${veiculo.user_id}.png`).data.publicUrl,
    whatsapp: formatFone(cfg.telefoneLoja || cfg.whatsapp),
    clips,
    trilhaUrl: `${R2_PUBLIC_URL}/musicas/animado.mp3`,
  };
}

// Bundle do Remotion cacheado entre renders (o bundle é caro; o worker é longevo).
let bundlePromise: Promise<string> | null = null;
async function getBundle(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      const { bundle } = await import("@remotion/bundler");
      return bundle({
        entryPoint: path.join(process.cwd(), "remotion", "index.ts"),
        // webpackOverride default serve; o projeto é TS/React puro no remotion/
      });
    })();
  }
  return bundlePromise;
}

export async function renderReel(veiculoId: string): Promise<string> {
  const { data: veiculo } = await supabaseAdmin.from("veiculos").select("*").eq("id", veiculoId).single();
  if (!veiculo) throw new Error("Veículo não encontrado");
  if (!veiculo.video_takes?.length && !(veiculo.marketing_capturas?.takes?.length)) {
    throw new Error("Veículo sem takes de vídeo — grave os takes na captura guiada");
  }

  const { data: cfgRows } = await supabaseAdmin
    .from("config_garage")
    .select("*")
    .eq("user_id", veiculo.user_id)
    .order("created_at", { ascending: false })
    .limit(1);

  const inputProps = await buildReelProps(veiculo, cfgRows?.[0] ?? null);

  const { selectComposition, renderMedia, ensureBrowser } = await import("@remotion/renderer");

  // Em ambiente Nix (Railway), o Chrome baixado pelo Remotion pode não linkar —
  // aí aponta-se pro chromium do sistema via REMOTION_BROWSER_EXECUTABLE.
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
  if (!browserExecutable) await ensureBrowser();

  const props = inputProps as unknown as Record<string, unknown>;
  const serveUrl = await getBundle();
  const composition = await selectComposition({ serveUrl, id: "VeiculoReel", inputProps: props, browserExecutable });

  const outPath = path.join(os.tmpdir(), `reel_${veiculoId}_${Date.now()}.mp4`);
  await renderMedia({
    serveUrl,
    composition,
    codec: "h264",
    outputLocation: outPath,
    inputProps: props,
    browserExecutable,
    concurrency: 2,
  });

  const buf = await fs.readFile(outPath);
  const key = `reels/${veiculoId}/reel_${Date.now()}.mp4`;
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: "video/mp4" }));
  await fs.unlink(outPath).catch(() => {});

  const url = `${R2_PUBLIC_URL}/${key}`;
  await supabaseAdmin.from("veiculos").update({ marketing_reel_url: url, marketing_reel_status: "pronto" }).eq("id", veiculoId);
  return url;
}
