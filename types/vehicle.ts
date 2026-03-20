export interface Vehicle {
  id: string;
  marca: string;
  modelo: string;
  versao?: string;
  ano_fabricacao?: number;
  ano_modelo?: number;
  cor?: string;
  quilometragem_estimada?: number;
  combustivel?: string;
  preco_sugerido: number;
  opcionais?: string[];
  pontos_fortes_venda?: string[];
  detalhes_inspecao?: string;
  transcricao_vendedor?: string;
  tags_busca?: string;
  video_url?: string;
  embedding?: number[];
  created_at?: string;
  vendedor_id: string;
}
