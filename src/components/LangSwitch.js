"use client";

import { LOCALES, setLocale } from "@/lib/locale";

// RU / EN toggle. Stateless: the active option is styled from <html
// data-lang> in CSS, so every copy of the switch on a page stays in sync.
export function LangSwitch() {
  return (
    <div className="flex rounded-full bg-bg p-0.5 text-[12px] font-semibold ring-1 ring-[color:var(--separator)]" role="group" aria-label="Language / Язык">
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          data-for={locale}
          lang={locale}
          onClick={() => setLocale(locale)}
          className="lang-option rounded-full px-2.5 py-1 uppercase text-hint transition"
        >
          {locale}
        </button>
      ))}
    </div>
  );
}

