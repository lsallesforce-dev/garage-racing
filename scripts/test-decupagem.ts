// scripts/test-decupagem.ts
//
// Smoke test da decupagem contra um vídeo LOCAL. Não escreve no banco nem no R2:
// roda só a análise (fim do conteúdo → cortes → Gemini → casamento em ordem) e
// imprime o que caiu em cada slot.
//
//   npm run test:decupagem -- "C:/Users/lsaud/Downloads/Tucsom/Takes padrão.mp4"
//
// O caso de referência é o próprio "Takes padrão.mp4", onde a resposta certa é
// conhecida (a shot list foi decupada dele à mão) — o script compara o que o
// classificador achou com os refInicio/refFim da shot list e reporta o desvio.
// Vale rodar também nos vídeos crus de WhatsApp da mesma pasta, que é onde o
// modo proporcional entra e a precisão cai.

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import path from "path";
import os from "os";
import { promises as fs } from "fs";
import { SHOT_TAKES } from "../lib/marketing-shotlist";

type DecupMod = typeof import("../lib/take-decupagem");

async function main() {
  const arquivo = process.argv[2];
  if (!arquivo) {
    console.error('Uso: npm run test:decupagem -- "<caminho do vídeo>"');
    process.exit(1);
  }
  await fs.access(arquivo);

  const { analisarVideo }: DecupMod = await import("../lib/take-decupagem");

  const dir = path.join(os.tmpdir(), `decup_test_${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });

  try {
    const t0 = Date.now();
    const a = await analisarVideo(arquivo, dir);
    const seg = ((Date.now() - t0) / 1000).toFixed(1);

    console.log(`\n📹 ${path.basename(arquivo)}`);
    console.log(`   ${a.duracao.toFixed(1)}s de arquivo · ${a.fimConteudo.toFixed(1)}s de conteúdo` +
      (a.duracao - a.fimConteudo > 1 ? `  (${(a.duracao - a.fimConteudo).toFixed(1)}s de preto descartados ✂️)` : ""));
    console.log(`   ${a.segmentos.length} trecho(s) · modo ${a.modo} · análise em ${seg}s`);
    console.log("─".repeat(78));

    // Verdade conhecida: só vale pro vídeo modelo, de onde a shot list saiu.
    const ehModelo = /takes\s*padr/i.test(path.basename(arquivo));
    let acertos = 0;
    let comTag = 0;

    for (const [i, { tag, confianca }] of [...a.casados.entries()].sort((x, y) => x[0] - y[0])) {
      const s = a.segmentos[i];
      const shot = SHOT_TAKES.find((x) => x.tag === tag)!;
      comTag++;

      let veredito = "";
      if (ehModelo && shot.refInicio != null) {
        // Acerto = o trecho encontrado se sobrepõe à janela conhecida da shot list.
        const sobrepoe = s.inicio < (shot.refFim ?? 0) && s.fim > shot.refInicio;
        if (sobrepoe) { acertos++; veredito = "✅"; }
        else veredito = `❌ esperado ${shot.refInicio}s→${shot.refFim}s`;
      }

      console.log(
        `${veredito.startsWith("❌") ? "❌" : "  "} ${`${s.inicio.toFixed(1)}→${s.fim.toFixed(1)}s`.padStart(14)}  ` +
          `${shot.label.padEnd(28)} conf ${confianca.toFixed(2)}  ${veredito.startsWith("❌") ? veredito : ""}`
      );
    }

    const semTag = SHOT_TAKES.filter((s) => ![...a.casados.values()].some((c) => c.tag === s.tag));
    console.log("─".repeat(78));
    console.log(`   ${comTag}/${SHOT_TAKES.length} slots preenchidos`);
    if (semTag.length) console.log(`   vazios: ${semTag.map((s) => s.label).join(" · ")}`);
    if (ehModelo) {
      const pct = comTag ? Math.round((acertos / comTag) * 100) : 0;
      console.log(`   ${acertos}/${comTag} caíram na janela certa (${pct}%)`);
      if (pct < 60) { console.error("🚨 acurácia abaixo de 60% no próprio vídeo de referência"); process.exit(1); }
    }

    // A ordem tem que ser sempre a narrativa — é o que a DP monotônica garante.
    const ordem = SHOT_TAKES.map((s) => s.tag);
    const saida = [...a.casados.entries()].sort((x, y) => x[0] - y[0]).map(([, c]) => ordem.indexOf(c.tag));
    const crescente = saida.every((v, i) => i === 0 || v > saida[i - 1]);
    console.log(`   ordem narrativa preservada: ${crescente ? "sim ✅" : "NÃO 🚨"}`);
    if (!crescente) process.exit(1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => {
  console.error("❌", e?.message ?? e);
  process.exit(1);
});
