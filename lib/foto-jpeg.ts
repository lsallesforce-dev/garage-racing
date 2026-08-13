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
    if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
      throw new Error(
        "Este navegador não abre HEIC. No iPhone: Ajustes → Câmera → Formatos → 'Mais Compatível'. No PC, converta pra JPG antes de subir."
      );
    }
    throw new Error("Não consegui ler essa imagem. Use JPG ou PNG.");
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
