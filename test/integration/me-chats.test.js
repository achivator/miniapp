// Integration tests for GET /api/me/chats (the member's dashboard) against
// MongoDB: points valued like a claim values them, vouchers in flight, the
// settlement of expired vouchers against the chain, and the price notices.
const h = require('./helpers');
const assert = require('node:assert/strict');

const { itest, seed, chain, callApi, getCollection, ago, address, DAY_MS, MASTER_ADDRESS } = h;

h.setupIntegration();

const CHAT = -1005555555555;
const CREATOR = 111;
const ALICE = 222;
const JETTON = address('jetton');
const WALLET = address('alice-wallet');

const dashboard = (user = ALICE) => callApi('me/chats', { user });
const itemOf = (res) => res.body.rewards.find((r) => r.chat_id === CHAT);
const claim = () => callApi('claim-voucher', { method: 'POST', user: ALICE, body: { chatId: CHAT, wallet: WALLET } });
const rewardsOf = async () => (await getCollection('rewards')).findOne({ chat_id: CHAT, user_id: ALICE });
const nowSec = () => Math.floor(Date.now() / 1000);

itest('the dashboard values claimable and maturing points like a claim, and lists the voucher', async () => {
    chain.addJetton(JETTON, { decimals: 9, symbol: 'TST' });
    chain.addPool(CHAT);
    await seed.chat({
        id: CHAT,
        title: 'Test chat',
        creator: CREATOR,
        jetton_master: JETTON,
        point_price: '0.01',
        point_price_history: [{ old: '0.02', new: '0.01', at: ago(1), by: CREATOR }],
        claim_settings: { maturation_days: 3 },
    });
    await seed.grant(CHAT, ALICE, 100, ago(10), 'welcome');
    await seed.reaction(CHAT, ALICE, 50, ago(3.5)); // maturing at the drop, claimable now
    const maturingSince = ago(2);
    await seed.reaction(CHAT, ALICE, 30, maturingSince); // maturing across the drop
    await seed.reaction(CHAT, ALICE, 20, ago(0.5)); // earned after the drop
    await seed.rewards(CHAT, ALICE, 200);

    const res = await dashboard();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.dev, false);
    assert.deepEqual(res.body.config, { network: 'testnet', master_address: MASTER_ADDRESS, jettons_per_point: '0.01' });
    assert.deepEqual(res.body.creator, []);
    const item = itemOf(res);
    assert.equal(item.title, 'Test chat');
    assert.equal(item.decimals, 9);
    assert.equal(item.symbol, 'TST');
    assert.equal(item.points, 200);
    assert.equal(item.available_points, 150);
    assert.equal(item.maturing_points, 50);
    assert.equal(item.next_mature_at, Math.floor(maturingSince.getTime() / 1000) + 3 * 86400);
    assert.equal(item.maturation_days, 3);
    assert.equal(item.claim_gate.open, true);
    assert.equal(item.jettons, '2');
    assert.deepEqual(item.jettons_breakdown, [
        { price: '0.01', points: 100, jettons: '1' },
        { price: '0.02', points: 50, jettons: '1' },
    ]);
    // the 30 points maturing across the drop will keep the old price
    assert.equal(item.maturing_jettons, '0.8');
    assert.deepEqual(item.maturing_breakdown, [
        { price: '0.02', points: 30, jettons: '0.6' },
        { price: '0.01', points: 20, jettons: '0.2' },
    ]);
    assert.equal(item.point_price, '0.01');
    assert.equal(item.point_price_custom, true);
    assert.equal(item.point_price_change.old, '0.02');
    assert.equal(item.point_price_change.new, '0.01');
    assert.equal(item.point_price_pending, null);
    assert.deepEqual(item.grants.map((g) => [g.points, g.reason]), [[100, 'welcome']]);
    assert.deepEqual(item.pending, []);

    // the claim pays exactly what the dashboard showed
    const claimed = await claim();
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    assert.equal(claimed.body.jettons, item.jettons);

    const after = itemOf(await dashboard());
    assert.equal(after.available_points, 0);
    assert.equal(after.maturing_points, 50);
    assert.equal(after.jettons, '0');
    assert.equal(after.maturing_jettons, '0.8');
    assert.deepEqual(after.pending, [{ nonce: 1, amount: '2', expiry: claimed.body.expiry }]);

    // the creator's own dashboard lists the chat they run
    const mine = await dashboard(CREATOR);
    assert.deepEqual(mine.body.rewards, []);
    assert.deepEqual(mine.body.creator, [{ chat_id: CHAT, title: 'Test chat', jetton_master: JETTON }]);
});

itest('expired vouchers are settled against the chain: released if unused, confirmed if used', async () => {
    chain.addJetton(JETTON);
    const pool = chain.addPool(CHAT);
    await seed.chat({ id: CHAT, creator: CREATOR, jetton_master: JETTON, claim_settings: { maturation_days: 0 } });
    await seed.grant(CHAT, ALICE, 100, ago(10));
    await seed.rewards(CHAT, ALICE, 100, 100);
    const expired = nowSec() - 60;
    const claims = await getCollection('claims');
    const voucher = (nonce, points) => ({
        chat_id: CHAT,
        user_id: ALICE,
        points,
        amount: String(points * 10_000_000),
        nonce,
        jetton_master: JETTON,
        expiry: expired,
        status: 'issued',
        created_at: expired - 3600,
    });
    await claims.insertMany([voucher(1, 40), voucher(2, 60)]);
    pool.usedNonces.add(2); // only the second one was sent

    // while the chain cannot be read, nothing is settled
    chain.pools.delete(CHAT);
    const blind = itemOf(await dashboard());
    assert.equal(blind.available_points, 0);
    assert.deepEqual((await claims.find({}).sort({ nonce: 1 }).toArray()).map((c) => c.status), ['issued', 'issued']);

    chain.pools.set(CHAT, pool);
    const item = itemOf(await dashboard());
    assert.equal(item.available_points, 40);
    assert.equal(item.jettons, '0.4');
    assert.deepEqual(item.pending, []);
    assert.equal((await rewardsOf()).claimed_points, 60);
    const settled = await claims.find({}).sort({ nonce: 1 }).toArray();
    assert.deepEqual(settled.map((c) => c.status), ['expired', 'claimed']);
    assert.ok(settled.every((c) => Number.isInteger(c.resolved_at)));

    // settling twice never credits the points back twice
    await dashboard();
    assert.equal((await rewardsOf()).claimed_points, 60);

    // and the released points can be claimed again
    const again = await claim();
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.points, 40);
    assert.equal((await rewardsOf()).claimed_points, 100);
});

itest('a scheduled decrease is shown as a price drop until it applies', async (t) => {
    chain.addJetton(JETTON);
    await seed.chat({
        id: CHAT,
        creator: CREATOR,
        jetton_master: JETTON,
        point_price: '0.02',
        point_price_pending: {
            price: '0.01',
            to_default: true,
            from: '0.02',
            symbol: 'TST',
            effective_at: new Date(Date.now() + 5 * DAY_MS),
            requested_at: ago(2),
            by: CREATOR,
        },
    });
    await seed.grant(CHAT, ALICE, 100, ago(10));
    await seed.rewards(CHAT, ALICE, 100);

    const item = itemOf(await dashboard());
    assert.equal(item.point_price, '0.02');
    assert.equal(item.jettons, '2');
    assert.equal(item.point_price_pending.to, '0.01');
    assert.ok(Math.abs(item.point_price_pending.effective_at - (nowSec() + 5 * 86400)) <= 60);

    // "back to the default" follows the live default: once the operator
    // raises it above the current price it is no drop any more
    const saved = process.env.JETTONS_PER_POINT;
    process.env.JETTONS_PER_POINT = '0.03';
    t.after(() => {
        process.env.JETTONS_PER_POINT = saved;
    });
    const raised = itemOf(await dashboard());
    assert.equal(raised.point_price, '0.02');
    assert.equal(raised.point_price_pending, null);
});

itest('an unreadable jetton shows no amounts and claims refuse to guess its decimals', async () => {
    // no jetton registered on the fake chain: its metadata has decimals null
    chain.addPool(CHAT);
    await seed.chat({ id: CHAT, creator: CREATOR, jetton_master: JETTON, claim_settings: { maturation_days: 0 } });
    await seed.grant(CHAT, ALICE, 100, ago(10));
    await seed.rewards(CHAT, ALICE, 100);

    const item = itemOf(await dashboard());
    assert.equal(item.decimals, null);
    assert.equal(item.available_points, 100);
    assert.equal(item.jettons, null);
    assert.equal(item.jettons_breakdown, null);

    const res = await claim();
    assert.equal(res.status, 502);
    assert.match(res.body.error, /decimals/);
    assert.equal((await rewardsOf()).claimed_points, 0);
});
