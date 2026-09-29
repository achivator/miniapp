"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { on, postEvent, retrieveLaunchParams } from "@tma.js/sdk";
import { isTelegramLaunch } from "@/lib/launch";

// Telegram's native back button for pages rendered without AppShell (they
// must also open in a plain browser, where the bridge is missing and
// postEvent throws). Returns to the previous screen, or home on a direct open.
export function TelegramBack() {
  const router = useRouter();
  useEffect(() => {
    // "/" is in another root layout, so going home (here or the logo's
    // HomeLink) is a full page load without the launch params in the URL.
    // Retrieving them keeps the SDK's sessionStorage copy, which LAUNCH_SCRIPT
    // and the dashboard find there, also when Telegram opened this page first.
    if (isTelegramLaunch()) {
      try {
        retrieveLaunchParams();
      } catch {
        // malformed launch params: nothing to keep
      }
    }
    try {
      postEvent("web_app_setup_back_button", { is_visible: true });
    } catch {
      return undefined; // not inside Telegram
    }
    const off = on("back_button_pressed", () => {
      if (window.history.length > 1) router.back();
      else router.push("/");
    });
    return () => {
      off();
      try {
        postEvent("web_app_setup_back_button", { is_visible: false });
      } catch {
        // bridge gone
      }
    };
  }, [router]);
  return null;
}
