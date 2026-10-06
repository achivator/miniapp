// achivator.ton is a TON Site (deploy/tonsite, docs/DEPLOY.md): Telegram opens
// .ton links in its in-app browser, where the page gets no tgWebAppData and
// would show the web landing. src/middleware.js sends every request for that
// host to the Mini App instead. Not every visitor comes from Telegram (TON
// Proxy, Tonkeeper's browser); t.me then shows its own "Open in Telegram".
export const TON_SITE_HOST = "achivator.ton";
export const MINI_APP_URL = "https://t.me/achivator_bot/app";
// Telegram's startapp: up to 512 characters of A-Z, a-z, 0-9, _ and -.
const START_PARAM = /^[A-Za-z0-9_-]{1,512}$/;

// The Host header as the TON proxy and Traefik pass it on.
export function isTonSiteHost(host) {
  return typeof host === "string" && host.toLowerCase().replace(/:\d+$/, "") === TON_SITE_HOST;
}

// achivator.ton/?startapp=X opens the Mini App with that start parameter; any
// other path or query opens it plain.
export function tonSiteTarget(searchParams) {
  const start = searchParams.get("startapp");
  return start !== null && START_PARAM.test(start) ? `${MINI_APP_URL}?startapp=${start}` : MINI_APP_URL;
}
