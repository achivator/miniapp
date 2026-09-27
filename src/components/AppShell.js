"use client";

import { useEffect, useRef, useState } from "react";
import { SDKProvider, useBackButton, useHapticFeedback, useSDKContext, useThemeParams } from "@tma.js/sdk-react";
import { TonConnectButton, TonConnectUIProvider } from "@tonconnect/ui-react";
import Link from "next/link";
import { Medal } from "./icons";
import { Spinner } from "./ui";

const MANIFEST_URL = "https://achivator.cc/ton-connect.json";

function OpenInTelegram() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-8 text-center">
      <div className="hero-gradient flex h-20 w-20 items-center justify-center rounded-[26px] shadow-lg">
        <Medal className="h-11 w-11" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Achivator</h1>
        <p className="text-hint text-balance">
          Rewards and achievements for your Telegram chats. This is a Telegram Mini App — open it
          from the bot to continue.
        </p>
      </div>
      <a
        className="rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg active:opacity-80"
        href="https://t.me/achivator_bot/app"
      >
        Open in Telegram
      </a>
    </main>
  );
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

function Gate({ children }) {
  const { initResult, error, loading } = useSDKContext();
  if (initResult) {
    return (
      <>
        <ThemeSync />
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
  const [isClient, setIsClient] = useState(false);
  useEffect(() => setIsClient(true), []);
  if (!isClient) return null;

  return (
    <SDKProvider options={{ cssVars: true, acceptCustomStyles: true, async: true }}>
      <TonConnectUIProvider manifestUrl={MANIFEST_URL}>
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

export function TopBar() {
  return (
    <header
      className="sticky top-0 z-20 -mx-4 mb-1 flex items-center justify-between px-4 py-3 backdrop-blur-md"
      style={{ background: "color-mix(in srgb, var(--bg) 85%, transparent)" }}
    >
      <Link href="/" className="flex items-center gap-2" aria-label="Achivator home">
        <span className="hero-gradient flex h-8 w-8 items-center justify-center rounded-[10px]">
          <Medal className="h-[18px] w-[18px]" />
        </span>
        <span className="text-[17px] font-bold tracking-tight">Achivator</span>
      </Link>
      <TonConnectButton />
    </header>
  );
}

export function Screen({ children }) {
  return <main className="pb-safe mx-auto flex min-h-screen max-w-xl flex-col gap-5 px-4">{children}</main>;
}
