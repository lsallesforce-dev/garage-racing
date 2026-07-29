-- migrations/036_voz_agente.sql
--
-- Mensagens de voz do agente. A entrada já era multimodal (áudio do cliente →
-- transcrição), mas a saída era sempre texto. Em venda de carro por WhatsApp o
-- áudio é o formato que o vendedor humano usa — e o que mais derruba a suspeita
-- de "isso é robô".
--
-- OFF por padrão em todo tenant: voz muda o tom do atendimento e é decisão de
-- quem paga, não default nosso. Liga primeiro no tenant AutoZap pra validar.
--
-- voz_politica:
--   'espelho'             → só responde em áudio quando o LEAD mandou áudio.
--   'espelho_e_saudacao'  → o acima + a primeira resposta da conversa.

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS voz_habilitada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voz_politica   text    NOT NULL DEFAULT 'espelho',
  ADD COLUMN IF NOT EXISTS voz_id         text,
  ADD COLUMN IF NOT EXISTS voz_max_chars  integer NOT NULL DEFAULT 450;

DO $$
BEGIN
  ALTER TABLE config_garage
    ADD CONSTRAINT config_garage_voz_politica_check
    CHECK (voz_politica IN ('espelho', 'espelho_e_saudacao'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN config_garage.voz_habilitada IS 'Agente responde em nota de voz (OFF por padrão).';
COMMENT ON COLUMN config_garage.voz_politica   IS 'Quando mandar áudio: espelho | espelho_e_saudacao.';
COMMENT ON COLUMN config_garage.voz_id         IS 'voice_id da ElevenLabs; NULL usa ELEVENLABS_VOICE_ID do ambiente.';
COMMENT ON COLUMN config_garage.voz_max_chars  IS 'Acima disso a resposta vai em texto — ninguém ouve áudio longo.';

-- Consumo de TTS por tenant/mês, pra teto de custo (a ElevenLabs cobra por caractere).
CREATE TABLE IF NOT EXISTS voz_consumo (
  user_id    uuid    NOT NULL,
  competencia text   NOT NULL,           -- 'YYYY-MM'
  chars      integer NOT NULL DEFAULT 0,
  audios     integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, competencia)
);

ALTER TABLE voz_consumo ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY voz_consumo_owner ON voz_consumo
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Incremento atômico: o pipeline roda concorrente por lead, UPDATE lido-e-escrito perderia contagem.
CREATE OR REPLACE FUNCTION voz_consumo_add(p_user_id uuid, p_chars integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total integer;
BEGIN
  INSERT INTO voz_consumo (user_id, competencia, chars, audios)
  VALUES (p_user_id, to_char(now(), 'YYYY-MM'), p_chars, 1)
  ON CONFLICT (user_id, competencia) DO UPDATE
    SET chars = voz_consumo.chars + EXCLUDED.chars,
        audios = voz_consumo.audios + 1,
        updated_at = now()
  RETURNING chars INTO total;
  RETURN total;
END $$;
