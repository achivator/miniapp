import { LOCALES, PAGES, localeAlternates } from "@/lib/locale";

const SITE = "https://achivator.cc";

// The localized web pages; the bare "/" and "/help" only redirect to them.
// Sitemap URLs must be absolute (metadataBase does not apply here).
export default function sitemap() {
  const absolute = (languages) => Object.fromEntries(Object.entries(languages).map(([lang, path]) => [lang, SITE + path]));
  return PAGES.flatMap((page) =>
    LOCALES.map((locale) => ({
      url: `${SITE}/${locale}${page}`,
      changeFrequency: "monthly",
      priority: page === "" ? 1 : 0.8,
      alternates: { languages: absolute(localeAlternates(page)) },
    })),
  );
}
