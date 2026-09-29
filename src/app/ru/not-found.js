import { LocaleNotFound, notFoundMetadata } from "@/components/NotFound";

export const metadata = notFoundMetadata("ru");

export default function RuNotFound() {
  return <LocaleNotFound locale="ru" />;
}
