// Whether this page load is a Telegram Mini App launch. Decided before the
// first paint by an inline script (see layout.js), so the web landing never
// flashes inside Telegram and the Telegram app never renders for search
// engines. Mirrors @tma.js/sdk retrieveLaunchParams: the launch params are in
// the URL hash, in the first navigation entry after a reload with a changed
// location, or in the SDK's sessionStorage copy.
export const LAUNCH_SCRIPT = `try{
var re=/[#?&]tgWebApp(Data|Platform)=/,nav=performance.getEntriesByType&&performance.getEntriesByType("navigation")[0];
if(re.test(location.href)||(nav&&re.test(nav.name))||sessionStorage.getItem("telegram-mini-apps-launch-params"))
document.documentElement.dataset.launch="telegram";
}catch(e){}`;

export function isTelegramLaunch() {
  return typeof document !== "undefined" && document.documentElement.dataset.launch === "telegram";
}
