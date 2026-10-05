"use client";

import { useEffect } from "react";
import { initAnalytics } from "@/lib/analytics";

// Starts PostHog on every page (see lib/analytics.js); renders nothing.
export function Analytics() {
  useEffect(() => initAnalytics(), []);
  return null;
}
