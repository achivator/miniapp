"use client";

import { useMemo, useSyncExternalStore } from "react";
import { LOCALES, explicitLocale, keepTelegramLocale, saveLocale, telegramLocale } from "./locale";
import {
  formatDate,
  formatDecimal,
  formatMoment,
  formatNumber,
  formatTime,
  formatUnits,
  plural,
  translateError,
} from "./i18n";

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

// Inside Telegram without an explicit pick (?lang=, the TopBar switch, the
// site's LangSwitch), the app follows the Telegram user's language rather
// than the browser's. Not saved as a pick: a later launch by a user with
// another Telegram language follows theirs.
export function applyTelegramLocale(languageCode) {
  if (!languageCode) return;
  const locale = telegramLocale(languageCode);
  keepTelegramLocale(locale);
  if (!explicitLocale()) document.documentElement.dataset.lang = locale;
}

// Everything a screen needs to speak the current language: L(ru, en), and
// numbers, amounts, dates, counts and API errors formatted for it.
export function useI18n() {
  const locale = useLocale();
  return useMemo(() => {
    const ru = locale === "ru";
    const num = (value) => formatNumber(value, locale);
    const word = (n, [one, few, many], [enOne, enOther]) => (ru ? plural(n, one, few, many) : n === 1 ? enOne : enOther);
    return {
      locale,
      L: (ruText, enText) => (ru ? ruText : enText),
      num,
      decimal: (text) => formatDecimal(text, locale),
      units: (raw, decimals) => formatUnits(raw, decimals, locale),
      date: (epochSec, options) => formatDate(epochSec, locale, options),
      moment: (epochSec) => formatMoment(epochSec, locale),
      time: (epochSec) => formatTime(epochSec, locale),
      // Word for a count: plural(n, ["балл", "балла", "баллов"], ["point", "points"]).
      plural: word,
      // A count with its word: count(3, ["чат", "чата", "чатов"], ["chat", "chats"]) -> "3 чата".
      count: (n, ruForms, enForms) => `${num(n)} ${word(n, ruForms, enForms)}`,
      // Points, the unit on every screen: "1 234 балла", "1,234 pts".
      pts: (n) => `${num(n)} ${ru ? plural(n, "балл", "балла", "баллов") : "pts"}`,
      error: (message) => translateError(message, locale),
    };
  }, [locale]);
}
