// Integration tests for the chat creator's member views, GET /api/pool-members
// and GET /api/pool-member, against MongoDB: balances valued like claims,
// chat totals, payout history, names from Telegram, and the creator gate.
const h = require('./helpers');
const assert = require('node:assert/strict');

const { itest, seed, chain, telegram, callApi, getCollection, ago, address } = h;

h.setupIntegration();

const CHAT = -1007777777777;
const CREATOR = 111;
const ALICE = 222;
const BOB = 333;
const REACTOR = 444;
const JETTON = address('jetton');

const members = (query = {}, user = CREATOR) => callApi('pool-members', { user, query: { chatId: CHAT, ...query } });
const member = (userId, user = CREATOR) => callApi('pool-member', { user, query: { chatId: CHAT, userId } });

// Price dropped 0.02 -> 0.01 a day ago, maturation 3 days.
//   Alice: 100 granted 10 days ago (0.01), 50 from 3.5 days ago (0.02, now
//          claimable), 30 from 2 days ago (0.02, maturing), 20 from 12 hours
//          ago (0.01, maturing); nothing claimed.
//   Bob:   50 granted 10 days ago, 20 of them paid out.
async function seedChat() {
    chain.addJetton(JETTON, { decimals: 9, symbol: 'TST' });
    chain.addPool(CHAT);
    telegram.setStatus(CHAT, CREATOR, 'creator');
    telegram.setStatus(CHAT, ALICE, 'member');
    telegram.setStatus(CHAT, BOB, 'administrator');
    telegram.setStatus(CHAT, REACTOR, 'member');
    await seed.chat({
        id: CHAT,
        title: 'Pool chat',
        creator: CREATOR,
        jetton_master: JETTON,
        point_price: '0.01',
        point_price_history: [{ old: '0.02', new: '0.01', at: ago(1), by: CREATOR }],
        claim_settings: { maturation_days: 3 },
    });
    await seed.grant(CHAT, ALICE, 100, ago(10));
    await seed.reaction(CHAT, ALICE, 50, ago(3.5), REACTOR);
    await seed.reaction(CHAT, ALICE, 30, ago(2), REACTOR);
    await seed.reaction(CHAT, ALICE, 20, ago(0.5), BOB);
    await seed.rewards(CHAT, ALICE, 200);
    await seed.grant(CHAT, BOB, 50, ago(10));
    await seed.rewards(CHAT, BOB, 50, 20);
    const paidAt = Math.floor(ago(5).getTime() / 1000);
    await (await getCollection('claims')).insertOne({
        chat_id: CHAT,
        user_id: BOB,
        points: 20,
        amount: '200000000',
        nonce: 1,
        jetton_master: JETTON,
        recipient: address('bob-wallet'),
        expiry: paidAt + 3600,
        status: 'claimed',
        created_at: paidAt,
        resolved_at: paidAt + 60,
    });
    return { paidAt };
}

itest('the member list values what the chat owes like claims do', async () => {
    const { paidAt } = await seedChat();

    const res = await members();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.jettons_per_point, '0.01');
    assert.deepEqual(res.body.jetton, { master: JETTON, symbol: 'TST', decimals: 9 });
    assert.equal(res.body.has_more, false);
    const { totals } = res.body;
    assert.equal(totals.members, 2);
    assert.equal(totals.points, 250);
    assert.equal(totals.claimed_points, 20);
    assert.equal(totals.owed_points, 230);
    // Alice 100 x 0.01 + 80 x 0.02 + 20 x 0.01 = 2.8, Bob 30 x 0.01 = 0.3
    assert.equal(totals.owed_units, '3100000000');
    assert.deepEqual(totals.payouts.paid, { count: 1, points: 20, units: '200000000' });

    assert.deepEqual(res.body.members.map((m) => m.user_id), [ALICE, BOB]);
    const [alice, bob] = res.body.members;
    assert.equal(alice.name, `User${ALICE}`);
    assert.equal(alice.status, 'member');
    assert.equal(alice.owed_points, 200);
    assert.equal(alice.owed_units, '2800000000');
    assert.equal(alice.maturing_points, 50);
    assert.equal(alice.available_points, 150);
    assert.equal(alice.last_claim_at, null);
    assert.equal(bob.status, 'administrator');
    assert.equal(bob.owed_units, '300000000');
    assert.equal(bob.available_points, 30);
    assert.equal(bob.last_claim_at, paidAt);
    assert.deepEqual(bob.payouts.paid, { count: 1, points: 20, units: '200000000' });

    // sorting and the id search run in the aggregation
    const byClaimed = await members({ sort: 'claimed' });
    assert.deepEqual(byClaimed.body.members.map((m) => m.user_id), [BOB, ALICE]);
    const onlyBob = await members({ q: String(BOB) });
    assert.deepEqual(onlyBob.body.members.map((m) => m.user_id), [BOB]);
    assert.equal(onlyBob.body.totals.members, 2);
});

itest("one member's account: balance by price, sources and payouts", async () => {
    await seedChat();

    const res = await member(ALICE);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.member.name, `User${ALICE}`);
    const b = res.body.balance;
    assert.equal(b.points, 200);
    assert.equal(b.claimed_points, 0);
    assert.equal(b.owed_points, 200);
    assert.equal(b.owed_units, '2800000000');
    assert.deepEqual(b.owed_breakdown, [
        { price: '0.01', points: 120, units: '1200000000' },
        { price: '0.02', points: 80, units: '1600000000' },
    ]);
    assert.equal(b.maturing_points, 50);
    assert.equal(b.available_points, 150);
    assert.equal(b.available_units, '2000000000');
    assert.equal(res.body.sources.reaction_points, 100);
    assert.equal(res.body.sources.reactions, 3);
    assert.equal(res.body.sources.grant_points, 100);
    assert.deepEqual(
        res.body.sources.top_reactors.map((r) => [r.user_id, r.name, r.points]),
        [
            [REACTOR, `User${REACTOR}`, 80],
            [BOB, `User${BOB}`, 20],
        ],
    );

    const bob = await member(BOB);
    assert.equal(bob.status, 200, JSON.stringify(bob.body));
    assert.deepEqual(
        bob.body.claims.map((c) => [c.nonce, c.state, c.points, c.amount, c.current_jetton]),
        [[1, 'paid', 20, '200000000', true]],
    );
    assert.equal(bob.body.balance.owed_units, '300000000');

    const nobody = await member(999999);
    assert.equal(nobody.status, 404);
    // no userId: nobody's account (Number(null) is 0, so this is a 404 rather
    // than the route's 400, but it never answers with an account)
    const noId = await callApi('pool-member', { user: CREATOR, query: { chatId: CHAT } });
    assert.ok(noId.status === 400 || noId.status === 404, String(noId.status));
});

itest('a creator check that goes stale closes the member views', async () => {
    await seedChat();

    // Telegram cannot see the creator: the stored flag is enough to read
    telegram.statuses.delete(`${CHAT}:${CREATOR}`);
    assert.equal((await members()).status, 200);
    assert.equal((await member(ALICE)).status, 200);

    // Telegram says ownership moved on: refused
    telegram.setStatus(CHAT, CREATOR, 'administrator');
    const list = await members();
    assert.equal(list.status, 403);
    assert.match(list.body.error, /Telegram does not confirm/);
    assert.equal((await member(ALICE)).status, 403);

    // the new owner is not the stored creator until the bot records it
    telegram.setStatus(CHAT, BOB, 'creator');
    const bob = await members({}, BOB);
    assert.equal(bob.status, 403);
    assert.match(bob.body.error, /only the chat creator/);
    assert.equal((await member(ALICE, BOB)).status, 403);

    // unknown chat, no init data
    assert.equal((await callApi('pool-members', { user: CREATOR, query: { chatId: 42 } })).status, 404);
    assert.equal((await callApi('pool-members', { query: { chatId: CHAT } })).status, 401);
});

itest('a missing chatId or userId is a 400, not a lookup of chat or user 0', async () => {
    await seedChat();
    const noChat = await callApi('pool-members', { user: CREATOR });
    assert.equal(noChat.status, 400);
    assert.match(noChat.body.error, /chatId is required/);
    assert.equal((await callApi('pool-members', { user: CREATOR, query: { chatId: '' } })).status, 400);
    assert.equal((await callApi('pool-member', { user: CREATOR, query: { userId: ALICE } })).status, 400);
    const noUser = await callApi('pool-member', { user: CREATOR, query: { chatId: CHAT } });
    assert.equal(noUser.status, 400);
    assert.match(noUser.body.error, /userId is required/);
    assert.equal((await member('')).status, 400);
    // a member called 0 is still looked up as asked
    assert.equal((await member(0)).status, 404);
});
