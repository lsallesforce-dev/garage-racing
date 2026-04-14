import { NextRequest, NextResponse } from "next/server";

// Injeta o pathname atual como header para que Server Layouts possam lê-lo.
// Necessário para proteger rotas de vendedores no MainLayout.
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("x-pathname", request.nextUrl.pathname);
  return response;
}

export const config = {
  matcher: [
    // Aplica em todas as rotas exceto assets estáticos e API routes internas do Next
    "/((?!_next/static|_next/image|favicon.ico|icon.png).*)",
  ],
};
