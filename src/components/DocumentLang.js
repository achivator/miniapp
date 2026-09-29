"use client";

import { useEffect } from "react";

// Keeps <html lang data-lang> in step with the route's locale after a
// client-side navigation (the language switch, "/help" -> "/en/help"), where
// the inline LOCALE_SCRIPT does not run again.
export function DocumentLang({ locale }) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.lang = locale;
  }, [locale]);
  return null;
}
