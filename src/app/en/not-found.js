import { LocaleNotFound, notFoundMetadata } from "@/components/NotFound";

export const metadata = notFoundMetadata("en");

export default function EnNotFound() {
  return <LocaleNotFound locale="en" />;
}
