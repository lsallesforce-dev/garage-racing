// Props do reel — o que a rota/worker passa pro Remotion renderizar.
// Espelha os dados do veículo + config do tenant (mesma fonte da capa).

export type TipoTransicao = "fade" | "corte" | "deslizar" | "zoom" | "desfoque";

export interface ReelClip {
  src?: string;             // URL do take (R2) ou vídeo bruto; ausente = só no preview
  startFrom?: number;       // segundo de início do trecho aproveitado
  durationInFrames?: number;// duração da cena (default DUR.porClip)
  callout?: string;         // legenda sobre o take (editável; default = opcional)
}

export interface ReelProps {
  marca: string;
  modelo: string;
  versao: string;
  anoLabel: string;         // "2024/2025" já formatado
  specs: string[];          // ["Automático", "Prata", "Flex", "51.000 km"]
  opcionais: string[];      // callouts vendáveis sobre os clipes ("CÂMERA DE RÉ"...)
  preco: string | null;     // "R$ 124.900" ou null (mostrar_preco off)
  claim: string | null;
  loja: string;
  corPrimaria: string;
  capaUrl: string | null;   // fundo da intro (foto frente-3-4)
  capaW?: number | null;    // dimensões da foto → intro decide cover×contain
  capaH?: number | null;
  logoUrl: string | null;
  semMarca?: boolean;       // fotos já têm marca d'água → intro não sobrepõe logo/nome
  whatsapp: string | null;  // exibido no endcard
  clips: ReelClip[];
  transicao?: TipoTransicao;// transição entre cenas (default "fade")
  trilhaUrl: string | null;
}

export const REEL_PROPS_EXEMPLO: ReelProps = {
  marca: "Fiat",
  modelo: "Argo Drive",
  versao: "1.0",
  anoLabel: "2024/2025",
  specs: ["Automático", "Branco", "Flex", "37.209 km"],
  opcionais: ["CENTRAL MULTIMÍDIA", "CÂMERA DE RÉ", "AIRBAGS", "FARÓIS DE LED"],
  preco: "R$ 67.990",
  claim: "Pegamos seu carro na troca e financiamos a diferença",
  loja: "APROVE Multimarcas",
  corPrimaria: "#4B2CB3",
  capaUrl: null,
  logoUrl: null,
  whatsapp: "(17) 98152-4169",
  clips: [{}, {}, {}, {}],
  trilhaUrl: null,
};
