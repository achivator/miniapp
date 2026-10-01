// Integration tests for the stored platform default (miniapp#12) against
// MongoDB: lowering JETTONS_PER_POINT schedules a platform decrease with
// notice instead of re-pricing every chat on the default at once; members
// see it ahead and in the history, points maturing at it keep the earlier
// price, and a decrease called off is announced as cancelled where it was
// announced.
const h = require('./helpers');
const assert = require('node:assert/strict');

const { itest, seed, chain, telegram, callApi, getCollection, ago, address, DAY_MS, resetPlatformDefault } = h;

h.setupIntegration();

const ON_DEFAULT = -1007777777777;
const CUSTOM = -1007777777778;
const CREATOR = 111;
const ALICE = 222;
const JETTON = address('jetton');
const WALLET = address('alice-wallet');

const dashboard = () => callApi('me/chats', { user: ALICE });
const itemOf = (res, chatId = ON_DEFAULT) => res.body.rewards.find((r) => r.chat_id === chatId);
const priceView = (chatId) => callApi('point-price', { user: CREATOR, query: { chatId } });
const settings = async () => (await getCollection('settings')).findOne({ _id: 'point_price_default' });
const nowSec = () => Math.floor(Date.now() / 1000);

// The operator changes JETTONS_PER_POINT and redeploys: a new process. The
// env is put back after the test.
const savedRates = new WeakMap();
function redeployWith(t, rate) {
    if (!savedRates.has(t)) {
        savedRates.set(t, process.env.JETTONS_PER_POINT);
        t.after(() => {
            process.env.JETTONS_PER_POINT = savedRates.get(t);
        });
    }
    process.env.JETTONS_PER_POINT = rate;
    resetPlatformDefault();
}

async function seedChats() {
    chain.addJetton(JETTON, { decimals: 9, symbol: 'TST' });
    chain.addPool(ON_DEFAULT);
    telegram.setStatus(ON_DEFAULT, CREATOR, 'creator');
    telegram.setStatus(CUSTOM, CREATOR, 'creator');
    const claimSettings = { maturation_days: 3 };
    await seed.chat({ id: ON_DEFAULT, creator: CREATOR, jetton_master: JETTON, claim_settings: claimSettings });
    await seed.chat({ id: CUSTOM, creator: CREATOR, jetton_master: JETTON, point_price: '0.02', claim_settings: claimSettings });
    // 100 points matured long ago, 40 earned 3.5 days ago (still maturing a
    // day ago)
    await seed.grant(ON_DEFAULT, ALICE, 100, ago(10));
    await seed.reaction(ON_DEFAULT, ALICE, 40, ago(3.5));
    await seed.rewards(ON_DEFAULT, ALICE, 140);
}

itest('lowering JETTONS_PER_POINT gives chats on the default notice, history and protected points', async (t) => {
    t.mock.method(console, 'warn', () => {});
    await seedChats();

    // first run: the stored default is seeded from the env
    assert.equal((await dashboard()).status, 200);
    assert.equal((await settings()).price, '0.01');

    // the operator lowers it: a platform decrease with the notice, the old
    // price still paying
    redeployWith(t, '0.005');
    const res = await dashboard();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const stored = await settings();
    assert.equal(stored.price, '0.01');
    assert.equal(stored.pending.price, '0.005');
    assert.equal(stored.pending.from, '0.01');
    assert.ok(Math.abs(stored.pending.effective_at.getTime() - (Date.now() + 7 * DAY_MS)) < 60_000);
    assert.equal(res.body.config.jettons_per_point, '0.01');
    const item = itemOf(res);
    assert.equal(item.point_price, '0.01');
    assert.equal(item.point_price_custom, false);
    assert.equal(item.point_price_pending.to, '0.005');
    assert.equal(item.point_price_pending.effective_at, Math.floor(stored.pending.effective_at.getTime() / 1000));
    // all 140 points are claimable: matured by now, at the price in force
    assert.equal(item.jettons, '1.4');

    // the creator sees it on the price card (and cannot cancel it); a chat
    // with its own price only sees where the default is going
    const card = await priceView(ON_DEFAULT);
    assert.equal(card.status, 200, JSON.stringify(card.body));
    assert.equal(card.body.pending.platform, true);
    assert.equal(card.body.pending.price, '0.005');
    assert.equal(card.body.platform_price, '0.01');
    assert.equal(card.body.platform_target, '0.005');
    const custom = await priceView(CUSTOM);
    assert.equal(custom.body.pending, null);
    assert.equal(custom.body.platform_pending.price, '0.005');
    // the claim rules guard it like a creator's decrease
    const pause = await callApi('claim-settings', {
        method: 'POST',
        user: CREATOR,
        body: { chatId: ON_DEFAULT, settings: { paused: true, paused_until: null } },
    });
    assert.equal(pause.status, 409, JSON.stringify(pause.body));
    assert.equal(pause.body.code, 'pause');

    // ...a week later (moved back in time here), it is in effect: the new
    // price pays, members are told, and the 40 points still maturing a day
    // ago keep the earlier price
    await (await getCollection('settings')).updateOne(
        { _id: 'point_price_default' },
        { $set: { 'pending.effective_at': ago(1), 'pending.requested_at': ago(8) } },
    );
    const after = itemOf(await dashboard());
    assert.equal(after.point_price, '0.005');
    assert.equal(after.point_price_pending, null);
    assert.deepEqual(
        { ...after.point_price_change, at: null },
        { old: '0.01', new: '0.005', at: null, changes: 1, reason: 'platform_default' },
    );
    assert.ok(Math.abs(after.point_price_change.at - (nowSec() - 86400)) < 60);
    assert.equal(after.jettons, '0.9');
    assert.deepEqual(after.jettons_breakdown, [
        { price: '0.005', points: 100, jettons: '0.5' },
        { price: '0.01', points: 40, jettons: '0.4' },
    ]);
    const claimed = await callApi('claim-voucher', { method: 'POST', user: ALICE, body: { chatId: ON_DEFAULT, wallet: WALLET } });
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    assert.equal(claimed.body.jettons, '0.9');
    // a chat with its own price was never touched
    assert.equal((await priceView(CUSTOM)).body.price, '0.02');
});

itest('a platform decrease called off is announced as cancelled where it was announced', async (t) => {
    t.mock.method(console, 'warn', () => {});
    await seedChats();
    await dashboard();
    redeployWith(t, '0.005');
    await dashboard();
    const { pending } = await settings();
    const ref = pending.requested_at.getTime();
    // the bot announced it in the chat on the default (index.mjs)
    const outbox = await getCollection('announcements');
    await outbox.insertOne({
        key: `${ON_DEFAULT}:price_decrease_scheduled:platform:${ref}`,
        chat_id: ON_DEFAULT,
        type: 'price_decrease_scheduled',
        params: { from: '0.01', to: '0.005', symbol: null, effective_at: pending.effective_at },
        platform: ref,
        created_at: pending.requested_at,
        sent_at: new Date(),
        claimed_at: null,
        attempts: 0,
    });

    redeployWith(t, '0.01');
    assert.equal((await dashboard()).status, 200);
    const stored = await settings();
    assert.equal(stored.pending, undefined);
    assert.equal(stored.price, '0.01');
    assert.ok(stored.cancelled.announced_at);
    const rows = await outbox.find({ type: 'price_decrease_cancelled' }).toArray();
    assert.deepEqual(
        rows.map((r) => [r.key, r.chat_id, r.params]),
        [[`${ON_DEFAULT}:price_decrease_cancelled:platform:${ref}`, ON_DEFAULT, { from: '0.01', to: '0.005', symbol: null }]],
    );
    // once
    resetPlatformDefault();
    await dashboard();
    assert.equal(await outbox.countDocuments({ type: 'price_decrease_cancelled' }), 1);
    assert.equal(itemOf(await dashboard()).point_price_pending, null);
});

itest('raising JETTONS_PER_POINT applies at once', async (t) => {
    await seedChats();
    await dashboard();
    redeployWith(t, '0.02');
    const item = itemOf(await dashboard());
    assert.equal(item.point_price, '0.02');
    assert.equal(item.point_price_change.reason, 'platform_default');
    const stored = await settings();
    assert.equal(stored.price, '0.02');
    assert.deepEqual(stored.history.map((e) => [e.old, e.new]), [['0.01', '0.02']]);
});
