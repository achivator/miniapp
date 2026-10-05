import posthog from "posthog-js";
import { isTelegramLaunch } from "./launch";

// Product analytics (PostHog), in the browser only. Off unless
// NEXT_PUBLIC_POSTHOG_KEY is set at build time: NEXT_PUBLIC_* values are
// inlined into the client bundle by `next build`, so the deploy must pass
// them to the build, not only to the running server.
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";

let started = false;

// Once per page load (moving between root layouts is a full load, see
// app/document.js). Pageviews follow client-side navigations by themselves.
export function initAnalytics() {
  if (started || !KEY || typeof window === "undefined") return;
  started = true;
  safely(() => {
    posthog.init(KEY, {
      api_host: HOST,
      ui_host: "https://eu.posthog.com",
      defaults: "2026-08-30",
      // Anonymous web visitors stay anonymous; Telegram users get a profile.
      person_profiles: "identified_only",
    });
    posthog.register({ launch: isTelegramLaunch() ? "telegram" : "web" });
  });
}

// The Telegram user behind the app screens, by their Telegram id (the same id
// the bot and the database know them by). No names: language, Premium and
// the client are enough to segment by. The launch's platform and start
// parameter (t.me/achivator_bot/app?startapp=...) go on every event.
// `launch` is the SDK's launch params (retrieveLaunchParams()), if known.
export function identifyTelegramUser(initData, launch) {
  const user = initData?.user;
  if (!started || !user) return;
  safely(() => {
    posthog.register({
      tg_platform: launch?.platform,
      tg_version: launch?.version,
      tg_start_param: initData.startParam || launch?.startParam,
      tg_chat_type: initData.chatType,
    });
    posthog.identify(String(user.id), {
      language_code: user.languageCode,
      is_premium: Boolean(user.isPremium),
      tg_platform: launch?.platform,
    });
  });
}

export function track(event, properties) {
  if (!started) return;
  safely(() => posthog.capture(event, properties));
}

// An action's failure as event properties: the message, cut short (wallet
// and API errors can be long), and whether the user declined in the wallet.
export function failure(error) {
  const message = String(error?.message || error || "").slice(0, 200);
  return { error: message, rejected: /reject|declin|cancel/i.test(`${error?.name} ${message}`) };
}

// Analytics must never take a screen down.
function safely(fn) {
  try {
    fn();
  } catch {
    // ignore
  }
}
