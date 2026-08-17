// lib/periodo.ts
// Janelas de tempo para os relatórios, sempre em BRT (UTC-3).
//
// Por que não usar Date local: a função roda na Vercel, cujo relógio é UTC.
// `new Date().setHours(0,0,0,0)` lá vira 21h do dia anterior no Brasil — o
// "hoje" do lojista ficava 3h errado. Aqui todo corte de dia/mês/ano é feito
// deslocando explicitamente 3h, e não há horário de verão no Brasil desde 2019.

export const BRT_OFFSET_H = -3;
const H = 60 * 60 * 1000;
const DIA = 24 * H;

export type PeriodoKey = "dia" | "semana" | "mes" | "ano" | "6m" | "custom";
export type Bucket = "hora" | "dia" | "semana" | "mes";

export const PERIODOS: { key: PeriodoKey; label: string }[] = [
  { key: "dia",    label: "Hoje"          },
  { key: "semana", label: "7 dias"        },
  { key: "mes",    label: "Mês"           },
  { key: "ano",    label: "Ano"           },
  { key: "6m",     label: "6 meses"       },
  { key: "custom", label: "Personalizado" },
];

export type Periodo = {
  key: PeriodoKey;
  /** Início do recorte (inclusivo). */
  inicio: Date;
  /** Fim do recorte (exclusivo). */
  fim: Date;
  /** Mesma duração, imediatamente antes — base do comparativo ▲▼. */
  inicioAnterior: Date;
  fimAnterior: Date;
  /** Granularidade da série temporal. */
  bucket: Bucket;
  /** Ex.: "Hoje · 17 ago" */
  label: string;
  /** Ex.: "17 jul – 16 ago" — o que o delta está comparando. */
  labelAnterior: string;
};

/** Campos de data/hora de um instante, já convertidos para BRT. */
export function partesBRT(d: Date) {
  const b = new Date(d.getTime() + BRT_OFFSET_H * H);
  return {
    ano:  b.getUTCFullYear(),
    mes:  b.getUTCMonth(), // 0-11
    dia:  b.getUTCDate(),
    hora: b.getUTCHours(),
    dow:  b.getUTCDay(),   // 0 = domingo
  };
}

/** Instante UTC correspondente a uma data/hora de parede em BRT. */
export function deBRT(ano: number, mes: number, dia: number, hora = 0): Date {
  return new Date(Date.UTC(ano, mes, dia, hora - BRT_OFFSET_H));
}

/** Meia-noite BRT do dia em que `d` cai. */
export function inicioDiaBRT(d: Date): Date {
  const p = partesBRT(d);
  return deBRT(p.ano, p.mes, p.dia);
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const DIAS_SEMANA_LABEL = DIAS_SEMANA;

/** "17 ago" — sem ano quando é o ano corrente. */
export function dataCurtaBRT(d: Date, comAno = false): string {
  const p = partesBRT(d);
  const base = `${p.dia} ${MESES[p.mes]}`;
  return comAno ? `${base} ${String(p.ano).slice(2)}` : base;
}

/** Parse de "YYYY-MM-DD" vindo de <input type="date"> como dia BRT. */
export function parseDataBRT(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const d = deBRT(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/** "YYYY-MM-DD" (BRT) — formato aceito de volta pelo <input type="date">. */
export function formatarDataBRT(d: Date): string {
  const p = partesBRT(d);
  return `${p.ano}-${String(p.mes + 1).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}

function bucketPorDuracao(ms: number): Bucket {
  const dias = ms / DIA;
  if (dias <= 2)  return "hora";
  if (dias <= 62) return "dia";
  if (dias <= 200) return "semana";
  return "mes";
}

/**
 * Resolve o recorte pedido pela UI.
 * O período anterior é sempre a MESMA duração imediatamente antes — comparar
 * "mês até hoje" com um mês fechado inflaria o delta artificialmente.
 */
export function resolverPeriodo(
  key: PeriodoKey,
  de?: string | null,
  ate?: string | null,
  agora: Date = new Date(),
): Periodo {
  const hoje = inicioDiaBRT(agora);
  const p = partesBRT(agora);
  let inicio: Date;
  let fim: Date = new Date(agora.getTime());
  let bucket: Bucket;
  let label: string;
  let resolvida: PeriodoKey = key;

  switch (key) {
    case "dia":
      inicio = hoje;
      bucket = "hora";
      label = `Hoje · ${dataCurtaBRT(hoje)}`;
      break;

    case "semana":
      inicio = new Date(hoje.getTime() - 6 * DIA); // 7 dias contando hoje
      bucket = "dia";
      label = `7 dias · ${dataCurtaBRT(inicio)} – ${dataCurtaBRT(hoje)}`;
      break;

    case "mes":
      inicio = deBRT(p.ano, p.mes, 1);
      bucket = "dia";
      label = `${MESES[p.mes]} ${p.ano}`;
      break;

    case "ano":
      inicio = deBRT(p.ano, 0, 1);
      bucket = "mes";
      label = String(p.ano);
      break;

    case "6m":
      inicio = new Date(hoje.getTime() - 179 * DIA);
      bucket = "semana";
      label = `6 meses · ${dataCurtaBRT(inicio, true)} – ${dataCurtaBRT(hoje)}`;
      break;

    case "custom": {
      const dIni = parseDataBRT(de);
      const dFim = parseDataBRT(ate);
      if (!dIni || !dFim) {
        // Datas inválidas: cai no mês corrente em vez de estourar.
        return resolverPeriodo("mes", null, null, agora);
      }
      // Aceita intervalo invertido sem reclamar — o lojista clica errado.
      const a = dIni <= dFim ? dIni : dFim;
      const b = dIni <= dFim ? dFim : dIni;
      inicio = a;
      fim = new Date(b.getTime() + DIA); // fim exclusivo: inclui o dia inteiro
      if (fim > agora) fim = new Date(agora.getTime());
      bucket = bucketPorDuracao(fim.getTime() - inicio.getTime());
      label = `${dataCurtaBRT(a, true)} – ${dataCurtaBRT(b, true)}`;
      break;
    }

    default:
      return resolverPeriodo("mes", null, null, agora);
  }

  const duracao = Math.max(fim.getTime() - inicio.getTime(), H);
  const fimAnterior = new Date(inicio.getTime());
  const inicioAnterior = new Date(inicio.getTime() - duracao);
  const labelAnterior = `${dataCurtaBRT(inicioAnterior, true)} – ${dataCurtaBRT(new Date(fimAnterior.getTime() - 1), true)}`;

  return { key: resolvida, inicio, fim, inicioAnterior, fimAnterior, bucket, label, labelAnterior };
}

/** Chave estável do bucket a que um instante pertence (ordenável como string). */
export function chaveBucket(d: Date, bucket: Bucket): string {
  const p = partesBRT(d);
  const mm = String(p.mes + 1).padStart(2, "0");
  const dd = String(p.dia).padStart(2, "0");
  switch (bucket) {
    case "hora":
      return `${p.ano}-${mm}-${dd}T${String(p.hora).padStart(2, "0")}`;
    case "dia":
      return `${p.ano}-${mm}-${dd}`;
    case "semana": {
      // Segunda-feira da semana, em BRT.
      const recuo = (p.dow + 6) % 7;
      const seg = partesBRT(new Date(deBRT(p.ano, p.mes, p.dia).getTime() - recuo * DIA));
      return `${seg.ano}-${String(seg.mes + 1).padStart(2, "0")}-${String(seg.dia).padStart(2, "0")}`;
    }
    case "mes":
      return `${p.ano}-${mm}`;
  }
}

/** Rótulo curto do bucket para o eixo X do gráfico. */
export function rotuloBucket(chave: string, bucket: Bucket): string {
  switch (bucket) {
    case "hora":
      return `${chave.slice(11, 13)}h`;
    case "dia":
      return `${Number(chave.slice(8, 10))} ${MESES[Number(chave.slice(5, 7)) - 1]}`;
    case "semana":
      return `${Number(chave.slice(8, 10))}/${chave.slice(5, 7)}`;
    case "mes":
      return `${MESES[Number(chave.slice(5, 7)) - 1]} ${chave.slice(2, 4)}`;
  }
}

/**
 * Todos os buckets do intervalo, em ordem — inclusive os vazios, senão o
 * gráfico "pula" os dias sem lead e mente sobre a cadência.
 */
export function bucketsDoPeriodo(inicio: Date, fim: Date, bucket: Bucket): string[] {
  const out: string[] = [];
  const vistos = new Set<string>();
  const passo = bucket === "hora" ? H : DIA;
  const limite = 400; // guarda contra intervalo custom absurdo
  for (let t = inicio.getTime(); t < fim.getTime() && out.length < limite; t += passo) {
    const k = chaveBucket(new Date(t), bucket);
    if (!vistos.has(k)) { vistos.add(k); out.push(k); }
  }
  const kFim = chaveBucket(new Date(fim.getTime() - 1), bucket);
  if (!vistos.has(kFim) && out.length < limite) out.push(kFim);
  return out;
}

/** Variação percentual vs período anterior. `null` = sem base de comparação. */
export function delta(atual: number, anterior: number): number | null {
  if (!anterior) return null;
  return Math.round(((atual - anterior) / anterior) * 100);
}
