const { MongoClient } = require('mongodb');

// Cache the client across Next.js hot reloads.
const g = globalThis;

async function getClient() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
    if (!g.__achivatorMongoClientPromise) {
        g.__achivatorMongoClientPromise = new MongoClient(process.env.MONGODB_URI).connect();
    }
    return g.__achivatorMongoClientPromise;
}

function dbName() {
    return 'achivator_bot';
}

async function getDb() {
    const client = await getClient();
    return client.db(dbName());
}

async function getCollection(name) {
    return (await getDb()).collection(name);
}

module.exports = { getClient, getDb, getCollection, dbName };
