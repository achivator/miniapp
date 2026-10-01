import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { isClaimPaid, nowSeconds } from "@/lib/rewards";
import { queryInt } from "@/lib/query";
import { resolveEconomyChatId } from "@/lib/chat-ids";

export const dynamic = "force-dynamic";

export async function GET(request) {
  let auth;
  try {
    auth = authenticate(request);
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 401 });
  }

  const { searchParams } = new URL(request.url);
  const requestedChatId = queryInt(searchParams, "chatId");
  const nonce = queryInt(searchParams, "nonce");
  if (!Number.isSafeInteger(requestedChatId) || !Number.isSafeInteger(nonce)) {
    return Response.json({ error: "chatId and nonce are required" }, { status: 400 });
  }
  // claims are kept under the economy id (lib/chat-ids.js)
  const chatId = await resolveEconomyChatId(requestedChatId);

  const claimsCol = await getCollection("claims");
  const claim = await claimsCol.findOne({ chat_id: chatId, user_id: auth.user.id, nonce });
  if (!claim) return Response.json({ error: "claim not found" }, { status: 404 });

  if (claim.status === "issued") {
    try {
      if (await isClaimPaid(claim)) {
        await claimsCol.updateOne(
          { _id: claim._id, status: "issued" },
          { $set: { status: "claimed", resolved_at: nowSeconds() } },
        );
        claim.status = "claimed";
      }
    } catch {
      // chain unreadable: report the stored status
    }
  }

  return Response.json({
    ok: true,
    nonce,
    status: claim.status,
    amount: claim.amount,
    expiry: claim.expiry,
  });
}
