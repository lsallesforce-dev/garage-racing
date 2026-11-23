// lib/cambio.ts — o campo `cambio` do cadastro é a verdade sobre o câmbio.
//
// O nome do modelo vem da FIPE ("ONIX HATCH LT 1.0 12V TB Flex 5p Mec.") e a
// descrição é gerada a partir desse nome. Quando a consulta de placa traz a
// versão errada, o lojista corrige o câmbio na tela, mas nome e descrição
// continuavam dizendo "manual" — e era isso que o agente lia. Caso real
// (Bonitão 19 e 23/11): Onix LT 2023 automático anunciado como manual a quem
// só queria automático.

export type TipoCambio = "automatico" | "manual";

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function tipoCambio(cambio: string | null | undefined): TipoCambio | null {
  const c = semAcento(String(cambio ?? "")).trim();
  if (!c) return null;
  if (/manual|mecanic|^mec\b/.test(c)) return "manual";
  if (/auto|cvt|tiptronic|tronic|dsg|\bat\b/.test(c)) return "automatico";
  return null;
}

/** Câmbio que o NOME da FIPE indica ("... Aut." / "... Mec."), ou null. */
export function cambioDoNomeFipe(modelo: string | null | undefined): "Automático" | "Manual" | null {
  const m = semAcento(String(modelo ?? ""));
  if (/\b(aut|automatic[oa]|cvt|tiptronic|s-?tronic|dsg)\b/.test(m)) return "Automático";
  if (/\b(mec|mecanic[oa]|manual)\b/.test(m)) return "Manual";
  return null;
}

/** Troca o "Mec."/"Aut." do nome quando contradiz o câmbio do cadastro. */
export function modeloConformeCambio(modelo: string | null | undefined, cambio: string | null | undefined): string {
  const nome = String(modelo ?? "");
  const tipo = tipoCambio(cambio);
  if (tipo === "automatico") return nome.replace(/\bMec\.?(?=\d|\s|$)/gi, "Aut.");
  if (tipo === "manual") return nome.replace(/\bAut\.?(?=\d|\s|$)/gi, "Mec.");
  return nome;
}

/** Corrige "câmbio manual"/"câmbio automático" em texto de descrição. */
export function textoConformeCambio(texto: string | null | undefined, cambio: string | null | undefined): string {
  const t = String(texto ?? "");
  const tipo = tipoCambio(cambio);
  if (tipo === "automatico") {
    return t.replace(/\b(c[âa]mbio|transmiss[ãa]o)\s+(?:de\s+)?(manual|mec[âa]nic[oa])\b/gi, (_m, p) => `${p} automático`.replace(/^transmiss[ãa]o automático$/i, "transmissão automática"));
  }
  if (tipo === "manual") {
    return t.replace(/\b(c[âa]mbio|transmiss[ãa]o)\s+(autom[áa]tic[oa]|cvt)\b/gi, (_m, p) => `${p} manual`);
  }
  return t;
}
