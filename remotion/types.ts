// Props do reel — o que a rota/worker passa pro Remotion renderizar.
// Espelha os dados do veículo + config do tenant (mesma fonte da capa).

export interface ReelClip {
  src: string;              // URL do take (R2) ou vídeo bruto
  startFrom?: number;       // segundo de início do trecho aproveitado
  durationInFrames?: number;// duração da cena (default DUR.porClip)
  label?: string;           // rótulo do ângulo (ex.: "Interior", "Traseira")
}

export interface ReelProps {
  marca: string;
  modelo: string;
  versao: string;
  anoLabel: string;         // "2024/2025" já formatado
  specs: string[];          // ["Automático", "Prata", "Flex", "51.000 km"]
  preco: string | null;     // "R$ 124.900" ou null (mostrar_preco off)
  claim: string | null;
  loja: string;
  corPrimaria: string;
  capaUrl: string | null;   // fundo da intro (foto frente-3-4)
  logoUrl: string | null;
  whatsapp: string | null;  // exibido no endcard
  clips: ReelClip[];
  trilhaUrl: string | null;
}

export const REEL_PROPS_EXEMPLO: ReelProps = {
  marca: "Fiat",
  modelo: "Argo Drive",
  versao: "1.0",
  anoLabel: "2024/2025",
  specs: ["Automático", "Branco", "Flex", "37.209 km"],
  preco: "R$ 67.990",
  claim: "Pegamos seu carro na troca e financiamos a diferença",
  loja: "APROVE Multimarcas",
  corPrimaria: "#4B2CB3",
  capaUrl: null,
  logoUrl: null,
  whatsapp: "(17) 98152-4169",
  clips: [
    { label: "Frente" },
    { label: "Lateral" },
    { label: "Traseira" },
    { label: "Interior" },
  ],
  trilhaUrl: null,
};
