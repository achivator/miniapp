// Web pages (landing, setup guide) have one URL per language: /ru, /en,
// /ru/help, /en/help, each statically rendered in its language. The bare
// "/" and "/help" pick one for the visitor: ?lang= in the URL, then the
// visitor's earlier pick (LangSwitch), then the browser language, Russian
// when unsure. A Telegram launch of "/" is the member dashboard and stays.
export const LOCALES = ["ru", "en"];
const STORAGE_KEY = "achivator-lang";

// Web pages that exist in every locale, as the suffix after /ru or /en. The
// bare path (without a locale) redirects to the visitor's language.
export const PAGES = ["", "/help"];

// Runs before the first paint (see layout.js, after LAUNCH_SCRIPT) so a
// redirect never flashes the fallback page and screens that serve both
// languages (<T>) show one from the start. On /ru* and /en* the route's
// locale wins; elsewhere it sets html[data-lang] from the preference and, on
// "/" (browser only) and "/help", replaces the URL with the localized page.
// The page is hidden while the browser navigates away (globals.css).
// Keep the preference order in sync with preferredLocale() below.
export const LOCALE_SCRIPT = `try{
var d=document.documentElement,p=location.pathname,s=new URLSearchParams(location.search),m=/^\\/(ru|en)(\\/|$)/.exec(p),l=m&&m[1];
if(!l){l=s.get("lang");
if(l!=="ru"&&l!=="en"){try{l=localStorage.getItem("${STORAGE_KEY}")}catch(e){}}
if(l!=="ru"&&l!=="en"){l=/^(ru|uk|be|kk)\\b/i.test(navigator.language||"")?"ru":"en"}}
d.dataset.lang=l;d.lang=l;
var t=p==="/help"?"/help":p==="/"&&d.dataset.launch!=="telegram"?"":null;
if(t!==null){s.delete("lang");s=s.toString();d.dataset.redirect="";location.replace("/"+l+t+(s?"?"+s:"")+location.hash)}
}catch(e){}`;

// Same choice as LOCALE_SCRIPT, for client-side navigations to "/" or
// "/help", where the inline script does not run again.
export function preferredLocale() {
  let locale = new URLSearchParams(window.location.search).get("lang");
  if (!LOCALES.includes(locale)) {
    try {
      locale = localStorage.getItem(STORAGE_KEY);
    } catch {
      // storage blocked
    }
  }
  if (!LOCALES.includes(locale)) locale = /^(ru|uk|be|kk)\b/i.test(navigator.language || "") ? "ru" : "en";
  return locale;
}

// Remembers an explicit pick, so "/" opens it next time.
export function saveLocale(locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // storage blocked: the URL still carries the choice
  }
}

// hreflang alternates of a page: every locale, and the bare path (which
// redirects by the visitor's language) as x-default.
export function localeAlternates(page) {
  return {
    ...Object.fromEntries(LOCALES.map((locale) => [locale, `/${locale}${page}`])),
    "x-default": page || "/",
  };
}

// Per-locale page metadata: canonical URL, hreflang alternates and Open
// Graph. metadataBase is in layout.js.
export function localeMetadata({ locale, page, title, description }) {
  const url = `/${locale}${page}`;
  return {
    title,
    description,
    alternates: { canonical: url, languages: localeAlternates(page) },
    openGraph: {
      title,
      description,
      url,
      siteName: "Achivator",
      locale: locale === "en" ? "en_US" : "ru_RU",
      alternateLocale: locale === "en" ? ["ru_RU"] : ["en_US"],
      type: "website",
      images: [{ url: "/metadata/achivator-collection.jpg", width: 512, height: 512 }],
    },
  };
}
