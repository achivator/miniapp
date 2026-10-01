// Integration tests for POST /api/claim-voucher against MongoDB: lot
// valuation after a price decrease, partial claims sized to the pool's daily
// budget, and the conditional update (claimPoints with expectedClaimed) that
// stops concurrent claims from issuing two vouchers for the same points.
const h = require('./helpers');
const assert = require('node:assert/strict');

const { itest, seed, chain, callApi, getCollection, ago, address } = h;

h.setupIntegration();

const CHAT = -1001234567890;
const CREATOR = 111;
const ALICE = 222;
const JETTON = address('jetton');
const WALLET = address('alice-wallet');

const claim = (user = ALICE) => callApi('claim-voucher', { method: 'POST', user, body: { chatId: CHAT, wallet: WALLET } });
const rewardsOf = async (user = ALICE) => (await getCollection('rewards')).findOne({ chat_id: CHAT, user_id: user });
const claimDocs = async () => (await getCollection('claims')).find({ chat_id: CHAT }).sort({ nonce: 1 }).toArray();

// The price dropped 0.02 -> 0.01 a day ago; maturation is 3 days. Alice has:
//   100 points granted 10 days ago  matured long before the drop -> 0.01
//    50 points from 3.5 days ago    maturing when it dropped, now claimable -> 0.02
//    30 points from 2 days ago      maturing across the drop, still maturing
//    20 points from 12 hours ago    earned after the drop, still maturing
async function seedAfterDecrease() {
    chain.addJetton(JETTON, { decimals: 9, symbol: 'TST' });
    const pool = chain.addPool(CHAT);
    await seed.chat({
        id: CHAT,
        creator: CREATOR,
        jetton_master: JETTON,
        point_price: '0.01',
        point_price_history: [{ old: '0.02', new: '0.01', at: ago(1), by: CREATOR }],
        claim_settings: { maturation_days: 3 },
    });
    await seed.grant(CHAT, ALICE, 100, ago(10));
    await seed.reaction(CHAT, ALICE, 50, ago(3.5));
    await seed.reaction(CHAT, ALICE, 30, ago(2));
    await seed.reaction(CHAT, ALICE, 20, ago(0.5));
    await seed.rewards(CHAT, ALICE, 200);
    return pool;
}

itest('a claim after a decrease pays points that were maturing at the old price', async () => {
    await seedAfterDecrease();

    const res = await claim();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.points, 150);
    assert.equal(res.body.remaining_points, 0);
    assert.equal(res.body.point_price, '0.01');
    assert.equal(res.body.jettons, '2');
    assert.deepEqual(res.body.price_breakdown, [
        { price: '0.01', points: 100, jettons: '1' },
        { price: '0.02', points: 50, jettons: '1' },
    ]);
    assert.equal(res.body.nonce, 1);
    assert.equal(res.body.to, chain.pools.get(CHAT).address.toString());
    assert.ok(res.body.payload_b64.length > 0);

    // the ledger: points deducted, the voucher recorded with its breakdown
    assert.equal((await rewardsOf()).claimed_points, 150);
    const [doc, ...more] = await claimDocs();
    assert.equal(more.length, 0);
    assert.equal(doc.status, 'issued');
    assert.equal(doc.points, 150);
    assert.equal(doc.amount, '2000000000');
    assert.equal(doc.point_price, '0.01');
    assert.deepEqual(doc.price_breakdown, [
        { price: '0.01', points: 100, units: '1000000000' },
        { price: '0.02', points: 50, units: '1000000000' },
    ]);
    assert.equal(doc.jetton_master, JETTON);
    assert.ok(doc.expiry > Math.floor(Date.now() / 1000));

    // nothing left to claim: the 50 maturing points are refused
    const again = await claim();
    assert.equal(again.status, 400);
    assert.match(again.body.error, /still maturing/);
    assert.equal(again.body.maturing, 50);
    assert.equal((await claimDocs()).length, 1);
});

itest('a decrease saved with no notice applies to the next claim; maturing lots keep the old price', async (t) => {
    chain.addJetton(JETTON, { decimals: 9, symbol: 'TST' });
    chain.addPool(CHAT);
    h.telegram.setStatus(CHAT, CREATOR, 'creator');
    await seed.chat({ id: CHAT, creator: CREATOR, jetton_master: JETTON, point_price: '0.02', claim_settings: { maturation_days: 3 } });
    await seed.grant(CHAT, ALICE, 100, ago(10)); // matured: gets the new price
    await seed.reaction(CHAT, ALICE, 40, ago(1)); // still maturing at the drop
    await seed.rewards(CHAT, ALICE, 140);

    const saved = process.env.POINT_PRICE_NOTICE_DAYS;
    process.env.POINT_PRICE_NOTICE_DAYS = '0';
    t.after(() => {
        process.env.POINT_PRICE_NOTICE_DAYS = saved;
    });
    const save = await callApi('point-price', { method: 'POST', user: CREATOR, body: { chatId: CHAT, price: '0.005' } });
    assert.equal(save.status, 200, JSON.stringify(save.body));
    assert.equal(save.body.price, '0.005');
    // no notice: nothing announced ahead (the bot announces it when it applies it)
    assert.equal(save.body.announced, null);

    const res = await claim();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.point_price, '0.005');
    assert.equal(res.body.points, 100);
    assert.equal(res.body.jettons, '0.5');

    // three days later (moved back in the data) the 40 points have matured
    // and are paid at the price from before the drop
    const reactions = await getCollection('reaction_points');
    await reactions.updateOne({ chat_id: CHAT, receiver_id: ALICE }, { $set: { date: ago(3.1) } });
    const chats = await getCollection('chats');
    const chat = await chats.findOne({ id: CHAT });
    const shift = (d) => new Date(d.getTime() - 2.1 * h.DAY_MS);
    await chats.updateOne(
        { id: CHAT },
        {
            $set: {
                'point_price_pending.effective_at': shift(chat.point_price_pending.effective_at),
                'point_price_pending.requested_at': shift(chat.point_price_pending.requested_at),
            },
        },
    );
    const later = await claim();
    assert.equal(later.status, 200, JSON.stringify(later.body));
    assert.equal(later.body.points, 40);
    assert.deepEqual(later.body.price_breakdown, [{ price: '0.02', points: 40, jettons: '0.8' }]);
});

itest('a short daily budget gives a partial claim of the oldest lots; the rest stays claimable', async () => {
    const pool = await seedAfterDecrease();
    pool.claimableToday = 1_500_000_000n; // 1.5 TST

    const first = await claim();
    assert.equal(first.status, 200, JSON.stringify(first.body));
    // 100 @ 0.01 = 1 TST, then 25 of the 50 @ 0.02 = 0.5 TST
    assert.equal(first.body.points, 125);
    assert.equal(first.body.remaining_points, 25);
    assert.equal(first.body.jettons, '1.5');
    assert.deepEqual(
        first.body.price_breakdown.map((b) => [b.price, b.points]),
        [
            ['0.01', 100],
            ['0.02', 25],
        ],
    );
    assert.equal((await rewardsOf()).claimed_points, 125);

    // the budget is spent: a 409, not a zero-amount voucher
    pool.claimableToday = 0n;
    const broke = await claim();
    assert.equal(broke.status, 409);
    assert.match(broke.body.error, /paid out its limit/);
    assert.equal((await rewardsOf()).claimed_points, 125);

    // next day: the claim continues where the last one stopped (FIFO), so the
    // rest of the 3.5-day-old lot keeps its pre-decrease price
    pool.claimableToday = 10n ** 15n;
    const second = await claim();
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.points, 25);
    assert.equal(second.body.jettons, '0.5');
    assert.deepEqual(second.body.price_breakdown, [{ price: '0.02', points: 25, jettons: '0.5' }]);
    assert.equal((await rewardsOf()).claimed_points, 150);
    assert.deepEqual(
        (await claimDocs()).map((d) => [d.points, d.amount]),
        [
            [125, '1500000000'],
            [25, '500000000'],
        ],
    );
});

itest('two concurrent claims: one voucher, the other gets 409', async () => {
    chain.addJetton(JETTON);
    chain.addPool(CHAT);
    await seed.chat({ id: CHAT, creator: CREATOR, jetton_master: JETTON, claim_settings: { maturation_days: 3 } });
    await seed.grant(CHAT, ALICE, 100, ago(10));
    await seed.rewards(CHAT, ALICE, 100);

    // Both requests have read the balance (claimed_points 0) before either
    // books its claim.
    chain.hooks.fetchPoolClaimControls = h.barrier(2);
    const results = await Promise.all([claim(), claim()]);

    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 409], JSON.stringify(results.map((r) => r.body)));
    const lost = results.find((r) => r.status === 409);
    assert.match(lost.body.error, /changed meanwhile/);
    const won = results.find((r) => r.status === 200);
    assert.equal(won.body.points, 100);
    assert.equal(won.body.jettons, '1'); // platform default 0.01

    assert.equal((await rewardsOf()).claimed_points, 100);
    const docs = await claimDocs();
    assert.equal(docs.length, 1);
    assert.equal(docs[0].nonce, won.body.nonce);
});

itest('a release between sizing and booking a claim makes it fail (expectedClaimed)', async () => {
    chain.addJetton(JETTON);
    chain.addPool(CHAT);
    await seed.chat({ id: CHAT, creator: CREATOR, jetton_master: JETTON, claim_settings: { maturation_days: 0 } });
    await seed.grant(CHAT, ALICE, 100, ago(10));
    // 50 points sit in an issued voucher that is still valid
    await seed.rewards(CHAT, ALICE, 100, 50);

    // While the claim is on the chain calls, another request releases those
    // 50 points (as reconcileExpiredClaims does). The claim was valued as the
    // points after claimed_points = 50; booked onto claimed_points = 0 it
    // would take different lots than the ones it priced, so it must fail even
    // though the balance would allow it.
    chain.hooks.fetchPoolClaimControls = async () => {
        chain.hooks.fetchPoolClaimControls = null;
        await (await getCollection('rewards')).updateOne({ chat_id: CHAT, user_id: ALICE }, { $inc: { claimed_points: -50 } });
    };
    const res = await claim();
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.match(res.body.error, /changed meanwhile/);
    assert.equal((await rewardsOf()).claimed_points, 0);
    assert.equal((await claimDocs()).length, 0);

    // a retry sees the new balance and claims all 100
    const retry = await claim();
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.points, 100);
    assert.equal((await rewardsOf()).claimed_points, 100);
});

itest('claims are refused while paused by the chat admin, and without an active pool', async () => {
    chain.addJetton(JETTON);
    await seed.chat({ id: CHAT, creator: CREATOR, jetton_master: JETTON, claim_settings: { maturation_days: 0, paused: true } });
    await seed.grant(CHAT, ALICE, 100, ago(10));
    await seed.rewards(CHAT, ALICE, 100);

    const paused = await claim();
    assert.equal(paused.status, 409);
    assert.match(paused.body.error, /paused/);

    await (await getCollection('chats')).updateOne({ id: CHAT }, { $set: { 'claim_settings.paused': false } });
    const noPool = await claim();
    assert.equal(noPool.status, 409);
    assert.match(noPool.body.error, /not activated/);

    assert.equal((await rewardsOf()).claimed_points, 0);
    assert.equal((await claimDocs()).length, 0);
});
