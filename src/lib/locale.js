// Web pages (landing, setup guide) are bilingual: both languages are server
// rendered and CSS shows one (globals.css, [data-locale]). The choice is made
// before the first paint by LOCALE_SCRIPT (see layout.js) so the page stays
// static and never flashes the other language: ?lang= in the URL, then the
// visitor's earlier pick, then the browser language. Russian when unsure.
export const LOCALES = ["ru", "en"];
const STORAGE_KEY = "achivator-lang";

export const LOCALE_SCRIPT = `try{
var l=new URLSearchParams(location.search).get("lang");
if(l!=="ru"&&l!=="en"){try{l=localStorage.getItem("${STORAGE_KEY}")}catch(e){}}
if(l!=="ru"&&l!=="en"){l=/^(ru|uk|be|kk)\\b/i.test(navigator.language||"")?"ru":"en"}
document.documentElement.dataset.lang=l;document.documentElement.lang=l;
}catch(e){}`;

export function setLocale(locale) {
  document.documentElement.dataset.lang = locale;
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // storage blocked: the choice lasts for this page view
  }
}
