import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getTonConfig } from "@/lib/ton/config";
import { fetchPoolAddress } from "@/lib/ton/rpc";
import { isNonceUsedOnChain, nowSeconds } from "@/lib/rewards";

export const dynamic = "force-dynamic";

export async function GET(request) {
  let auth;
  try {
    auth = authenticate(request);
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 401 });
  }

  const { searchParams } = new URL(request.url);
  const chatId = Number(searchParams.get("chatId"));
  const nonce = Number(searchParams.get("nonce"));
  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(nonce)) {
    return Response.json({ error: "chatId and nonce are required" }, { status: 400 });
  }

  const claimsCol = await getCollection("claims");
  const claim = await claimsCol.findOne({ chat_id: chatId, user_id: auth.user.id, nonce });
  if (!claim) return Response.json({ error: "claim not found" }, { status: 404 });

  if (claim.status === "issued") {
    try {
      const poolAddress = await fetchPoolAddress(getTonConfig().masterAddress, chatId);
      const used = await isNonceUsedOnChain(poolAddress, nonce);
      if (used) {
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
