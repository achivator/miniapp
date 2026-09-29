"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { isTelegramLaunch } from "@/lib/launch";

// The guide's logo: the landing of its locale in a browser, but the member
// dashboard inside Telegram, where "/" is the app and the landing is noise.
// "/" has another root layout, so this is a full page load; TelegramBack
// keeps the launch params in sessionStorage for it.
export function HomeLink({ locale, ...props }) {
  const router = useRouter();
  return (
    <Link
      href={`/${locale}`}
      onClick={(event) => {
        if (!isTelegramLaunch()) return;
        event.preventDefault();
        router.push("/");
      }}
      {...props}
    />
  );
}
