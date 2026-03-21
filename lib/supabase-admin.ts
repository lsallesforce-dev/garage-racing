import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// 🔍 SCANNER DO FLASH: Verificando se o Next.js está lendo o .env.local
console.log("--- TESTE DE IGNIÇÃO SUPABASE ---");
console.log("URL do Banco:", supabaseUrl ? "LIDA COM SUCESSO" : "🚨 VAZIA/UNDEFINED");
console.log("Chave Service:", supabaseServiceKey ? supabaseServiceKey.substring(0, 15) + "..." : "🚨 VAZIA/UNDEFINED");
console.log("---------------------------------");

// Admin client with service role key for bypassing RLS if necessary
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});