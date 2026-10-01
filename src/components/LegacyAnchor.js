"use client";

import { useEffect } from "react";
import { legacyAnchor } from "@/lib/locale";

// A localized page opened with an old locale-prefixed anchor (/ru#ru-pricing,
// see legacyAnchor in lib/locale.js), which the browser cannot find: the URL
// gets the page's own anchor and the page scrolls to it. The redirects from
// "/" and "/help" already drop the prefix, so this is for links copied from
// the address bar before they did.
export function LegacyAnchor() {
  useEffect(() => {
    const { hash, pathname, search } = window.location;
    const anchor = legacyAnchor(hash);
    if (anchor === hash) return;
    window.history.replaceState(window.history.state, "", pathname + search + anchor);
    document.getElementById(decodeURIComponent(anchor.slice(1)))?.scrollIntoView();
  }, []);
  return null;
}
