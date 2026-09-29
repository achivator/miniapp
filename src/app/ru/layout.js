import { metadata, viewport } from "../document";
import { LocaleLayout } from "../_locale/layout";

export { metadata, viewport };

// /ru… in its own root layout (see _locale/layout.js).
export default function RuLayout({ children }) {
  return <LocaleLayout locale="ru">{children}</LocaleLayout>;
}
