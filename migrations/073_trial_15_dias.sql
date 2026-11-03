-- Trial passa a ser 15 dias (decisão do Lucas, 20/10/2026).
-- O trigger de auth.users cria a config_garage já com trial_ends_at, e a rota
-- /api/onboarding/iniciar-trial só grava quando o campo está null — então era
-- este trigger (30 dias) que valia de verdade, não o TRIAL_DIAS da rota.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.config_garage (user_id, trial_ends_at)
  VALUES (NEW.id, now() + interval '15 days')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$;
