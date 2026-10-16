// /api/mint-voucher and the NFT status of /api/achievement against the
// achievement registry: a protocol v3 registry gets the v3 mint voucher
// (template key, recipient, HMAC user tag, expiry; no Telegram id, no
// nonce) and "already minted" means the SBT's address is taken; a legacy v2
// registry keeps its old voucher and isMinted getter.
const h = require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { Address, beginCell, Cell } = require('@ton/core');
const { keyPairFromSeed, signVerify } = require('@ton/crypto');

const { itest, callApi, chain, getCollection, address } = h;
const { GLOBAL_ID, VOUCHER_TAG, OP, SECONDS, GAS } = require(path.join(h.SRC, 'lib/ton/constants.js'));

h.setupIntegration();

const REGISTRY = address('achievement-registry');
const TAG_KEY = crypto.createHash('sha256').update('integration-tag-key').digest('hex');
const KEY_SANTA = BigInt('0x' + crypto.createHash('sha256').update('template:santa').digest('hex'));
const hex = (v) => '0x' + v.toString(16).padStart(64, '0');
const ALICE = 1001;
const BOB = 1002;
const WALLET = Address.parse(address('alice-wallet'));

const userTag = (id) =>
    BigInt('0x' + crypto.createHmac('sha256', Buffer.from(TAG_KEY, 'hex')).update(`user:${id}`).digest('hex'));

function configure(env = {}) {
    Object.assign(process.env, {
        ACHIEVEMENT_REGISTRY: REGISTRY,
        ACHIEVEMENT_TEMPLATES: JSON.stringify({ 'v1/santa': hex(KEY_SANTA), 'v1/programmer': 3 }),
        ACHIEVEMENT_TAG_KEY: TAG_KEY,
        ...env,
    });
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
}

async function achievement(userId, type) {
    const { insertedId } = await (await getCollection('achievements')).insertOne({
        chat_id: -100777,
        user_id: userId,
        type,
        collection: 'v1',
        date: 1,
    });
    return String(insertedId);
}

const mintRequest = (user, achievementId, wallet = WALLET) =>
    callApi('mint-voucher', { method: 'POST', user, body: { achievementId, wallet: wallet.toString() } });

const backendPublicKey = () => keyPairFromSeed(Buffer.from(process.env.BACKEND_SECRET, 'hex')).publicKey;

// The MintAchievement body: opcode, ref(voucher), 512-bit signature.
function openBody(payloadB64) {
    const s = Cell.fromBase64(payloadB64).beginParse();
    assert.equal(s.loadUint(32), OP.MintAchievement);
    const voucher = s.loadRef();
    const signature = s.loadBuffer(64);
    s.endParse();
    return { voucher, signature };
}

function envelope(voucher, version) {
    const b = beginCell().storeUint(VOUCHER_TAG.Mint, 32);
    if (version === 3) b.storeInt(GLOBAL_ID.testnet, 32);
    return b.storeAddress(Address.parse(REGISTRY)).storeRef(voucher).endCell();
}

itest('a v3 registry gets the v3 voucher: template key, the caller wallet, the user tag, a short expiry', async () => {
    configure();
    chain.achievementTemplates.add(hex(KEY_SANTA));
    const id = await achievement(ALICE, 'santa');
    const before = Math.floor(Date.now() / 1000);
    const res = await mintRequest(ALICE, id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.amount, GAS.mintTon);
    assert.ok(Address.parse(res.body.to).equals(Address.parse(REGISTRY)));
    assert.equal(res.body.template_key, hex(KEY_SANTA));
    assert.equal(res.body.template_id, undefined);

    const { voucher, signature } = openBody(res.body.payload_b64);
    const v = voucher.beginParse();
    assert.equal(v.loadUintBig(256), KEY_SANTA);
    assert.ok(v.loadAddress().equals(WALLET));
    assert.equal(v.loadUintBig(256), userTag(ALICE));
    const expiry = Number(v.loadUintBig(64));
    v.endParse();
    assert.ok(expiry > before && expiry <= before + SECONDS.mintVoucherTtl + 5);
    assert.ok(SECONDS.mintVoucherTtl <= 86400, 'the registry refuses vouchers that live over a day');
    assert.equal(res.body.expiry, expiry);
    // signed in the v3 envelope (network-bound), for the registry
    assert.ok(signVerify(envelope(voucher, 3).hash(), signature, backendPublicKey()));
    assert.ok(!signVerify(envelope(voucher, 2).hash(), signature, backendPublicKey()));

    // the raw Telegram id is nowhere in the payload
    const bits = voucher.bits.toString();
    assert.ok(!bits.includes(BigInt.asUintN(64, BigInt(ALICE)).toString(16).toUpperCase().padStart(16, '0')));
    // the template and item were looked up by key and tag
    const minted = chain.calls.find((c) => c.name === 'fetchAchievementMinted');
    assert.deepEqual(minted.args.slice(1).map(BigInt), [KEY_SANTA, userTag(ALICE)]);
    const record = await (await getCollection('mints')).findOne({ user_id: ALICE });
    assert.equal(record.template_key, hex(KEY_SANTA));
    assert.equal(record.recipient, WALLET.toString());
    assert.equal(record.nonce, undefined);
});

itest('v3: an existing SBT is "already minted"; an unregistered template or a missing tag key mints nothing', async () => {
    configure();
    const id = await achievement(ALICE, 'santa');

    // the template is not registered on-chain: the mint would bounce
    let res = await mintRequest(ALICE, id);
    assert.equal(res.status, 503);
    chain.achievementTemplates.add(hex(KEY_SANTA));

    // the SBT of (template, Alice) exists
    chain.achievementItems.add(`${hex(KEY_SANTA)}:${hex(userTag(ALICE))}`);
    res = await mintRequest(ALICE, id);
    assert.equal(res.status, 409);
    // from another wallet too: the SBT is per Telegram user, not per wallet
    res = await mintRequest(ALICE, id, Address.parse(address('alice-second-wallet')));
    assert.equal(res.status, 409);

    // Bob's is free
    const bobs = await achievement(BOB, 'santa');
    assert.equal((await mintRequest(BOB, bobs)).status, 200);

    // no tag key: refuse instead of guessing
    configure({ ACHIEVEMENT_TAG_KEY: undefined });
    assert.equal((await mintRequest(BOB, bobs)).status, 503);
    // and no signing for a template configured as a v2 id
    configure();
    const programmer = await achievement(BOB, 'programmer');
    assert.equal((await mintRequest(BOB, programmer)).status, 503);
    assert.equal(await (await getCollection('mints')).countDocuments({ user_id: BOB }), 1);
});

itest('a v2 registry keeps the legacy voucher (template id, Telegram id, nonce) and isMinted', async () => {
    configure();
    chain.versions.set(Address.parse(REGISTRY).toRawString(), 2);
    const id = await achievement(ALICE, 'programmer');
    const res = await mintRequest(ALICE, id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.template_id, 3);
    const { voucher, signature } = openBody(res.body.payload_b64);
    const v = voucher.beginParse();
    assert.equal(v.loadUint(32), 3);
    assert.ok(v.loadAddress().equals(WALLET));
    assert.equal(v.loadIntBig(64), BigInt(ALICE));
    assert.equal(v.loadUintBig(64), 1n); // nonce
    v.loadUintBig(64);
    v.endParse();
    assert.ok(signVerify(envelope(voucher, 2).hash(), signature, backendPublicKey()));

    chain.achievementsV2.add(`3:${ALICE}`);
    assert.equal((await mintRequest(ALICE, id)).status, 409);
    // a v3 template key cannot be minted on a v2 registry
    const santa = await achievement(ALICE, 'santa');
    assert.equal((await mintRequest(ALICE, santa)).status, 503);
});

itest('mint-voucher refuses other users, bad input and unknown templates', async () => {
    configure();
    chain.achievementTemplates.add(hex(KEY_SANTA));
    const id = await achievement(ALICE, 'santa');
    assert.equal((await mintRequest(BOB, id)).status, 404);
    assert.equal((await callApi('mint-voucher', { method: 'POST', user: ALICE, body: { achievementId: id, wallet: 'nope' } })).status, 400);
    const other = await achievement(ALICE, 'night owl');
    assert.equal((await mintRequest(ALICE, other)).status, 400);
    configure({ ACHIEVEMENT_REGISTRY: undefined });
    assert.equal((await mintRequest(ALICE, id)).status, 503);
});

itest('/api/achievement reports the SBT status by the item address (v3) or isMinted (v2)', async () => {
    configure();
    chain.achievementTemplates.add(hex(KEY_SANTA));
    const id = await achievement(ALICE, 'santa');
    let res = await callApi('achievement', { user: ALICE, query: { _id: id } });
    assert.equal(res.status, 200);
    assert.deepEqual(
        { mintable: res.body.nft.mintable, minted: res.body.nft.minted, soulbound: res.body.nft.soulbound },
        { mintable: true, minted: false, soulbound: true },
    );
    chain.achievementItems.add(`${hex(KEY_SANTA)}:${hex(userTag(ALICE))}`);
    res = await callApi('achievement', { user: ALICE, query: { _id: id } });
    assert.equal(res.body.nft.minted, true);

    chain.versions.set(Address.parse(REGISTRY).toRawString(), 2);
    const programmer = await achievement(ALICE, 'programmer');
    res = await callApi('achievement', { user: ALICE, query: { _id: programmer } });
    assert.equal(res.body.nft.minted, false);
    chain.achievementsV2.add(`3:${ALICE}`);
    res = await callApi('achievement', { user: ALICE, query: { _id: programmer } });
    assert.equal(res.body.nft.minted, true);

    // not mintable: no template, or a template of the other protocol
    const owl = await achievement(ALICE, 'night owl');
    res = await callApi('achievement', { user: ALICE, query: { _id: owl } });
    assert.equal(res.body.nft.mintable, false);
    res = await callApi('achievement', { user: ALICE, query: { _id: id } }); // v3 key on the v2 registry
    assert.equal(res.body.nft.mintable, false);
});
