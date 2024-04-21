import { MongoClient } from "mongodb";

export const dynamic = "force-dynamic"; // defaults to auto

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const user_id = parseInt(searchParams.get("user_id"));
  const chat_id = parseInt(searchParams.get("chat_id"));
  const collection = searchParams.get("collection");
  const achievement_type = searchParams.get("achievement_type");

  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();

  const db = mongo.db(process.env.NODE_ENV === "development" ? "achivator_test" : "achivator_bot");
  console.log({ user_id, chat_id, collection, achievement_type });
  const achievement = await db.collection("achievements").find({ user_id, chat_id }).toArray();
  mongo.close();

  return Response.json({ achievement });
}
