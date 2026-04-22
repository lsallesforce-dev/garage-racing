const unidades = ["", "UM", "DOIS", "TRÊS", "QUATRO", "CINCO", "SEIS", "SETE", "OITO", "NOVE",
  "DEZ", "ONZE", "DOZE", "TREZE", "QUATORZE", "QUINZE", "DEZESSEIS", "DEZESSETE", "DEZOITO", "DEZENOVE"];
const dezenas = ["", "", "VINTE", "TRINTA", "QUARENTA", "CINQUENTA", "SESSENTA", "SETENTA", "OITENTA", "NOVENTA"];
const centenas = ["", "CENTO", "DUZENTOS", "TREZENTOS", "QUATROCENTOS", "QUINHENTOS",
  "SEISCENTOS", "SETECENTOS", "OITOCENTOS", "NOVECENTOS"];

function grupo(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "CEM";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const d = Math.floor(resto / 10);
  const u = resto % 10;
  const partes: string[] = [];
  if (c) partes.push(centenas[c]);
  if (resto < 20 && resto > 0) partes.push(unidades[resto]);
  else {
    if (d) partes.push(dezenas[d]);
    if (u) partes.push(unidades[u]);
  }
  return partes.join(" E ");
}

export function numeroExtenso(valor: number): string {
  if (valor === 0) return "ZERO REAIS";
  const inteiro = Math.floor(valor);
  const centavos = Math.round((valor - inteiro) * 100);

  const milhoes = Math.floor(inteiro / 1_000_000);
  const milhares = Math.floor((inteiro % 1_000_000) / 1_000);
  const reais = inteiro % 1_000;

  const partes: string[] = [];
  if (milhoes) partes.push(`${grupo(milhoes)} ${milhoes === 1 ? "MILHÃO" : "MILHÕES"}`);
  if (milhares) partes.push(`${grupo(milhares)} MIL`);
  if (reais) partes.push(grupo(reais));

  const textoInteiro = partes.join(" E ");
  const labelReal = inteiro === 1 ? "REAL" : "REAIS";

  if (centavos === 0) return `${textoInteiro} ${labelReal}`;
  const textoCentavos = `${grupo(centavos)} ${centavos === 1 ? "CENTAVO" : "CENTAVOS"}`;
  return `${textoInteiro} ${labelReal} E ${textoCentavos}`;
}
