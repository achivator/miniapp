import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { MISSING_HEADER } from "@/lib/not-found";
import { HomeLink } from "./HomeLink";

// The site's 404, served with status 404 for unknown URLs: localized under
// /ru… and /en…, bilingual anywhere else, where the visitor's language is not
// in the URL. src/middleware.js marks unknown URLs and sets the status; the
// catch-all pages ([...missing]) render MissingPage in their root layout.
// The not-found.js files beside them show the same for a notFound() call.

const APP_URL = "https://t.me/achivator_bot/app";

const TEXTS = {
  ru: {
    title: "Страница не найдена",
    text: "Возможно, ссылка устарела или в адресе опечатка.",
    home: "На главную",
    help: "Как подключить чат",
    app: "Открыть Achivator в Telegram",
  },
  en: {
    title: "Page not found",
    text: "The link may be out of date, or the address has a typo.",
    home: "Go to the home page",
    help: "Connect your chat",
    app: "Open Achivator in Telegram",
  },
};

export function notFoundMetadata(locale) {
  return {
    title: locale ? `${TEXTS[locale].title} · Achivator` : "Страница не найдена · Page not found · Achivator",
    robots: { index: false },
  };
}

// A catch-all page: the 404 of `locale` (null: bilingual) when the middleware
// marked the request; otherwise (a path it let through as a file, e.g. a
// missing /brand/*.png) notFound(), which also answers 404.
export async function MissingPage({ locale }) {
  if (!(await headers()).get(MISSING_HEADER)) notFound();
  return locale ? <LocaleNotFound locale={locale} /> : <BilingualNotFound />;
}

function Frame({ children }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <Image
        src="/brand/achivator-hero-generated.png"
        alt=""
        width={1280}
        height={1280}
        priority
        sizes="180px"
        className="h-auto w-[180px] -scale-x-100 drop-shadow-[0_16px_10px_rgba(67,48,30,0.13)]"
      />
      <p className="mono-label text-hint">404 / Achivator</p>
      {children}
    </main>
  );
}

const primary = "inline-flex h-12 items-center rounded-xl bg-button px-6 text-[15px] font-semibold text-accent-fg active:opacity-80";
const secondary =
  "inline-flex h-12 items-center rounded-xl border border-[color:var(--control-border)] px-6 text-[15px] font-semibold text-fg active:opacity-80";

export function LocaleNotFound({ locale }) {
  const t = TEXTS[locale];
  return (
    <Frame>
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-bold text-balance">{t.title}</h1>
        <p className="text-hint text-balance">{t.text}</p>
      </div>
      <nav className="flex flex-wrap justify-center gap-3">
        <HomeLink locale={locale} className={primary}>
          {t.home}
        </HomeLink>
        <Link href={`/${locale}/help`} className={secondary}>
          {t.help}
        </Link>
      </nav>
      <a href={APP_URL} className="text-[15px] font-medium text-link">
        {t.app} →
      </a>
    </Frame>
  );
}

export function BilingualNotFound() {
  return (
    <Frame>
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-bold text-balance">
          <span lang="ru">{TEXTS.ru.title}</span>
          <span className="block text-hint" lang="en">
            {TEXTS.en.title}
          </span>
        </h1>
        <p className="text-hint text-balance">
          <span className="block" lang="ru">
            {TEXTS.ru.text}
          </span>
          <span className="block" lang="en">
            {TEXTS.en.text}
          </span>
        </p>
      </div>
      <nav className="flex flex-wrap justify-center gap-3" aria-label="Язык / Language">
        <Link href="/ru" hrefLang="ru" lang="ru" className={primary}>
          Achivator по-русски
        </Link>
        <Link href="/en" hrefLang="en" lang="en" className={primary}>
          Achivator in English
        </Link>
      </nav>
      <a href={APP_URL} className="text-[15px] font-medium text-link">
        <span lang="ru">Открыть в Telegram</span> · <span lang="en">Open in Telegram</span> →
      </a>
    </Frame>
  );
}
