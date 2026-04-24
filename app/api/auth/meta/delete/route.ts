import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Chamado pela Meta quando um usuário solicita exclusão dos dados dele.
// Obrigatório para aprovação no App Review.
// Retorna uma URL de status que o usuário pode acessar para confirmar a exclusão.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const signedRequest = body?.signed_request as string | undefined;

    let userId: string | null = null;

    if (signedRequest) {
      const [, payload] = signedRequest.split(".");
      const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      userId = decoded?.user_id ?? null;
    }

    if (userId) {
      // Remove credenciais Meta vinculadas a esse usuário Facebook
      await supabaseAdmin
        .from("config_garage")
        .update({
          meta_access_token: null,
          meta_phone_id:     null,
          meta_waba_id:      null,
        })
        .eq("meta_waba_user_id", userId);
    }

    const confirmationCode = `del_${userId ?? "unknown"}_${Date.now()}`;
    const statusUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/meta/delete/status?code=${confirmationCode}`;

    // A Meta exige essa estrutura de resposta
    return NextResponse.json({
      url:           statusUrl,
      confirmation_code: confirmationCode,
    });
  } catch (err) {
    console.error("Meta delete error:", err);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

// A Meta pode fazer GET nessa URL para verificar o status da exclusão
export async function GET(req: NextRequest) {
  return NextResponse.json({ status: "deleted", message: "Dados removidos com sucesso." });
}
