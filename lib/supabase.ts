import { createBrowserClient } from "@supabase/ssr";

// Usado em componentes cliente ("use client").
// O createBrowserClient lê os cookies de sessão automaticamente
// e envia o JWT em cada request — necessário para o RLS funcionar.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
