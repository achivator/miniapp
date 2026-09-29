// Set by src/middleware.js on requests for unknown URLs, which it answers
// with status 404; the catch-all pages read it (components/NotFound.js).
export const MISSING_HEADER = "x-achivator-missing";
