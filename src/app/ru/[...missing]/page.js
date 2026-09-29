import { MissingPage, notFoundMetadata } from "@/components/NotFound";

export const metadata = notFoundMetadata("ru");

// Any other /ru/… path: the localized 404, status 404 (see src/middleware.js).
export default function RuMissing() {
  return <MissingPage locale="ru" />;
}
