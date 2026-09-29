import { BilingualNotFound, notFoundMetadata } from "@/components/NotFound";

export const metadata = notFoundMetadata(null);

// Unknown URLs outside /ru… and /en…: the language is not in the URL, so the
// 404 speaks both.
export default function AppNotFound() {
  return <BilingualNotFound />;
}
