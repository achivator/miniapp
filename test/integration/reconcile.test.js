// Integration tests for settling expired claim vouchers against the chain
// (lib/rewards.js reconcileExpiredClaims, CP-10): only past a safety margin
// after expiry, and from what the pool's protocol version can tell. A v3
// pool keeps a nonce burnt (nonceState): unused and bounced vouchers are
// released, used ones confirmed, retired ones kept for a manual look.
const h = require('./helpers');
const assert = require('node:assert/strict');
const path = require('node:path');

const { itest, seed, chain, callApi, getCollection, ago, address } = h;
const { SECONDS } = require(path.join(h.SRC, 'lib/ton/constants.js'));

h.setupIntegration();

const CHAT = -1007777777777;
const CREATOR = 111;
const ALICE = 222;
const JETTON = address('jetton');

const nowSec = () => Math.floor(Date.now() / 1000);
const dashboard = () => callApi('me/chats', { user: ALICE });
const rewardsOf = async () => (await getCollection('rewards')).findOne({ chat_id: CHAT, user_id: ALICE });
const statuses = async () => (await (await getCollection('claims')).find({}).sort({ nonce: 1 }).toArray()).map((c) => c.status);

async function seedVouchers(pool, expiries) {
    await seed.chat({ id: CHAT, creator: CREATOR, jetton_master: JETTON, claim_settings: { maturation_days: 0 } });
    await seed.grant(CHAT, ALICE, 100, ago(10));
    await seed.rewards(CHAT, ALICE, 100, 10 * expiries.length);
    await (await getCollection('claims')).insertMany(
        expiries.map((expiry, i) => ({
            chat_id: CHAT,
            user_id: ALICE,
            points: 10,
            amount: '100000000',
            nonce: i + 1,
            jetton_master: JETTON,
            pool_address: pool.address.toString(),
            expiry,
            status: 'issued',
            created_at: expiry - 3600,
        })),
    );
}

itest('a voucher is settled only past the margin after its expiry', async () => {
    chain.addJetton(JETTON);
    const pool = chain.addPool(CHAT);
    const margin = SECONDS.claimReconcileMargin;
    assert.ok(margin >= 600);
    // 1: expired a minute ago (a claim may still be in flight); 2: past the margin
    await seedVouchers(pool, [nowSec() - 60, nowSec() - margin - 60]);
    await dashboard();
    assert.deepEqual(await statuses(), ['issued', 'expired']);
    assert.equal((await rewardsOf()).claimed_points, 10);
});

itest('v3: a bounced voucher is released (reissued under a new nonce), a used one confirmed', async () => {
    chain.addJetton(JETTON);
    const pool = chain.addPool(CHAT, { version: 3 });
    const past = nowSec() - 3600;
    await seedVouchers(pool, [past, past, past]);
    pool.usedNonces.add(1); // paid
    pool.nonceStates.set(2, 2); // its transfer bounced: the jettons stayed
    // 3: never sent
    await dashboard();
    assert.deepEqual(await statuses(), ['claimed', 'expired', 'expired']);
    assert.equal((await rewardsOf()).claimed_points, 10);
    assert.ok(chain.calls.some((c) => c.name === 'runGetMethod' && c.args[1] === 'nonceState'));
    assert.ok(!chain.calls.some((c) => c.name === 'runGetMethod' && c.args[1] === 'isNonceUsed'));

    // the released points are claimed again under a new nonce, never the
    // bounced one: the counter only moves up
    await (await getCollection('counters')).insertOne({ _id: `nonce_${CHAT}`, seq: 3 });
    const res = await callApi('claim-voucher', { method: 'POST', user: ALICE, body: { chatId: CHAT, wallet: address('alice-wallet') } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.nonce, 4);
    assert.ok(res.body.expiry - nowSec() <= SECONDS.maxClaimVoucherTtl);
});

itest('v3: a retired nonce is never released: its points stay, the claim is marked unknown', async () => {
    chain.addJetton(JETTON);
    const pool = chain.addPool(CHAT, { version: 3 });
    await seedVouchers(pool, [nowSec() - 30 * 86400]);
    pool.nonceStates.set(1, 3);
    await dashboard();
    assert.deepEqual(await statuses(), ['unknown']);
    assert.equal((await rewardsOf()).claimed_points, 10);
});

itest('v2: isNonceUsed decides, as before', async () => {
    chain.addJetton(JETTON);
    const pool = chain.addPool(CHAT, { version: 2 });
    const past = nowSec() - 3600;
    await seedVouchers(pool, [past, past]);
    pool.usedNonces.add(2);
    await dashboard();
    assert.deepEqual(await statuses(), ['expired', 'claimed']);
    assert.ok(!chain.calls.some((c) => c.name === 'runGetMethod' && c.args[1] === 'nonceState'));
});
