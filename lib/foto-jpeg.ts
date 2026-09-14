// Normalização de foto no navegador, ANTES de subir pro Storage.
//
// O modo de falha que isto existe pra matar: iPhone entrega .HEIC, o upload
// devolve 200, a foto entra em fotos[] com check verde na tela — e some em
// todo lugar que importa. HEIC não renderiza em <img> nenhum (kit, vitrine,
// portal, foto que o agente manda pro lead) e o sharp do servidor não tem
// decoder HEIF, então capa, classificação e restauro de piso quebram junto.
// Silencioso do começo ao fim.
//
// De quebra o canvas reduz a foto de 12 MP do celular, que no 4G da loja pesa
// e não acrescenta nada — o kit sai em 1080/1350.
//
// Só roda no cliente (usa createImageBitmap + canvas).

/** Maior lado da foto depois da conversão. */
export const MAX_LADO_FOTO = 2560;

export async function paraJpeg(file: File, maxLado = MAX_LADO_FOTO): Promise<File> {
  // JPEG pequeno já está bom — não recomprime à toa (recompressão come detalhe).
  if (file.type === "image/jpeg" && file.size < 3_000_000) return file;

  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    // Só o Safari decodifica HEIC nativo. Chrome/Edge no Windows e no Android
    // falham aqui — e é justamente de onde vem a foto do celular Samsung
    // (20260914_102718.heic, APROVE 14/09). Decodifica com libheif (heic-to).
    if (!(await pareceHeic(file))) throw new Error("Não consegui ler essa imagem. Use JPG ou PNG.");
    try {
      bmp = await createImageBitmap(await heicParaBlob(file));
    } catch {
      throw new Error("Não consegui abrir essa foto HEIC. Converta pra JPG e tente de novo.");
    }
  }

  const escala = Math.min(1, maxLado / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * escala);
  cv.height = Math.round(bmp.height * escala);
  const ctx = cv.getContext("2d");
  if (!ctx) {
    bmp.close();
    throw new Error("Canvas não suportado neste navegador");
  }
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close();

  const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, "image/jpeg", 0.9));
  if (!blob) throw new Error("Não consegui converter a foto");
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
}

/** Pelo nome/tipo OU pelo cabeçalho: no Windows o .heic costuma chegar com type vazio. */
async function pareceHeic(file: File): Promise<boolean> {
  if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) return true;
  const cab = new TextDecoder("latin1").decode(await file.slice(4, 32).arrayBuffer());
  return cab.startsWith("ftyp") && /heic|heix|hevc|heim|heis|mif1|msf1/.test(cab);
}

async function heicParaBlob(file: File): Promise<Blob> {
  // Build "csp": sem WASM e sem eval — a CSP de produção não libera unsafe-eval.
  // Import dinâmico: ~3 MB que só baixa quando aparece um HEIC.
  const { heicTo } = await import("heic-to/csp");
  return heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
}
