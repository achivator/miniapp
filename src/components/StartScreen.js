"use client";

import { useEffect, useState } from "react";
import { isTelegramLaunch } from "@/lib/launch";
import { AppShell } from "./AppShell";
import { Dashboard } from "./Dashboard";

// The root URL serves two audiences: inside Telegram it is the member's
// dashboard, in a browser it is the landing page. The landing is server
// rendered (search engines, link previews) and hidden by CSS on a Telegram
// launch until the dashboard takes over after hydration.
export function StartScreen({ landing }) {
  const [inTelegram, setInTelegram] = useState(false);
  useEffect(() => setInTelegram(isTelegramLaunch()), []);

  if (inTelegram) {
    return (
      <AppShell>
        <Dashboard />
      </AppShell>
    );
  }
  return <div className="web-only">{landing}</div>;
}
