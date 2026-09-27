"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { on, postEvent } from "@tma.js/sdk";

// Telegram's native back button for pages rendered without AppShell (they
// must also open in a plain browser, where the bridge is missing and
// postEvent throws). Returns to the previous screen, or home on a direct open.
export function TelegramBack() {
  const router = useRouter();
  useEffect(() => {
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
