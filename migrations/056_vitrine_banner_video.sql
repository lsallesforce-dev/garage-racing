-- 056: animação de fundo do banner da vitrine premium (APROVE Multimarcas)
--
-- `vitrine_tema` ganha `capa_video_url`: mp4 curto, MUDO, tocado em loop atrás
-- do banner. Quando ele existe, `capa_url` passa a ser o POSTER — o quadro que
-- aparece antes do vídeo carregar e o fallback de quem tem "reduzir movimento"
-- ligado no sistema.
--
-- O arquivo é asset estático da app (public/vitrine/), servido pelo CDN da
-- Vercel. Não vai pro Supabase Storage (regra do projeto) nem pro R2: R2 é pra
-- vídeo de VEÍCULO, que é grande, por tenant e enviado em runtime. Este é uma
-- arte de marca de 360 KB que versiona junto com o código. O campo aceita URL
-- absoluta, então trocar pra R2 depois não pede mudança de código.
--
-- Origem: clipe de 10s gerado por IA, entregue pelo Lucas em 08/09/2026. Foi
-- cortado (os primeiros ~4s tinham uma interface de site falsa alucinada pelo
-- gerador e um trecho vermelho fora da paleta), recortado na altura pra remover
-- a marca d'água do gerador, teve o áudio removido e ganhou crossfade no fim
-- pra emendar o loop. 3,3 MB → 360 KB.

UPDATE config_garage
   SET vitrine_tema = COALESCE(vitrine_tema, '{}'::jsonb) || jsonb_build_object(
         'capa_video_url', '/vitrine/aprove-banner.mp4',
         'capa_url',       '/vitrine/aprove-banner.jpg'
       )
 WHERE vitrine_slug = 'aprovemultimarcas';

-- Rollback (volta o banner pro gradiente da marca):
-- UPDATE config_garage
--    SET vitrine_tema = vitrine_tema - 'capa_video_url' - 'capa_url'
--  WHERE vitrine_slug = 'aprovemultimarcas';
