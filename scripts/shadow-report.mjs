// scripts/shadow-report.mjs
//
// Lê o resultado do SHADOW MODE da Fase 2: quem decide melhor "o cliente pediu
// mídia?", as 18 regras de regex do passo 11 ou o Gemini declarando `acoes`.
//
// Uso:  node scripts/shadow-report.mjs [dias]      (default 7)
//
// Critério de virada definido no plano: 7 dias corridos (cobre variação de dia
// da semana) com divergência abaixo de 5% dos turnos com mídia. Mas o número
// que realmente decide é a QUEBRA por tipo:
//
//   · regex PERDEU  → o cliente pediu e nada saiu. É o bug "Manda o material",
//                     e é o caso que o modelo resolveria de graça.
//   · regex EXAGEROU→ despejou mídia sem pedido. É a reclamação do Marcos
//                     ("Perguntei sobre retoque vc me enviou as fotos ?????").
//   · carro divergiu→ os dois querem mandar, mas de carros diferentes.
//
// Um número alto em PERDEU favorece a virada. Um número alto em EXAGEROU do
// LADO DO MODELO (modelo pedindo o que o regex não pediu, e o pedido sendo
// bobagem) favorece manter — por isso a amostra de mensagens no fim.

import fs from "fs";

const DIAS = Number(process.argv[2] ?? 7);
const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).replace(/^["']|["']$/g, "").trim()]; }),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local"); process.exit(1); }

const desde = new Date(Date.now() - DIAS * 86400e3).toISOString();
const res = await fetch(
  `${URL_}/rest/v1/alertas_operacionais?select=tenant_user_id,detalhe,criado_em&tipo=eq.shadow_diff&criado_em=gte.${desde}&order=criado_em.desc&limit=2000`,
  { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
);
const linhas = await res.json();
if (!Array.isArray(linhas)) { console.error("erro:", JSON.stringify(linhas).slice(0, 300)); process.exit(1); }

if (linhas.length === 0) {
  console.log(`Nenhuma divergência registrada nos últimos ${DIAS} dias.`);
  console.log("Ou o shadow ainda não rodou em tráfego real, ou regex e modelo concordam sempre.");
  console.log("Confira se há turnos com mídia no período antes de concluir que é acordo total.");
  process.exit(0);
}

const cat = (d) =>
  /regex NÃO pediu/.test(d) ? "regexPerdeu" :
  /modelo NÃO/.test(d) ? "regexExagerou" :
  /carro diferente/.test(d) ? "carroDivergiu" : "outro";

const porTenant = {};
for (const l of linhas) {
  const t = (porTenant[l.tenant_user_id] ??= { regexPerdeu: 0, regexExagerou: 0, carroDivergiu: 0, outro: 0, total: 0 });
  t[cat(l.detalhe)]++;
  t.total++;
}

console.log(`\nSHADOW MODE — últimos ${DIAS} dias — ${linhas.length} divergências\n`);
console.log("tenant     perdeu  exagerou  carro  total");
for (const [id, t] of Object.entries(porTenant)) {
  console.log(
    `${id.slice(0, 8)}   ${String(t.regexPerdeu).padStart(6)}  ${String(t.regexExagerou).padStart(8)}  ${String(t.carroDivergiu).padStart(5)}  ${String(t.total).padStart(5)}`,
  );
}

const tot = Object.values(porTenant).reduce(
  (a, t) => ({ regexPerdeu: a.regexPerdeu + t.regexPerdeu, regexExagerou: a.regexExagerou + t.regexExagerou, carroDivergiu: a.carroDivergiu + t.carroDivergiu }),
  { regexPerdeu: 0, regexExagerou: 0, carroDivergiu: 0 },
);

console.log(`\nO regex DEIXOU PASSAR pedido de mídia .... ${tot.regexPerdeu}`);
console.log(`O regex MANDOU sem o cliente pedir ...... ${tot.regexExagerou}`);
console.log(`Carro divergente ....................... ${tot.carroDivergiu}`);

console.log("\nAmostra (leia antes de decidir — o número sozinho não diz quem estava certo):");
for (const l of linhas.slice(0, 12)) console.log(`  [${cat(l.detalhe).padEnd(13)}] ${l.detalhe.slice(0, 110)}`);

console.log(
  "\nComo decidir: se PERDEU >> EXAGEROU, o modelo acerta onde a lista de palavras falha —",
  "\nvale inverter o turno (o executor passa a obedecer `acoes`). Se EXAGEROU for alto,",
  "\nleia a amostra: o modelo pode estar pedindo mídia em pergunta que não era pedido.",
);
