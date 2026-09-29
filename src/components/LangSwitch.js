"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LOCALES, saveLocale } from "@/lib/locale";

// RU / EN toggle: links to the same page in the other locale (`page` is the
// suffix after /ru or /en, see PAGES in lib/locale.js). A click also saves
// the pick, so "/" opens it next time, and keeps the section anchor the
// visitor jumped to (anchors are the same in both locales). It replaces the
// history entry: switching language is not a step Back should undo.
export function LangSwitch({ locale, page = "" }) {
  const router = useRouter();
  return (
    <div className="flex rounded-full bg-bg p-0.5 text-[12px] font-semibold ring-1 ring-[color:var(--separator)]" role="group" aria-label="Language / Язык">
      {LOCALES.map((option) =>
        option === locale ? (
          <span
            key={option}
            lang={option}
            aria-current="page"
            className="rounded-full bg-surface px-2.5 py-1 uppercase text-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
          >
            {option}
          </span>
        ) : (
          <Link
            key={option}
            href={`/${option}${page}`}
            hrefLang={option}
            lang={option}
            replace
            onClick={(event) => {
              saveLocale(option);
              // Link navigates to its href prop, so a hash has to go this way
              // (not for a new-tab click, which the browser handles).
              if (!window.location.hash || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              router.replace(`/${option}${page}${window.location.hash}`);
            }}
            className="rounded-full px-2.5 py-1 uppercase text-hint transition hover:text-fg"
          >
            {option}
          </Link>
        ),
      )}
    </div>
  );
}
