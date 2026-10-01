// Set by src/middleware.js on requests for unknown URLs under /ru/ and /en/,
// which it answers with status 404; their catch-all pages read it
// (components/NotFound.js).
export const MISSING_HEADER = "x-achivator-missing";
