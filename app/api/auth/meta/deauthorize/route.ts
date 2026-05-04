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

// Chamado pela Meta quando um usuário desautoriza o app AutoZap.
// Remove as credenciais Meta do tenant correspondente.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const signedRequest = body?.signed_request as string | undefined;

    if (!signedRequest) {
      return NextResponse.json({ error: "signed_request ausente" }, { status: 400 });
    }

    const decoded = verifySignedRequest(signedRequest);
    if (!decoded) {
      console.warn("⛔ Meta deauthorize: assinatura inválida");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const userId: string | undefined = decoded?.user_id;
    if (userId) {
      await supabaseAdmin
        .from("config_garage")
        .update({ meta_access_token: null })
        .eq("meta_waba_user_id", userId);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Meta deauthorize error:", err);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
