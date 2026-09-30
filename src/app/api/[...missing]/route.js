export const dynamic = "force-dynamic";

// Any /api/… path no API route matches: a JSON 404 in the shape of the other
// routes' errors, rather than the site's HTML 404 (the middleware leaves
// /api/ alone; without this route the app's page catch-all would answer).
function missing() {
  return Response.json({ error: "not found" }, { status: 404 });
}

export const GET = missing;
export const HEAD = missing;
export const POST = missing;
export const PUT = missing;
export const PATCH = missing;
export const DELETE = missing;
export const OPTIONS = missing;
