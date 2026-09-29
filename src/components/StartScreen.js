"use client";

import { useEffect, useState } from "react";
import { isTelegramLaunch } from "@/lib/launch";
import { AppShell } from "./AppShell";
import { Dashboard } from "./Dashboard";

// The root URL serves two audiences: inside Telegram it is the member's
// dashboard, a browser goes on to the landing in its language (/ru, /en). The
// fallback shown meanwhile is server rendered (link previews, no-JS) and
// hidden by CSS on a Telegram launch until the dashboard takes over after
// hydration.
export function StartScreen({ fallback }) {
  const [inTelegram, setInTelegram] = useState(false);
  useEffect(() => setInTelegram(isTelegramLaunch()), []);

  if (inTelegram) {
    return (
      <AppShell>
        <Dashboard />
      </AppShell>
    );
  }
  return <div className="web-only">{fallback}</div>;
}
