"use client";

import { useLayoutEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isTelegramLaunch } from "@/lib/launch";
import { LOCALES, preferredLocale } from "@/lib/locale";
import { Medal } from "./icons";

const LABELS = { ru: "Русский", en: "English" };

// What the bare "/" and "/help" render. Visitors never see it: LOCALE_SCRIPT
// redirects them to /ru… or /en… before the first paint, and the effect below
// does the same after a client-side navigation here (the inline script only
// runs on a full load), e.g. the dashboard's link to /help; the target has
// another root layout, so the router loads it as a full page. A layout effect,
// so the chooser is gone before the browser paints it. It stays a plain
// language choice for whoever runs no JS: crawlers, link previews, readers.
export function LocaleChooser({ page }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  useLayoutEffect(() => {
    const root = document.documentElement;
    // Already leaving (LOCALE_SCRIPT), or "/" launched as the Telegram app.
    if ("redirect" in root.dataset || (page === "" && isTelegramLaunch())) return;
    const search = new URLSearchParams(window.location.search);
    search.delete("lang");
    const query = search.toString();
    setLeaving(true);
    router.replace(`/${preferredLocale()}${page}${query ? `?${query}` : ""}${window.location.hash}`);
  }, [page, router]);

  if (leaving) return null;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="hero-gradient flex h-20 w-20 items-center justify-center rounded-[26px] shadow-lg">
        <Medal className="h-11 w-11" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Achivator</h1>
        <p className="text-hint text-balance">
          <span lang="ru">Награды и ачивки для Telegram-чатов.</span>{" "}
          <span lang="en">Rewards and achievements for Telegram chats.</span>
        </p>
      </div>
      <nav className="flex gap-3" aria-label="Language / Язык">
        {LOCALES.map((locale) => (
          <Link
            key={locale}
            href={`/${locale}${page}`}
            hrefLang={locale}
            lang={locale}
            className="rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg active:opacity-80"
          >
            {LABELS[locale]}
          </Link>
        ))}
      </nav>
    </main>
  );
}
