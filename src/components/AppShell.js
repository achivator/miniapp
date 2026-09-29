"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SDKProvider, useBackButton, useHapticFeedback, useSDKContext, useSettingsButton, useThemeParams } from "@tma.js/sdk-react";
import { TonConnectButton, TonConnectUIProvider, useTonConnectUI } from "@tonconnect/ui-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LOCALES } from "@/lib/locale";
import { applyTelegramLocale, setAppLocale, useI18n, useLocale } from "@/lib/use-locale";
import { Medal, Question } from "./icons";
import { Spinner } from "./ui";

const MANIFEST_URL = "https://achivator.cc/ton-connect.json";

function OpenInTelegram() {
  const { L, locale } = useI18n();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-8 text-center">
      <div className="absolute right-4 top-4">
        <AppLangSwitch />
      </div>
      <div className="hero-gradient flex h-20 w-20 items-center justify-center rounded-[26px] shadow-lg">
        <Medal className="h-11 w-11" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Achivator</h1>
        <p className="text-hint text-balance">
          {L(
            "Награды и ачивки для Telegram-чатов. Это мини-приложение Telegram — откройте его из бота, чтобы продолжить.",
            "Rewards and achievements for your Telegram chats. This is a Telegram Mini App — open it from the bot to continue.",
          )}
        </p>
      </div>
      <a
        className="rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg active:opacity-80"
        href="https://t.me/achivator_bot/app"
      >
        {L("Открыть в Telegram", "Open in Telegram")}
      </a>
      <div className="flex flex-col items-center gap-2">
        <Link href={`/${locale}`} className="text-[15px] font-medium text-link">
          {L("Что такое Achivator →", "What is Achivator? →")}
        </Link>
        <Link href={`/${locale}/help`} className="text-[15px] font-medium text-link">
          {L("Как подключить свой чат →", "Connect your chat →")}
        </Link>
      </div>
    </main>
  );
}

// The app screens' language as <html lang> (the served HTML says "en"): for
// screen readers, hyphenation and the browser's translate offer. Only while
// an app screen is shown; the web pages keep the language they were served in.
function HtmlLang() {
  const locale = useLocale();
  useEffect(() => {
    const root = document.documentElement;
    const served = root.lang;
    root.lang = locale;
    return () => {
      root.lang = served;
    };
  }, [locale]);
  return null;
}

// TON Connect's own texts (button, wallet list) in the app's language.
function TonConnectLanguage() {
  const locale = useLocale();
  const [, setOptions] = useTonConnectUI();
  useEffect(() => {
    setOptions({ language: locale });
  }, [locale, setOptions]);
  return null;
}

// Mirrors Telegram's light/dark choice onto <html data-theme>.
function ThemeSync() {
  const themeParams = useThemeParams();
  const isDark = themeParams.isDark;
  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
  }, [isDark]);
  return null;
}

// "Settings" item of Telegram's mini app menu (⋯), opening the setup guide.
// Same copy-per-change caveat as useTelegramBack: keep the latest in a ref.
function HelpMenuItem() {
  const settingsButton = useSettingsButton();
  const ref = useRef(settingsButton);
  ref.current = settingsButton;
  const router = useRouter();
  const locale = useLocale();
  useEffect(() => {
    const button = ref.current;
    // Straight to the guide in the app's language ("/help" would pick one
    // by the browser's).
    const onClick = () => router.push(`/${locale}/help`);
    safely(() => button.show());
    button.on("click", onClick);
    return () => button.off("click", onClick);
  }, [router, locale]);
  return null;
}

function Gate({ children }) {
  const { initResult, error, loading } = useSDKContext();
  // The Telegram user's language, unless the visitor picked one; before the
  // screen paints (the spinner has no text to flash).
  useLayoutEffect(() => {
    if (initResult) applyTelegramLocale(initResult.initData?.user?.languageCode);
  }, [initResult]);
  if (initResult) {
    return (
      <>
        <ThemeSync />
        <HelpMenuItem />
        {children}
      </>
    );
  }
  if (error && !loading) return <OpenInTelegram />;
  return (
    <main className="flex min-h-screen items-center justify-center">
      <Spinner className="h-7 w-7 text-hint" />
    </main>
  );
}

// Client-only providers: the Telegram SDK and TON Connect both need `window`.
export function AppShell({ children }) {
  const locale = useLocale();
  const [isClient, setIsClient] = useState(false);
  useEffect(() => setIsClient(true), []);
  if (!isClient) return null;

  return (
    <SDKProvider options={{ cssVars: true, acceptCustomStyles: true, async: true }}>
      <TonConnectUIProvider manifestUrl={MANIFEST_URL} language={locale}>
        <HtmlLang />
        <TonConnectLanguage />
        <Gate>{children}</Gate>
      </TonConnectUIProvider>
    </SDKProvider>
  );
}

// Runs a Telegram bridge call; outside Telegram (or on clients lacking the
// method) the SDK throws, which must never take the screen down.
function safely(fn) {
  try {
    fn();
  } catch {
    // no Telegram environment
  }
}

// Telegram's native back button; hidden on the root screen. useBackButton()
// returns a fresh copy after every show/hide ("change" event), so it must not
// be an effect dependency: show() -> new copy -> cleanup hide() -> show()...
// would loop forever. The copies share state, so the latest one is enough.
export function useTelegramBack(enabled) {
  const backButton = useBackButton();
  const ref = useRef(backButton);
  ref.current = backButton;
  useEffect(() => {
    const button = ref.current;
    if (!enabled) {
      safely(() => button.hide());
      return undefined;
    }
    const onClick = () => window.history.back();
    safely(() => button.show());
    button.on("click", onClick);
    return () => {
      button.off("click", onClick);
      safely(() => button.hide());
    };
  }, [enabled]);
}

// Notification haptics; a no-op on clients that do not support them.
export function useHaptic() {
  const haptic = useHapticFeedback();
  return (type) => safely(() => haptic.notificationOccurred(type));
}

// Compact language toggle of the app screens: shows the other language and
// switches to it in place, remembering the pick (the web pages' LangSwitch
// links /ru and /en instead). One round button, like the guide's, so the
// TopBar still fits a 360px screen next to TON Connect's button.
export function AppLangSwitch() {
  const locale = useLocale();
  const other = LOCALES.find((option) => option !== locale);
  return (
    <button
      type="button"
      lang={other}
      onClick={() => setAppLocale(other)}
      aria-label={other === "ru" ? "Переключить на русский" : "Switch to English"}
      title={other === "ru" ? "Русский" : "English"}
      className="tint-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold uppercase text-accent active:opacity-80"
    >
      {other}
    </button>
  );
}

export function TopBar() {
  const { L, locale } = useI18n();
  return (
    <header
      className="sticky top-0 z-20 -mx-4 mb-1 flex items-center justify-between gap-2 px-4 py-3 backdrop-blur-md"
      style={{ background: "color-mix(in srgb, var(--bg) 85%, transparent)" }}
    >
      {/* The wordmark gives way to TON Connect's button on narrow screens, and
          the logo too on the narrowest (Telegram's back button and the
          dashboard's own content lead home there). */}
      <Link
        href="/"
        className="flex shrink-0 items-center gap-2 max-[379px]:hidden"
        aria-label={L("Achivator — на главную", "Achivator home")}
      >
        <span className="hero-gradient flex h-8 w-8 items-center justify-center rounded-[10px]">
          <Medal className="h-[18px] w-[18px]" />
        </span>
        <span className="text-[17px] font-bold tracking-tight max-[439px]:hidden">Achivator</span>
      </Link>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <AppLangSwitch />
        <Link
          href={`/${locale}/help`}
          className="tint-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-accent active:opacity-80"
          aria-label={L("Как подключить чат", "Setup guide")}
        >
          <Question className="h-5 w-5" />
        </Link>
        <TonConnectButton />
      </div>
    </header>
  );
}

export function Screen({ children }) {
  return <main className="pb-safe mx-auto flex min-h-screen max-w-xl flex-col gap-5 px-4">{children}</main>;
}
