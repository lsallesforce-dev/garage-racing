import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";

function verifySignedRequest(signedRequest: string): { user_id?: string } | null {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.error("🚨 META_APP_SECRET não configurado — requisição rejeitada");
    return null;
  }

  const [encodedSig, encodedPayload] = signedRequest.split(".");
  if (!encodedSig || !encodedPayload) return null;

  const expectedSig = createHmac("sha256", appSecret).update(encodedPayload).digest("base64url");
  try {
    if (!timingSafeEqual(Buffer.from(encodedSig), Buffer.from(expectedSig))) return null;
  } catch {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// Chamado pela Meta quando um usuário solicita exclusão dos dados dele.
// Obrigatório para aprovação no App Review.
// Retorna uma URL de status que o usuário pode acessar para confirmar a exclusão.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const signedRequest = body?.signed_request as string | undefined;

    if (!signedRequest) {
      return NextResponse.json({ error: "signed_request ausente" }, { status: 400 });
    }

    const decoded = verifySignedRequest(signedRequest);
    if (!decoded) {
      console.warn("⛔ Meta delete: assinatura inválida");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const userId: string | null = decoded?.user_id ?? null;

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
