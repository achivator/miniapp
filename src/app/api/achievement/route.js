import { MongoClient, ObjectId } from "mongodb";
import { keyPairFromSecretKey, sign } from "@ton/crypto";

export const dynamic = "force-dynamic"; // defaults to auto

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const user_id = parseInt(searchParams.get("user_id"));
  const _id = new ObjectId(searchParams.get("_id"));

  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();

  const db = mongo.db(process.env.NODE_ENV === "development" ? "achivator_test" : "achivator_bot");

  const achievement = await db.collection("achievements").findOne({ user_id, _id });
  mongo.close();

  const keyPair = keyPairFromSecretKey(process.env.TON_SECRET_KEY);
  const itemTemplate = `${achievement.collection}/${achievement.type}`;
  const hash = sign(itemTemplate, keyPair.secretKey);

  return Response.json({ achievement, hash });
}
