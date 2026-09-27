import { ObjectId } from "mongodb";
import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getTonConfig, templateIdFor } from "@/lib/ton/config";
import { fetchIsMinted } from "@/lib/ton/rpc";
import { GAS } from "@/lib/ton/constants";

export const dynamic = "force-dynamic";

// One of the caller's own achievements. Owner check: the lookup is scoped to
// the authenticated user, so another user's id yields 404.
export async function GET(request) {
  let auth;
  try {
    auth = authenticate(request);
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 401 });
  }

  const id = new URL(request.url).searchParams.get("_id");
  if (!id || !ObjectId.isValid(id)) {
    return Response.json({ error: "invalid achievement id" }, { status: 400 });
  }

  const achievement = await (await getCollection("achievements")).findOne({
    _id: new ObjectId(id),
    user_id: auth.user.id,
  });
  if (!achievement) return Response.json({ error: "achievement not found" }, { status: 404 });

  const chat = await (await getCollection("chats")).findOne({ id: achievement.chat_id });

  // NFT status: mintable only once the registry and its template exist.
  const cfg = getTonConfig();
  const templateId = cfg.registryAddress ? templateIdFor(achievement.collection, achievement.type) : null;
  let minted = null;
  if (templateId !== null) {
    try {
      minted = await fetchIsMinted(cfg.registryAddress, templateId, auth.user.id);
    } catch {
      minted = null;
    }
  }
  return Response.json({
    _id: String(achievement._id),
    type: achievement.type,
    collection: achievement.collection || "v1",
    date: achievement.date,
    chat: { id: achievement.chat_id, title: chat?.title || null },
    nft: {
      mintable: templateId !== null,
      minted,
      price_ton: GAS.mintTon,
      network: cfg.network,
    },
  });
}
