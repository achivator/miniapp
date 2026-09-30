import { NextResponse } from "next/server";
import { MISSING_HEADER } from "@/lib/not-found";
import { isFile, isPage } from "@/lib/pages";

// Unknown URLs get the site's styled 404 with status 404. Next 14.2 cannot
// do that alone with several root layouts: notFound() answers 404 but with an
// empty error document (the 404 is drawn by client JS, without the
// stylesheet link), and a root app/not-found.js needs a single root layout.
// So a path that is none of the app's pages is rewritten here to itself with
// status 404 and a marker header: the catch-all pages ([...missing] in
// app/(app), app/ru, app/en) then render the 404 as a normal page, in their
// layout. Without the marker they fall back to notFound().
//
// Paths with a dot are files (public/, favicon.ico, robots.txt, sitemap.xml)
// or nothing at all (/foo.txt): the same styled 404 for the latter.
//
// The lists of page routes and files live in lib/pages.js (checked by a
// test). /api/ has its own JSON 404 (app/api/[...missing]).

export function middleware(request) {
  const { pathname } = request.nextUrl;
  if (isPage(pathname) || isFile(pathname)) return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.set(MISSING_HEADER, "1");
  return NextResponse.rewrite(request.nextUrl, { status: 404, request: { headers } });
}

// API routes and Next's assets answer for themselves.
export const config = {
  matcher: ["/((?!api/|_next/).*)"],
};
