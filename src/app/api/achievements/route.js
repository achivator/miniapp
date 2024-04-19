import { MongoClient } from "mongodb";

export const dynamic = "force-dynamic"; // defaults to auto

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const user_id = parseInt(searchParams.get("user_id"));

  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();

  const db = mongo.db("achivator_bot");
  const collection = db.collection("achievements");

  // Get my achievements grouped by chat id
  const achivements = await collection.find({ user_id }).toArray();
  mongo.close();

  return Response.json({ achivements });
}
