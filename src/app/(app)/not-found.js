import { BilingualNotFound, notFoundMetadata } from "@/components/NotFound";

export const metadata = notFoundMetadata(null);

// A notFound() call on an app screen (unknown URLs get the same page from
// global-not-found.js): the language is not in the URL, so the 404 speaks
// both.
export default function AppNotFound() {
  return <BilingualNotFound />;
}
