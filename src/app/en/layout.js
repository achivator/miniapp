import { metadata, viewport } from "../document";
import { LocaleLayout } from "../_locale/layout";

export { metadata, viewport };

// /en… in its own root layout (see _locale/layout.js).
export default function EnLayout({ children }) {
  return <LocaleLayout locale="en">{children}</LocaleLayout>;
}
