"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { init } from "@tma.js/sdk";

// The React bindings of @tma.js/sdk v1 that the app uses: the provider that
// initializes the SDK, and hooks for the components it returns. A port of
// @tma.js/sdk-react 2.0.3 (MIT), which only declares React 17 and 18 as
// peers; its successor (3.x) supports React 19 but needs @tma.js/sdk 3, a
// rewrite of the whole SDK API. The same behaviour as the package, on the
// same @tma.js/sdk.

const SDKContext = createContext({ loading: false });

// Initializes the SDK once, completely (it waits for Telegram's answers to
// the viewport and theme requests): `loading` until then, then `initResult`
// with the SDK components, or `error` outside Telegram.
export function SDKProvider({ options, children }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState();
  const [initResult, setInitResult] = useState();
  useEffect(() => {
    setLoading(true);
    init({ ...options, complete: true })
      .then(setInitResult)
      .catch(setError)
      .finally(() => setLoading(false));
    // Once per mount, whatever the options: init() binds global listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const value = useMemo(() => {
    const context = { loading };
    if (error) context.error = error;
    if (initResult) context.initResult = initResult;
    return context;
  }, [loading, error, initResult]);
  return <SDKContext.Provider value={value}>{children}</SDKContext.Provider>;
}

export function useSDKContext() {
  return useContext(SDKContext);
}

// A component of the init result; only below an initialized SDKProvider.
function useInitResult(key) {
  const { initResult } = useSDKContext();
  if (!initResult) throw new Error(`Unable to get init result key "${key}" as long as SDK is not initialized`);
  return initResult[key];
}

function copy(component) {
  return Object.create(Object.getPrototypeOf(component), Object.getOwnPropertyDescriptors(component));
}

// A stateful component: a fresh copy after each of its "change" events, so
// that the screen re-renders with the new state.
function useTracked(key) {
  const component = useInitResult(key);
  const [state, setState] = useState(() => copy(component));
  useEffect(() => component.on("change", () => setState(copy(component))), [component]);
  return state;
}

export const useBackButton = () => useTracked("backButton");
export const useInvoice = () => useTracked("invoice");
export const useMiniApp = () => useTracked("miniApp");
export const useSettingsButton = () => useTracked("settingsButton");
export const useThemeParams = () => useTracked("themeParams");
export const useHapticFeedback = () => useInitResult("hapticFeedback");
export const useInitDataRaw = () => useInitResult("initDataRaw");
