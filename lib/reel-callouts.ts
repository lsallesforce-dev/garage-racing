// Callouts do reel — opcionais do carro viram legendas curtas e vendáveis sobre
// os clipes. Módulo leve (sem deps de render) pra ser importado tanto pelo worker
// (reel-render) quanto pela rota de edição (reel-edit).

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

export function curtaOpcional(s: string): string {
  for (const [re, label] of PRETTY_OPCIONAL) if (re.test(s)) return label;
  let t = s.split("(")[0].split(/[,–-]/)[0].trim();
  const words = t.split(/\s+/);
  if (words.length > 3) t = words.slice(0, 3).join(" ");
  return t.toUpperCase();
}

// Precedência ÚNICA da legenda de um clipe. Existe pra que o preview do
// ReelEditor e o reel renderizado mostrem exatamente o mesmo texto — antes o
// cálculo estava duplicado em lib/reel-render.ts e em /api/marketing/reel-edit,
// e qualquer mudança num só dos lados fazia o preview mentir.
//
//   1. edição manual do vendedor (não-vazia) — ele digitou, manda
//   2. legenda gerada da ficha para AQUELE take (veiculos.marketing_callouts)
//   3. rodízio da lista geral de opcionais — SÓ pra take sem etiqueta
//   4. "" — sem legenda; o ClipScene não desenha o lower-third
//
// O passo 3 é o comportamento histórico e é ruim: distribui os opcionais por
// índice, então "BANCOS EM COURO" cai no clipe do porta-malas por sorte. Ele
// sobrevive apenas para o take LEGADO, que vem de video_takes sem tag e portanto
// não tem slot pra respeitar. Take etiquetado que a ficha não sustenta fica sem
// legenda — vazio é melhor que desconexo.
export function resolverCallout(
  opts: {
    manual?: string | null;
    tag?: string | null;
    idx: number;
    salvos?: { takes?: Record<string, { callout?: string; subCallout?: string }> } | null;
    lista: string[];
  }
): { callout: string; subCallout: string } {
  const manual = String(opts.manual ?? "").trim();
  if (manual) return { callout: manual.toUpperCase(), subCallout: "" };

  if (opts.tag) {
    const doTake = opts.salvos?.takes?.[opts.tag];
    return doTake?.callout
      ? { callout: doTake.callout.toUpperCase(), subCallout: doTake.subCallout ?? "" }
      : { callout: "", subCallout: "" };
  }

  const lista = opts.lista;
  return { callout: lista.length ? lista[opts.idx % lista.length] : "", subCallout: "" };
}

// Lista de callouts únicos (sem repetir) a partir dos opcionais → pontos fortes.
export function calloutsDoVeiculo(veiculo: any): string[] {
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
