import { MissingPage, notFoundMetadata } from "@/components/NotFound";

export const metadata = notFoundMetadata("en");

// Any other /en/… path: the localized 404, status 404 (see src/middleware.js).
export default function EnMissing() {
  return <MissingPage locale="en" />;
}
