// lib/repasse-agenda.ts
//
// Agenda PREVISTA do fluxo de repasse em grupo (página "Fluxo Grupo").
// O cron envia na ordem determinística do rodízio (carro há mais tempo sem sair
// primeiro, pulando pausados). Como a ordem é fixa, dá pra CALCULAR o horário
// que cada carro vai sair — é o que esta lib faz, pra exibir no board.
//
// Fuso: o Brasil não tem mais horário de verão desde 2019, então BRT = UTC-3
// constante. Trabalhamos numa "Date em espaço BRT" (getUTC* já devolve valores
// BRT) e convertemos pro instante real (UTC) na saída.

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
const toBrt = (d: Date) => new Date(d.getTime() - BRT_OFFSET_MS);
const fromBrt = (brt: Date) => new Date(brt.getTime() + BRT_OFFSET_MS);

export interface AgendaCfg {
  intervaloMin: number;
  janelaInicio: number;      // hora BRT que a janela abre (inclusive)
  janelaFim: number;         // hora BRT que fecha em dia útil (exclusive)
  janelaFimSabado: number;   // hora BRT que fecha no sábado (lojas fecham ao meio-dia)
  qtdPorEnvio: number;       // carros por slot
}

// Avança (em espaço BRT) até o próximo instante VÁLIDO de envio: dentro da
// janela do dia, pulando domingo (cron roda seg–sáb) e respeitando o fim de
// sábado. Se já é válido, devolve como está.
function proximoSlotBrt(brt: Date, cfg: AgendaCfg): Date {
  let d = new Date(brt);
  for (let guard = 0; guard < 400; guard++) {
    const hora = d.getUTCHours();
    const dow = d.getUTCDay(); // 0 = domingo
    const fim = dow === 6 ? cfg.janelaFimSabado : cfg.janelaFim;
    const abreProximoDia = () =>
      new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, cfg.janelaInicio, 0, 0, 0));

    if (dow === 0) { d = abreProximoDia(); continue; }       // domingo → segunda 8h
    if (hora < cfg.janelaInicio) {                            // antes de abrir → abre hoje
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), cfg.janelaInicio, 0, 0, 0));
      continue;
    }
    if (hora >= fim) { d = abreProximoDia(); continue; }      // depois de fechar → abre amanhã
    return d;
  }
  return d;
}

/**
 * Horário previsto de cada carro, na ordem recebida (rodízio: mais antigo → mais
 * novo). `base` = a partir de quando o próximo envio pode acontecer
 * (max(último_envio + intervalo, agora)). qtdPorEnvio carros compartilham o slot.
 */
export function computarAgenda(carrosOrdenados: string[], base: Date, cfg: AgendaCfg): Map<string, Date> {
  const out = new Map<string, Date>();
  const qtd = Math.max(1, cfg.qtdPorEnvio || 1);
  const intervalo = Math.max(1, cfg.intervaloMin || 120);

  let slot = proximoSlotBrt(toBrt(base), cfg);
  let i = 0;
  while (i < carrosOrdenados.length) {
    for (let j = 0; j < qtd && i < carrosOrdenados.length; j++, i++) {
      out.set(carrosOrdenados[i], fromBrt(slot));
    }
    slot = proximoSlotBrt(new Date(slot.getTime() + intervalo * 60_000), cfg);
  }
  return out;
}

/** A partir de quando o próximo envio pode sair, dado o último envio real. */
export function baseDoProximoEnvio(ultimoEnvio: Date | null, intervaloMin: number, agora: Date): Date {
  if (!ultimoEnvio) return agora;
  const liberado = new Date(ultimoEnvio.getTime() + Math.max(1, intervaloMin) * 60_000);
  return liberado > agora ? liberado : agora;
}
