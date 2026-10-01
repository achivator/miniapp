// Integration tests for chat covers: GET /api/chats/<chatId>/photo (the
// chat's photo, proxied from Telegram for its members) and the titles
// Telegram has for chats the bot stored none for (lib/chat-photo.js).
const h = require('./helpers');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { itest, seed, telegram, callApi, getCollection, BOT_TOKEN } = h;
const { clearChatCache } = require(path.join(h.SRC, 'lib/telegram.js'));

h.setupIntegration();

const CHAT = -1001828027175;
const OLD = -1550001; // a basic group upgraded to...
const NEW = -1001550001; // ...this supergroup
const CREATOR = 111;
const ALICE = 222;
const MALLORY = 666;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PHOTO = { file_id: 'small-1', unique_id: 'AQADsmall1', bytes: JPEG };

// GET /api/chats/<chatId>/photo: the raw response (an image or JSON)
async function photo(chatId, user, headers = {}) {
    const route = path.join(h.SRC, 'app/api/chats/[chatId]/photo/route.js');
    const { GET } = await import(pathToFileURL(route).href);
    const request = h.apiRequest(`chats/${chatId}/photo`, { user });
    for (const [k, v] of Object.entries(headers)) request.headers.set(k, v);
    const res = await GET(request, { params: Promise.resolve({ chatId: String(chatId) }) });
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, bytes, text: bytes.toString('utf8') };
}

const callsOf = (name) => telegram.calls.filter((c) => c.name === name);
const chatDoc = async (id) => (await getCollection('chats')).findOne({ id });

async function seedChat(doc = {}) {
    await seed.chat({ id: CHAT, title: 'Memes', creator: CREATOR, ...doc });
    await seed.rewards(CHAT, ALICE, 10);
    telegram.setStatus(CHAT, ALICE, 'member');
}

itest('a member gets the photo bytes with its ETag, and 304 when the browser has it', async () => {
    await seedChat();
    telegram.setChat(CHAT, { title: 'Memes', photo: PHOTO });

    const res = await photo(CHAT, ALICE);
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.bytes, JPEG);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.equal(res.headers.get('etag'), '"AQADsmall1"');
    assert.match(res.headers.get('cache-control'), /^private, max-age=\d+$/);
    assert.equal(res.headers.get('content-length'), String(JPEG.length));

    const again = await photo(CHAT, ALICE, { 'if-none-match': '"AQADsmall1"' });
    assert.equal(again.status, 304);
    assert.equal(again.bytes.length, 0);
    assert.equal(again.headers.get('etag'), '"AQADsmall1"');

    // an older ETag (the chat changed its photo) gets the bytes, from the image cache
    const third = await photo(CHAT, ALICE, { 'if-none-match': '"AQADold"' });
    assert.equal(third.status, 200);
    assert.deepEqual(third.bytes, JPEG);

    // one getChat, one getFile and one download for all three requests
    assert.equal(callsOf('getChat').length, 1);
    assert.equal(callsOf('getFile').length, 1);
    assert.equal(callsOf('downloadFile').length, 1);
});

itest("the chat's creator gets the photo without being a member on record", async () => {
    await seedChat();
    telegram.setChat(CHAT, { title: 'Memes', photo: PHOTO });
    const res = await photo(CHAT, CREATOR);
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.bytes, JPEG);
});

itest("a non-member gets 403, whether or not the chat exists, and Telegram's file is never fetched", async () => {
    await seedChat();
    telegram.setChat(CHAT, { title: 'Memes', photo: PHOTO });
    telegram.setStatus(CHAT, MALLORY, 'left');

    const res = await photo(CHAT, MALLORY);
    assert.equal(res.status, 403, res.text);
    const unknown = await photo(-1009999999999, MALLORY);
    assert.equal(unknown.status, 403, unknown.text);
    // a member who left keeps no access through an old rewards record
    await seed.rewards(CHAT, MALLORY, 5);
    assert.equal((await photo(CHAT, MALLORY)).status, 403);

    assert.equal(callsOf('getChat').length, 0);
    assert.equal(callsOf('getFile').length, 0);
    assert.equal((await photo(CHAT, null)).status, 401);
});

itest('a chat without a photo, or one Telegram does not answer for, is a 404 that leaks no token', async () => {
    await seedChat();
    telegram.setChat(CHAT, { title: 'Memes' });
    const res = await photo(CHAT, ALICE);
    assert.equal(res.status, 404, res.text);
    assert.ok(!res.text.includes(BOT_TOKEN));

    // the bot was removed: getChat fails (stub: null) - 404, and the miss is cached
    telegram.chats.clear();
    clearChatCache();
    assert.equal((await photo(CHAT, ALICE)).status, 404);
    assert.equal((await photo(CHAT, ALICE)).status, 404);
    assert.equal(callsOf('getChat').length, 2);

    // getFile fails: 404 as well
    telegram.setChat(CHAT, { title: 'Memes', photo: PHOTO });
    telegram.files.clear();
    clearChatCache();
    assert.equal((await photo(CHAT, ALICE)).status, 404);
});

itest('an upgraded group: Telegram is asked about the supergroup, by either id', async () => {
    await seed.chat({ id: OLD, title: 'Memes', creator: CREATOR, migrated_to_chat_id: NEW, telegram_chat_id: NEW });
    await seed.chat({ id: NEW, title: 'Memes', migrated_from_chat_id: OLD, economy_chat_id: OLD });
    await seed.rewards(OLD, ALICE, 10);
    telegram.setStatus(NEW, ALICE, 'member');
    telegram.setChat(NEW, { title: 'Memes', photo: PHOTO });

    for (const id of [OLD, NEW]) {
        const res = await photo(id, ALICE);
        assert.equal(res.status, 200, res.text);
        assert.deepEqual(res.bytes, JPEG);
    }
    const asked = telegram.calls.filter((c) => c.name === 'getChat' || c.name === 'getChatMember').map((c) => c.args[0]);
    assert.deepEqual([...new Set(asked)], [NEW]);
});

itest("Telegram's title is stored once per getChat refresh, on the economy's document", async () => {
    await seed.chat({ id: OLD, title: null, creator: CREATOR, telegram_chat_id: NEW, migrated_to_chat_id: NEW });
    await seed.chat({ id: NEW, title: 'Alias', economy_chat_id: OLD });
    await seed.rewards(OLD, ALICE, 10);
    telegram.setStatus(NEW, ALICE, 'member');
    telegram.setChat(NEW, { title: 'Real title', photo: PHOTO });

    assert.equal((await photo(OLD, ALICE)).status, 200);
    assert.equal((await chatDoc(OLD)).title, 'Real title');
    assert.equal((await chatDoc(NEW)).title, 'Alias');

    // served from the cached getChat: no write, even when the stored one differs
    await (await getCollection('chats')).updateOne({ id: OLD }, { $set: { title: 'Edited meanwhile' } });
    assert.equal((await photo(OLD, ALICE)).status, 200);
    assert.equal((await chatDoc(OLD)).title, 'Edited meanwhile');
    assert.equal(callsOf('getChat').length, 1);

    // the cache refreshed (expired): Telegram's title is stored again
    clearChatCache();
    telegram.setChat(NEW, { title: 'Renamed', photo: PHOTO });
    assert.equal((await photo(OLD, ALICE)).status, 200);
    assert.equal((await chatDoc(OLD)).title, 'Renamed');
});

itest('the dashboard shows and stores the title of a chat the bot stored none for, on the first load', async () => {
    await seed.chat({ id: CHAT, title: null, creator: ALICE });
    await seed.rewards(CHAT, ALICE, 10);
    await (await getCollection('achievements')).insertOne({ chat_id: CHAT, user_id: ALICE, type: 'liked', collection: 'v1', date: 1 });
    telegram.setChat(CHAT, { title: 'Real title' });

    const [dashboard, achievements] = await Promise.all([
        callApi('me/chats', { user: ALICE }),
        callApi('achievements', { user: ALICE }),
    ]);
    assert.equal(dashboard.status, 200, JSON.stringify(dashboard.body));
    assert.equal(dashboard.body.rewards.find((r) => r.chat_id === CHAT).title, 'Real title');
    assert.equal(dashboard.body.creator.find((c) => c.chat_id === CHAT).title, 'Real title');
    assert.equal(achievements.status, 200);
    assert.equal(achievements.body.find((g) => g.chat.id === CHAT).chat.title, 'Real title');
    assert.equal((await chatDoc(CHAT)).title, 'Real title');
    // both lists, one getChat
    assert.equal(callsOf('getChat').length, 1);

    // a titled chat costs no Telegram call
    telegram.calls.length = 0;
    clearChatCache();
    assert.equal((await callApi('me/chats', { user: ALICE })).status, 200);
    assert.equal(callsOf('getChat').length, 0);
});

itest('a chat Telegram does not answer for keeps no title on the dashboard', async () => {
    await seed.chat({ id: CHAT, title: null, creator: ALICE });
    const res = await callApi('me/chats', { user: ALICE });
    assert.equal(res.status, 200);
    assert.equal(res.body.creator[0].title, null);
    assert.equal((await chatDoc(CHAT)).title, null);
});
