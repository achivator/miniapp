import { MissingPage, notFoundMetadata } from "@/components/NotFound";

export const metadata = notFoundMetadata(null);

// Every path no other route matches (/ru… and /en… have their own): the
// bilingual 404, status 404 (see src/middleware.js), instead of Next's bare
// default, which the split into several root layouts would otherwise serve.
export default function Missing() {
  return <MissingPage locale={null} />;
}
