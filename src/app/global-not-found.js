import { BilingualNotFound, notFoundMetadata } from "@/components/NotFound";
import { Document, metadata as site, viewport } from "./document";

export { viewport };

export const metadata = { ...site, ...notFoundMetadata(null) };

// Any URL no route matches (/ru… and /en… have their catch-alls, see
// src/middleware.js), dotted paths that are no file included (/foo.txt,
// /brand/nope.png): the bilingual 404, status 404, in a document of its own,
// since it renders in none of the root layouts. Needs
// experimental.globalNotFound (next.config.mjs).
export default function GlobalNotFound() {
  return (
    <Document lang="en">
      <BilingualNotFound />
    </Document>
  );
}
