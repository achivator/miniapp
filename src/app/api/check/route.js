import { validate } from "@tma.js/init-data-node";

export const dynamic = "force-dynamic"; // defaults to auto
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  try {
    validate(searchParams, process.env.TELEGRAM_BOT_TOKEN);
    return Response.json({ success: true });
  } catch (e) {
    return Response.error(e);
  }
}
