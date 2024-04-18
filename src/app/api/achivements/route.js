import { MongoClient } from "mongodb";

export const dynamic = "force-dynamic"; // defaults to auto
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();

  const db = mongo.db("achivements");
  const collection = db.collection("achivements");

  // Get my achievements grouped by chat id
  const achivements = await collection.find({ user_id: id }).toArray();
  mongo.close();

  return Response.json({ achivements });
}
