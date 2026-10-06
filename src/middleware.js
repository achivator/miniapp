import { NextResponse } from "next/server";
import { PAGES } from "@/lib/locale";
import { MISSING_HEADER } from "@/lib/not-found";
import { isTonSiteHost, tonSiteTarget } from "@/lib/ton-site";

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
//
// Requests for achivator.ton, the TON Site, go to the Mini App (lib/ton-site.js)
// with 302: a permanent redirect would be cached by Telegram's TON gateway.
export function middleware(request) {
  if (isTonSiteHost(request.headers.get("host"))) {
    return NextResponse.redirect(tonSiteTarget(request.nextUrl.searchParams), 302);
  }
  const { pathname } = request.nextUrl;
  if (!LOCALIZED_SUBPATH.test(pathname)) return NextResponse.next();
  if (PAGES.includes(pathname.slice("/ru".length))) return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.set(MISSING_HEADER, "1");
  return NextResponse.rewrite(request.nextUrl, { status: 404, request: { headers } });
}

// What the 404 rewrite applies to: a path under /ru/ or /en/.
const LOCALIZED_SUBPATH = /^\/(?:ru|en)\/./;

// Every request but Next's build assets, so achivator.ton is redirected
// whatever its path.
export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
