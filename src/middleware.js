import { NextResponse } from "next/server";
import { PAGES } from "@/lib/locale";
import { MISSING_HEADER } from "@/lib/not-found";

// Unknown URLs under /ru/ and /en/ get their locale's styled 404, with
// status 404. Other unknown URLs match no route and get the bilingual
// app/global-not-found.js, which is not told the URL and so cannot pick a
// language; and a notFound() call in the locale's catch-all ([...missing])
// still answers, on Next 15.5, with an empty error document (the 404 is
// drawn by client JS: crawlers and no-JS clients see nothing). So a path
// under /ru/ or /en/ that is none of the localized pages (PAGES in
// lib/locale.js, checked by test/not-found.test.js) is rewritten here to
// itself with status 404 and a marker header, and the catch-all renders the
// localized 404 as a normal page in its locale's layout; without the marker
// it falls back to notFound().
export function middleware(request) {
  const { pathname } = request.nextUrl;
  if (PAGES.includes(pathname.slice("/ru".length))) return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.set(MISSING_HEADER, "1");
  return NextResponse.rewrite(request.nextUrl, { status: 404, request: { headers } });
}

export const config = {
  matcher: ["/:locale(ru|en)/:path+"],
};
