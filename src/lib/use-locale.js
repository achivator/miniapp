"use client";

import { useSyncExternalStore } from "react";
import { LOCALES, saveLocale } from "./locale";

// Language of the app screens (dashboard, pool, achievements): the same
// html[data-lang] that LOCALE_SCRIPT sets before the first paint (see
// lib/locale.js for the preference order) and <T> reads through CSS. Client
// components read it with useLocale() / useL() and re-render when
// setAppLocale() changes it; texts sit next to their translation, as on the
// landing page: L("Забрать", "Claim").

function subscribe(onChange) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-lang"] });
  return () => observer.disconnect();
}

function currentLocale() {
  return document.documentElement.dataset.lang === "ru" ? "ru" : "en";
}

// The server renders app screens in English; after hydration React switches
// to the visitor's language (useSyncExternalStore re-renders, no mismatch).
export function useLocale() {
  return useSyncExternalStore(subscribe, currentLocale, () => "en");
}

// L(ru, en) picks the text for the current language.
export function useL() {
  const locale = useLocale();
  return (ru, en) => (locale === "ru" ? ru : en);
}

// Switches the app screens' language and remembers it for next time (also
// for "/" and "/help", which redirect by the same saved choice).
export function setAppLocale(locale) {
  if (!LOCALES.includes(locale)) return;
  document.documentElement.dataset.lang = locale;
  saveLocale(locale);
}
