// Web pages (landing, setup guide) have one URL per language: /ru, /en,
// /ru/help, /en/help, each statically rendered in its language. The bare
// "/" and "/help" pick one for the visitor: ?lang= in the URL, then the
// visitor's earlier pick (LangSwitch, the app's TopBar), then, inside
// Telegram, the Telegram user's language, then the browser language: Russian
// for a Russian browser, English for any other (Ukrainian, Belarusian and
// Kazakh included). A Telegram launch of "/" is the member dashboard and
// stays.
export const LOCALES = ["ru", "en"];
const STORAGE_KEY = "achivator-lang";
// The Telegram user's language, not an explicit pick: kept for the rest of
// the Telegram session (sessionStorage) once the app has read it from the
// launch params (AppShell), so full page loads start in it too.
const TELEGRAM_KEY = "achivator-tg-lang";

// Web pages that exist in every locale, as the suffix after /ru or /en. The
// bare path (without a locale) redirects to the visitor's language.
export const PAGES = ["", "/help"];

// Section anchors carried the locale while one page held both languages
// (#ru-pricing, #en-wallet); the localized pages use the bare name
// (#pricing). Old links still arrive with the prefix, on "/" and "/help" and
// on the pages they redirected to (/ru#ru-pricing): see legacyAnchor().
const LEGACY_ANCHOR = /^#(ru|en)-/;

// The anchor of a localized page for a `location.hash`, without the old
// locale prefix; other hashes (including Telegram's launch params) unchanged.
export function legacyAnchor(hash) {
  return String(hash || "").replace(LEGACY_ANCHOR, "#");
}

// Runs before the first paint (see app/document.js, after LAUNCH_SCRIPT) so
// a redirect never flashes the fallback page and screens that serve both
// languages (<T>) show one from the start. It sets html[data-lang] only:
// <html lang> is the served page's own (the route's locale on /ru* and
// /en*, English elsewhere). On /ru* and /en* the route's locale wins;
// elsewhere data-lang comes from the preference and, on "/" (browser only)
// and "/help", the URL is replaced with the localized page (an old
// locale-prefixed anchor becomes the page's own, so the browser scrolls). The page is
// hidden while the browser navigates away (globals.css).
// Keep the preference order in sync with preferredLocale() below.
export const LOCALE_SCRIPT = `try{
var d=document.documentElement,p=location.pathname,s=new URLSearchParams(location.search),m=/^\\/(ru|en)(\\/|$)/.exec(p),l=m&&m[1];
if(!l){l=s.get("lang");
if(l!=="ru"&&l!=="en"){try{l=localStorage.getItem("${STORAGE_KEY}")}catch(e){}}
if(l!=="ru"&&l!=="en"){try{l=sessionStorage.getItem("${TELEGRAM_KEY}")}catch(e){}}
if(l!=="ru"&&l!=="en"){l=/^ru\\b/i.test(navigator.language||"")?"ru":"en"}}
d.dataset.lang=l;
var t=p==="/help"?"/help":p==="/"&&d.dataset.launch!=="telegram"?"":null;
if(t!==null){s.delete("lang");s=s.toString();d.dataset.redirect="";location.replace("/"+l+t+(s?"?"+s:"")+location.hash.replace(${LEGACY_ANCHOR},"#"))}
}catch(e){}`;

// The language the visitor asked for: ?lang= in the URL or a saved pick.
export function explicitLocale() {
  const fromUrl = new URLSearchParams(window.location.search).get("lang");
  if (LOCALES.includes(fromUrl)) return fromUrl;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LOCALES.includes(saved)) return saved;
  } catch {
    // storage blocked
  }
  return null;
}

// Same choice as LOCALE_SCRIPT, for client-side navigations to "/" or
// "/help", where the inline script does not run again.
export function preferredLocale() {
  let locale = explicitLocale();
  if (!locale) {
    try {
      locale = sessionStorage.getItem(TELEGRAM_KEY);
    } catch {
      // storage blocked
    }
  }
  if (!LOCALES.includes(locale)) locale = /^ru\b/i.test(navigator.language || "") ? "ru" : "en";
  return locale;
}

// Russian for a Russian-speaking Telegram user, English for anyone else.
export function telegramLocale(languageCode) {
  return /^ru\b/i.test(languageCode || "") ? "ru" : "en";
}

// Remembers the Telegram user's language for this Telegram session, without
// making it an explicit pick.
export function keepTelegramLocale(locale) {
  try {
    sessionStorage.setItem(TELEGRAM_KEY, locale);
  } catch {
    // storage blocked
  }
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
// Graph. metadataBase is in app/document.js.
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
