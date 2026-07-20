-- 033: Reel automatizado (marketing F2) — vídeo vertical montado dos takes
--   marketing_reel_url: MP4 final no R2
--   marketing_reel_status: null | "processando" | "pronto" | "erro"

ALTER TABLE veiculos
  ADD COLUMN IF NOT EXISTS marketing_reel_url text,
  ADD COLUMN IF NOT EXISTS marketing_reel_status text;
