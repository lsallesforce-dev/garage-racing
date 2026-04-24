import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Chamado pela Meta quando um usuário desautoriza o app AutoZap.
// Remove as credenciais Meta do tenant correspondente.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const signedRequest = body?.signed_request as string | undefined;

    if (signedRequest) {
      // Decodifica o payload (base64url — não precisa verificar assinatura para deauth)
      const [, payload] = signedRequest.split(".");
      const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      const userId: string | undefined = decoded?.user_id;

      if (userId) {
        // Remove token Meta do tenant que desautorizou
        await supabaseAdmin
          .from("config_garage")
          .update({ meta_access_token: null })
          .eq("meta_waba_user_id", userId);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Meta deauthorize error:", err);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
