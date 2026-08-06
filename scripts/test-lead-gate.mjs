// scripts/test-lead-gate.mjs
//
// Testa o classificador de lead (lib/lead-gate.ts) contra mensagens reais.
// Le o PROMPT direto do lib pra nao divergir. Rodar da RAIZ do projeto:
//   GEMINI_API_KEY=<chave valida> node scripts/test-lead-gate.mjs
// (a chave do .env.local local esta invalida — usar a da Vercel)
import fs from "node:fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
const env = fs.readFileSync(".env.local","utf8");
const key = process.env.GEMINI_API_KEY || env.match(/^GEMINI_API_KEY=(.+)$/m)[1].trim();
const src = fs.readFileSync("lib/lead-gate.ts","utf8");
const PROMPT = src.split("const PROMPT = `")[1].split("`;")[0];
const model = new GoogleGenerativeAI(key).getGenerativeModel({ model: "gemini-2.5-flash" }, { apiVersion: "v1beta" });
const casos = [
  "Fiat Strada Endurance 2023",
  "GM - Chevrolet ONIX SED. 2024",
  "Boa tarde",
  "Boa tarde Marcos adiciona um conhecido meu que meche com.  Carro tbm \n\n17991980280 Renato .",
  "ainda tem aquele uno branco? qual o valor",
  "manda foto do toro",
  "oi amor, passa no mercado na volta",
  "Bom dia! Aqui e o Joao da oficina, a peca do seu carro chegou",
  "tenho um corolla 2019 pra repassar, te interessa?",
  "vi seu anuncio, aceita troca?",
  "PROMOCAO IMPERDIVEL clique aqui www.bit.ly/xx",
  "e ai mano, bora jogar bola sabado?",
];
for (const c of casos) {
  const r = await model.generateContent(PROMPT + JSON.stringify(c));
  const raw = r.response.text().replace(/```json|```/g,"").trim();
  let p; try { p = JSON.parse(raw); } catch { p = { erro: raw.slice(0,60) }; }
  const libera = p.lead === true && Number(p.confianca) >= 0.8;
  console.log(`${libera ? "IA RESPONDE " : "fica MUDA   "} conf=${p.confianca ?? "?"} lead=${p.lead}  << ${c.replace(/\n/g," ").slice(0,60)}`);
}
