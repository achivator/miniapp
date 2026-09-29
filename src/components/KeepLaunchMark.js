"use client";

import { useLayoutEffect } from "react";

// html[data-launch] as LAUNCH_SCRIPT set it on the page load; kept in module
// state, which outlives client-side navigations.
let launch;

// When a localized root layout (app/ru, app/en, see app/_locale/layout.js)
// remounts on a client-side navigation, React clears every attribute of
// <html> it does not render itself, the inline scripts' marks included
// (/ru <-> /en is a full page load now, so this is a safeguard). This puts
// data-launch back before the browser paints, so isTelegramLaunch() and the
// CSS keep treating a Telegram launch as one.
export function KeepLaunchMark() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (launch === undefined) launch = root.dataset.launch ?? null;
    else if (launch) root.dataset.launch = launch;
  }, []);
  return null;
}
