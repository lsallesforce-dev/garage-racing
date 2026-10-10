// lib/feriados-br.ts
// Feriados NACIONAIS do Brasil — pro agente não confirmar visita em dia fechado.
//
// Caso real (APROVE, 10/10/2026, sábado): cliente perguntou "Segunda tá fechado?"
// e o agente respondeu "Não, na segunda-feira abrimos das 8h às 18h. Pode vir
// nos visitar!" — segunda era 12/10, Nossa Senhora Aparecida. O prompt só sabia
// o dia da semana, nem a data de hoje tinha.
//
// Só os nacionais fixos + Sexta-feira Santa. Carnaval e Corpus Christi são ponto
// facultativo e feriado municipal/estadual varia por cidade: esses a loja
// informa em "instruções adicionais".

const TZ = "America/Sao_Paulo";

const FIXOS: Array<[mes: number, dia: number, nome: string]> = [
  [1, 1, "Confraternização Universal"],
  [4, 21, "Tiradentes"],
  [5, 1, "Dia do Trabalho"],
  [9, 7, "Independência do Brasil"],
  [10, 12, "Nossa Senhora Aparecida"],
  [11, 2, "Finados"],
  [11, 15, "Proclamação da República"],
  [11, 20, "Dia da Consciência Negra"],
  [12, 25, "Natal"],
];

/** Domingo de Páscoa (algoritmo de Meeus/Butcher) — [mês, dia]. */
function pascoa(ano: number): [number, number] {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return [mes, dia];
}

/** Nome do feriado nacional em (ano, mês 1-12, dia), ou null. */
export function feriadoNacional(ano: number, mes: number, dia: number): string | null {
  const fixo = FIXOS.find(([m, d]) => m === mes && d === dia);
  if (fixo) return fixo[2];
  const [pm, pd] = pascoa(ano);
  // Sexta-feira Santa = Páscoa - 2 dias (UTC puro, só aritmética de calendário)
  const sexta = new Date(Date.UTC(ano, pm - 1, pd - 2));
  if (sexta.getUTCMonth() + 1 === mes && sexta.getUTCDate() === dia) return "Sexta-feira Santa";
  return null;
}

/** Data de hoje no fuso de São Paulo. */
function hojeSP(agora: Date): { ano: number; mes: number; dia: number } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(agora);
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { ano: n("year"), mes: n("month"), dia: n("day") };
}

const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const dd = (n: number) => String(n).padStart(2, "0");

/**
 * Bloco de data + feriados pro prompt do agente.
 * Ex.: { hoje: "sexta-feira, 10/10/2026", feriados: ["segunda-feira 12/10 — Nossa Senhora Aparecida"] }
 */
export function calendarioDoAgente(agora: Date = new Date(), diasAFrente = 14): { hoje: string; feriados: string[] } {
  const { ano, mes, dia } = hojeSP(agora);
  const base = Date.UTC(ano, mes - 1, dia);
  const feriados: string[] = [];
  for (let i = 0; i <= diasAFrente; i++) {
    const d = new Date(base + i * 86400000);
    const nome = feriadoNacional(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    if (!nome) continue;
    const quando = i === 0 ? "HOJE" : i === 1 ? "AMANHÃ" : DIAS[d.getUTCDay()];
    feriados.push(`${quando} ${dd(d.getUTCDate())}/${dd(d.getUTCMonth() + 1)} — ${nome}`);
  }
  const h = new Date(base);
  return { hoje: `${DIAS[h.getUTCDay()]}, ${dd(dia)}/${dd(mes)}/${ano}`, feriados };
}
