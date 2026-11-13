import { type NextRequest, NextResponse } from "next/server";

/**
 * Public marketing pages carry their language in the address (/en/…, /fr/…). This passes it to the
 * root layout as a request header, so `<html lang>` matches the page whatever the visitor's cookie
 * or browser says.
 */
export function proxy(request: NextRequest) {
  const lang = request.nextUrl.pathname.split("/")[1];
  const headers = new Headers(request.headers);
  // Never trust a value sent by the client.
  headers.delete("x-tb-lang");
  if (lang === "en" || lang === "fr") headers.set("x-tb-lang", lang);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/en/:path*", "/fr/:path*"] };
