// Replay dos 8 disparos reais do passo 10b (60 dias até 08/10/2026) + casos óbvios.
// Rodar: npx tsx scripts/replay-conversa-encerrada.ts
import { clienteEncerrouConversa } from "../lib/conversa-encerrada";

const casos: [string, boolean][] = [
  // reais — falsos positivos da regra antiga
  ["Olá! Posso ter mais informações sobre isso?\nComprei um Civic.", false],
  ["Comprei um Civic.", false],
  ["A vista sem troca qual é o menor preço\nNão tira nada nesse preço o zero me ofereceram por 86.000\nObrigado mas nesse preço não tenho interesse fizer alguma condição melhor eu sou comprador", false],
  ["Obrigado mas nesse preço não tenho interesse fizer alguma condição melhor eu sou comprador", false],
  ["Gostaria de Mobi *completo* ou outra opção Fiat  carro popular...\nNão tenho interesse no uno", false],
  ["Não tenho interesse no uno", false],
  ["Se vocês souberem de algum, vocês me dão um toque, porque eu comprei um em 2019.", false],
  // reais — encerramento de verdade
  ["Não tenho interesse", true],
  ["obrigado ja comprei de terceiro\nok\neu ja comprei outro", true],
  // óbvios
  ["já comprei, obrigado", true],
  ["Já fechei negócio em outra loja", true],
  ["desisti", true],
  ["não tenho mais interesse, obrigado", true],
  ["comprei um carro ano passado e quero trocar", false],
  ["já comprei com vocês uma vez, tem algum Corolla?", false],
];

let falhas = 0;
for (const [txt, esperado] of casos) {
  const r = clienteEncerrouConversa(txt);
  if (r !== esperado) falhas++;
  console.log(`${r === esperado ? "ok  " : "ERRO"} ${String(r).padEnd(5)} ${JSON.stringify(txt.slice(0, 90))}`);
}
console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
