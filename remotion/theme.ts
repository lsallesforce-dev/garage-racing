// Tokens visuais do reel — espelham a capa do Kit de Postagem (lib/marketing-capa.tsx)
// pra manter identidade única entre post e vídeo. Ao mexer num, mexer no outro.

export const REEL = {
  width: 1080,
  height: 1920,
  fps: 30,
  bg: "#0B0B0F",
  bgFoto: "#16161C",
  branco: "#FFFFFF",
  brancoSuave: "rgba(255,255,255,0.88)",
  fonte: "Montserrat, sans-serif",
} as const;

export const DUR = {
  intro: 75,      // 2.5s — capa animada
  porClip: 66,    // 2.2s por take
  transicao: 12,  // crossfade entre cenas
  endcard: 96,    // 3.2s — CTA
} as const;
