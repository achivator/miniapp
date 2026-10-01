// Integration tests for a group upgraded to a supergroup (lib/chat-ids.js,
// achivator/telegram-bot#10): the old group's id is the chat's economy id
// for good - its pool, vouchers and every database key - while Telegram is
// asked about the supergroup. A link made in the supergroup carries the new
// id; the routes resolve it to the economy.
const h = require('./helpers');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Cell } = require('@ton/core');
const { signVerify } = require('@ton/crypto');

const { itest, seed, chain, telegram, callApi, getCollection, ago, address } = h;
const { VOUCHER_TAG } = require(path.join(h.SRC, 'lib/ton/constants.js'));
const { signedVoucherCell, backendKeyPair } = require(path.join(h.SRC, 'lib/ton/vouchers.js'));

h.setupIntegration();

const OLD = -1550001; // the basic group: economy id
const NEW = -1001550001; // its supergroup: telegram id
const CREATOR = 111;
const ALICE = 222;
const BOB = 333;
const JETTON = address('jetton');
const WALLET = address('alice-wallet');
const CREATOR_WALLET = address('creator-wallet');

// what the bot leaves once the alias is active
async function seedMigrated() {
    chain.addJetton(JETTON, { decimals: 9, symbol: 'TST' });
    const pool = chain.addPool(OLD);
    await seed.chat({
        id: OLD,
        title: 'Memes',
        creator: CREATOR,
        jetton_master: JETTON,
        claim_settings: { maturation_days: 3 },
        migrated_to_chat_id: NEW,
        migrated_at: ago(2),
        telegram_chat_id: NEW,
        migrated_automatically_at: ago(2),
    });
    // the supergroup's own document: only an alias (here with what a
    // /jetton run there before the alias left on it)
    await seed.chat({ id: NEW, title: 'Memes', migrated_from_chat_id: OLD, economy_chat_id: OLD, creator: CREATOR, jetton_master: JETTON });
    await seed.grant(OLD, ALICE, 100, ago(10));
    await seed.rewards(OLD, ALICE, 100);
    await (await getCollection('achievements')).insertOne({ chat_id: OLD, user_id: ALICE, type: 'liked', collection: 'v1', date: 1 });
    // Telegram knows the members in the supergroup only: the old group is dead
    telegram.setStatus(NEW, CREATOR, 'creator');
    telegram.setStatus(NEW, ALICE, 'member');
    return pool;
}

// GET /api/chats/<chatId>/rating: a dynamic route gets its params as a
// promise (Next 15)
async function rating(chatId, user) {
    const route = path.join(h.SRC, 'app/api/chats/[chatId]/rating/route.js');
    const { GET } = await import(pathToFileURL(route).href);
    const res = await GET(h.apiRequest(`chats/${chatId}/rating`, { user }), { params: Promise.resolve({ chatId: String(chatId) }) });
    return { status: res.status, body: await res.json() };
}

// chat ids the stubbed Telegram was asked about
const telegramChatIds = () => telegram.calls.filter((c) => c.name !== 'botApi').map((c) => c.args[0]);

// the voucher a payload carries: {chatId, signature valid for `target`}
function openVoucher(payloadB64, tag, target) {
    const body = Cell.fromBoc(Buffer.from(payloadB64, 'base64'))[0].beginParse();
    body.loadUint(32); // opcode
    const voucher = body.loadRef();
    const signature = body.loadBuffer(64);
    const signed = signedVoucherCell(voucher, { tag, target });
    return {
        chatId: Number(voucher.beginParse().loadIntBig(64)),
        valid: signVerify(signed.hash(), signature, backendKeyPair(process.env.BACKEND_SECRET).publicKey),
    };
}

itest("a member's claim from the supergroup is signed with the old id, for the old id's pool", async () => {
    const pool = await seedMigrated();

    // the supergroup's id, as a link made there carries it
    const res = await callApi('claim-voucher', { method: 'POST', user: ALICE, body: { chatId: NEW, wallet: WALLET } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.points, 100);
    assert.equal(res.body.to, pool.address.toString());
    const voucher = openVoucher(res.body.payload_b64, VOUCHER_TAG.Claim, pool.address);
    assert.deepEqual(voucher, { chatId: OLD, valid: true });
    // booked under the economy id: its ledger, its claims, its nonces
    const [claim] = await (await getCollection('claims')).find({}).toArray();
    assert.deepEqual([claim.chat_id, claim.nonce], [OLD, 1]);
    assert.equal((await (await getCollection('rewards')).findOne({ chat_id: OLD, user_id: ALICE })).claimed_points, 100);
    assert.equal(await (await getCollection('rewards')).countDocuments({ chat_id: NEW }), 0);
    assert.ok(await (await getCollection('counters')).findOne({ _id: `nonce_${OLD}` }));
    // the pool lookups never used the new id: it has no pool
    assert.deepEqual([...new Set(chain.calls.filter((c) => c.name === 'getPoolStatus').map((c) => c.args[1]))], [OLD]);

    // its status reads the same claim whichever id the app holds
    for (const chatId of [NEW, OLD]) {
        const status = await callApi('claim-status', { user: ALICE, query: { chatId, nonce: 1 } });
        assert.equal(status.status, 200, JSON.stringify(status.body));
        assert.equal(status.body.status, 'issued');
    }
});

itest('membership is checked in the supergroup: the rating asks Telegram about the new id', async () => {
    await seedMigrated();

    // Alice is a member of the supergroup; the old id's rating is hers to see
    for (const chatId of [OLD, NEW]) {
        telegram.calls.length = 0;
        const res = await rating(chatId, ALICE);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.deepEqual(res.body.chat, { id: OLD, title: 'Memes' });
        assert.deepEqual(res.body.top.map((e) => [e.rank, e.achievements]), [[1, 1]]);
        assert.deepEqual([...new Set(telegramChatIds())], [NEW]);
    }

    // Bob, only "a member" of the dead group, is not one of the supergroup
    telegram.setStatus(OLD, BOB, 'member');
    const bob = await rating(NEW, BOB);
    assert.equal(bob.status, 403);
});

itest("the creator's pool page, vouchers and checks: economy id for the pool, new id for Telegram", async () => {
    const pool = await seedMigrated();

    telegram.calls.length = 0;
    const status = await callApi('pool-status', { user: CREATOR, query: { chatId: NEW } });
    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.equal(status.body.chat_id, OLD, 'the page moves to the economy id');
    assert.equal(status.body.pool_address, pool.address.toString());
    assert.deepEqual(status.body.migrated, { to_chat_id: NEW, at: status.body.migrated.at, needs_review: false });
    assert.deepEqual(telegramChatIds(), [NEW], 'getChatMemberCount of the supergroup');

    // the admin voucher: Telegram confirms the creator in the supergroup, the
    // voucher carries the old id
    telegram.calls.length = 0;
    const admin = await callApi('admin-voucher', { method: 'POST', user: CREATOR, body: { chatId: NEW, wallet: CREATOR_WALLET } });
    assert.equal(admin.status, 200, JSON.stringify(admin.body));
    assert.deepEqual(openVoucher(admin.body.payload_b64, VOUCHER_TAG.Admin, pool.address), { chatId: OLD, valid: true });
    assert.deepEqual(telegramChatIds(), [NEW]);

    // a creator Telegram does not confirm in the supergroup is refused, even
    // as the old group's creator
    telegram.reset();
    telegram.setStatus(OLD, CREATOR, 'creator');
    const refused = await callApi('admin-voucher', { method: 'POST', user: CREATOR, body: { chatId: OLD, wallet: CREATOR_WALLET } });
    assert.equal(refused.status, 403);
    assert.deepEqual(telegramChatIds(), [NEW]);
    telegram.setStatus(NEW, CREATOR, 'creator');
    telegram.setStatus(NEW, ALICE, 'member');

    // claim rules and the point price: saved on the economy's document
    telegram.calls.length = 0;
    const rules = await callApi('claim-settings', {
        method: 'POST',
        user: CREATOR,
        body: { chatId: NEW, settings: { maturation_days: 5 } },
    });
    assert.equal(rules.status, 200, JSON.stringify(rules.body));
    const price = await callApi('point-price', { method: 'POST', user: CREATOR, body: { chatId: NEW, price: '0.02' } });
    assert.equal(price.status, 200, JSON.stringify(price.body));
    assert.deepEqual(telegramChatIds(), [NEW, NEW]);
    const chats = await getCollection('chats');
    const oldDoc = await chats.findOne({ id: OLD });
    assert.deepEqual([oldDoc.claim_settings.maturation_days, oldDoc.point_price], [5, '0.02']);
    const newDoc = await chats.findOne({ id: NEW });
    assert.deepEqual([newDoc.claim_settings, newDoc.point_price], [undefined, undefined]);

    // the member list: the economy's members, named by the supergroup
    telegram.calls.length = 0;
    const members = await callApi('pool-members', { user: CREATOR, query: { chatId: NEW } });
    assert.equal(members.status, 200, JSON.stringify(members.body));
    assert.equal(members.body.chat_id, OLD);
    assert.deepEqual(members.body.members.map((m) => [m.user_id, m.name]), [[ALICE, `User${ALICE}`]]);
    assert.deepEqual([...new Set(telegramChatIds())], [NEW]);
});

itest("the creator's chat list shows the economy once, not the supergroup's alias", async () => {
    await seedMigrated();
    const res = await callApi('me/chats', { user: CREATOR });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.creator.map((c) => c.chat_id), [OLD]);
});
